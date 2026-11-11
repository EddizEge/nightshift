import * as THREE from 'three';
import { AssetLoader, type LoadedGameAssets } from './AssetLoader';
import { InputManager } from './InputManager';
import { QualityManager, type QualityPresetName } from './QualityManager';
import { WetRoadReflector } from '../rendering/WetRoadReflector';
import { createWetAsphaltMaterial, type WetAsphaltUniforms } from '../rendering/WetAsphaltMaterial';
import { PostProcessPipeline } from '../rendering/PostProcessPipeline';
import { HighwayManager } from '../world/HighwayManager';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { PlayerVehicle } from '../vehicles/PlayerVehicle';
import { CinematicCamera } from '../camera/CinematicCamera';
import { TrafficManager } from '../traffic/TrafficManager';
import { RainAndSpraySystem } from '../vfx/RainAndSpraySystem';
import { ExplosionSystem } from '../vfx/ExplosionSystem';
import { CinematicEventsDirector, type CinematicEventType } from '../gameplay/CinematicEvents';
import { ScoreManager } from '../gameplay/ScoreManager';
import { AudioEngine } from '../audio/AudioEngine';
import { UIManager } from '../ui/UIManager';

export type GameState = 'LOADING' | 'MENU' | 'PLAYING' | 'PAUSED' | 'CRASHING' | 'GAMEOVER';

export class NightshiftGame {
  public state: GameState = 'LOADING';

  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();

  private readonly quality = new QualityManager();
  private readonly input = new InputManager();
  private readonly score = new ScoreManager();
  private readonly audio = new AudioEngine();
  private readonly physics = new PhysicsWorld();
  private ui!: UIManager;

  private assets!: LoadedGameAssets;
  private reflector!: WetRoadReflector;
  private asphaltUniforms!: WetAsphaltUniforms;
  private postProcess!: PostProcessPipeline;
  private highway!: HighwayManager;
  private player!: PlayerVehicle;
  private camController!: CinematicCamera;
  private traffic!: TrafficManager;
  private rainAndSpray!: RainAndSpraySystem;
  private explosions!: ExplosionSystem;
  private eventsDirector!: CinematicEventsDirector;

  private moonDirLight!: THREE.DirectionalLight;
  private skyDome!: THREE.Mesh;
  private reflectionSkipObjects: THREE.Object3D[] = [];

  private clockTime = 0;
  private lastRafMs = 0;
  private crashSlowMoTimer = 0;
  private crashReason = 'CHASSIS TOTALED // MIDNIGHT EXPRESSWAY';
  private wasInTunnel = false;

  // Exposed live telemetry for HUD & automated QA verification
  public latestMetrics = {
    fps: 60,
    avgMs: 16.6,
    drawCalls: 0,
    triangles: 0,
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // Handled cleanly via MSAA HalfFloat RenderTarget in PostProcessPipeline!
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = this.quality.spec.enableShadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.ui = new UIManager(this.quality, {
      onStartPlay: () => this.startNewRun(),
      onResume: () => this.resumeGame(),
      onRestart: () => this.startNewRun(),
      onReturnToMenu: () => this.enterMainMenu(),
      onTogglePause: () => this.togglePause(),
      onQualitySelected: (preset: QualityPresetName) => {
        this.quality.setPreset(preset);
        this.applyQualitySettings();
      },
      onDrsToggled: (enabled: boolean) => {
        this.quality.dynamicResolutionEnabled = enabled;
        this.quality.drsScale = 1.0;
        this.quality.saveToStorage();
        this.applyQualitySettings();
      },
      onVolumeChanged: (vol: number) => {
        this.quality.masterVolume = vol;
        this.quality.saveToStorage();
        this.audio.setMasterVolume(vol);
      },
      onTelemetryToggled: (visible: boolean) => {
        this.quality.showTelemetry = visible;
        this.quality.saveToStorage();
      },
      onUiSound: (primary?: boolean) => this.audio.playUiClick(primary),
    });

    this.audio.setMasterVolume(this.quality.masterVolume);
    window.addEventListener('resize', this.onResize);
  }

  public async boot(): Promise<void> {
    this.ui.setLoadingProgress(4, 'Initializing Rapier3D WASM Physics...');
    await this.physics.init();

    this.assets = await AssetLoader.loadAll(
      this.renderer,
      this.quality.spec.anisotropy,
      (pct, msg) => this.ui.setLoadingProgress(pct, msg),
    );

    this.ui.setLoadingProgress(96, 'Compiling Wet Asphalt & Volumetric Fire Shaders...');
    this.setupSceneAndLighting();
    this.onResize();

    // Warm-compile shaders once so first gameplay frame has zero shader-compile stutter!
    this.renderer.compile(this.scene, this.camController.camera);

    this.installDebugBridge();
    this.enterMainMenu();

    this.lastRafMs = performance.now();
    requestAnimationFrame(this.frameLoop);
  }

  private setupSceneAndLighting(): void {
    // Grounded rainy midnight storm fog & environment lighting
    const fogColor = new THREE.Color(0x060a11);
    this.scene.background = fogColor;
    this.scene.fog = new THREE.FogExp2(0x060a11, 0.0044);
    this.scene.environment = this.assets.envMap;
    this.scene.environmentIntensity = 0.88;

    // Storm sky dome blending horizon city haze into overcast rainclouds
    const skyGeo = new THREE.SphereGeometry(580, 28, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        tEnv: { value: this.assets.skyEquirect },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tEnv;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec2 uv = vec2(atan(d.z, d.x) * 0.1591549 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.3183098 + 0.5);
          vec3 hdr = texture2D(tEnv, uv).rgb * 0.22;
          // Blend into stormy slate-indigo zenith & warm distant urban horizon glow
          vec3 zenith = vec3(0.008, 0.014, 0.026);
          vec3 horizon = vec3(0.032, 0.036, 0.048);
          float h = clamp(d.y * 2.4, 0.0, 1.0);
          vec3 sky = mix(horizon, zenith, pow(h, 0.65)) + hdr * (1.0 - h * 0.65);
          gl_FragColor = vec4(sky, 1.0);
        }
      `,
    });
    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.skyDome.frustumCulled = false;
    this.scene.add(this.skyDome);

    // Cold overcast night skylight vs warm asphalt bounce
    const hemi = new THREE.HemisphereLight(0x3a567a, 0x1a1410, 0.85);
    this.scene.add(hemi);

    // Soft overhead storm/street directional light casting crisp grounded vehicle shadows
    this.moonDirLight = new THREE.DirectionalLight(0x8fb2dc, 1.35);
    this.moonDirLight.position.set(14, 34, 18);
    this.moonDirLight.castShadow = this.quality.spec.enableShadows;
    this.moonDirLight.shadow.mapSize.set(this.quality.spec.shadowMapSize, this.quality.spec.shadowMapSize);
    this.moonDirLight.shadow.camera.near = 4;
    this.moonDirLight.shadow.camera.far = 95;
    const d = 22;
    this.moonDirLight.shadow.camera.left = -d;
    this.moonDirLight.shadow.camera.right = d;
    this.moonDirLight.shadow.camera.top = d;
    this.moonDirLight.shadow.camera.bottom = -d;
    this.moonDirLight.shadow.bias = -0.0005;
    this.scene.add(this.moonDirLight);
    this.scene.add(this.moonDirLight.target);

    const { width, height } = this.getInternalResolution();
    this.reflector = new WetRoadReflector(width, height, this.quality.spec.planarReflectionScale);
    this.reflector.enabled = this.quality.spec.enablePlanarReflection;

    const wetRoad = createWetAsphaltMaterial(
      this.assets.asphaltDiff,
      this.assets.asphaltNor,
      this.assets.asphaltArm,
      this.reflector.renderTarget.texture,
      this.reflector.textureMatrix,
    );
    this.asphaltUniforms = wetRoad.uniforms;
    this.asphaltUniforms.uReflectionStrength.value = this.quality.spec.enablePlanarReflection ? 1.0 : 0.0;

    this.highway = new HighwayManager(this.assets, wetRoad.material, this.asphaltUniforms);
    this.scene.add(this.highway.root);

    this.player = new PlayerVehicle(this.assets.playerCarGltf, this.assets.envMap);
    this.scene.add(this.player.root);

    this.traffic = new TrafficManager(this.assets);
    this.scene.add(this.traffic.root);

    this.rainAndSpray = new RainAndSpraySystem(
      this.quality.spec.rainCount,
      this.quality.spec.sprayMaxParticles,
    );
    this.scene.add(this.rainAndSpray.root);

    this.explosions = new ExplosionSystem();
    this.scene.add(this.explosions.root);

    this.eventsDirector = new CinematicEventsDirector();
    this.scene.add(this.eventsDirector.root);

    this.camController = new CinematicCamera(window.innerWidth / Math.max(1, window.innerHeight));
    this.postProcess = new PostProcessPipeline(width, height, this.quality.spec);

    // Skip road meshes and rain/spray particles during planar reflection pass (faster + artifact-free)
    this.reflectionSkipObjects = [...this.highway.roadMeshes, this.rainAndSpray.root];
  }

  private getInternalResolution(): { width: number; height: number; dpr: number } {
    const spec = this.quality.spec;
    const rawDpr = Math.min(window.devicePixelRatio || 1, spec.pixelRatioCap) * this.quality.drsScale;
    const width = Math.max(64, Math.floor(window.innerWidth * rawDpr));
    const height = Math.max(64, Math.floor(window.innerHeight * rawDpr));
    return { width, height, dpr: rawDpr };
  }

  private applyQualitySettings(): void {
    const spec = this.quality.spec;
    const { width, height, dpr } = this.getInternalResolution();

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = spec.enableShadows;
    this.moonDirLight.castShadow = spec.enableShadows;

    this.reflector.enabled = spec.enablePlanarReflection;
    this.reflector.setSize(width, height, spec.planarReflectionScale);
    this.asphaltUniforms.uReflectionMap.value = this.reflector.renderTarget.texture;
    this.asphaltUniforms.uReflectionStrength.value = spec.enablePlanarReflection ? 1.0 : 0.0;

    this.rainAndSpray.setQualityCounts(spec.rainCount, spec.sprayMaxParticles);
    this.postProcess.applyQuality(spec, width, height);
  }

  private onResize = (): void => {
    if (!this.camController || !this.postProcess) return;
    this.camController.setAspect(window.innerWidth / Math.max(1, window.innerHeight));
    this.applyQualitySettings();
  };

  public enterMainMenu(): void {
    this.state = 'MENU';
    this.audio.setPaused(false);
    this.resetWorldEntities();
    // Park supercar slightly angled under warm streetlamp on wet puddle for iconic opening shot!
    this.player.position.set(1.4, 0, -6.0);
    this.player.velocity.set(0, 0, 0);
    this.player.heading = 0.14;
    this.player.speedKmh = 0;
    this.player.speedMps = 0;
    this.player.root.position.copy(this.player.position);
    this.player.root.rotation.y = this.player.heading;
    this.traffic.populateInitialTraffic(this.player.position.z);
    this.ui.showMainMenu(this.score.bestScore);
  }

  public startNewRun(): void {
    this.audio.unlock();
    this.audio.setPaused(false);
    this.resetWorldEntities();
    this.score.reset();
    this.player.reset();
    this.traffic.populateInitialTraffic(this.player.position.z);
    this.camController.snapBehindPlayer(this.player);
    this.ui.setCameraLabel(this.camController.modeLabel);
    this.ui.showGameplayHUD();
    this.ui.showEventBanner('SECTOR 09 // EXPRESSWAY', 'SURVIVE THE MIDNIGHT', 2.4);
    this.state = 'PLAYING';
  }

  private resetWorldEntities(): void {
    this.traffic.reset(this.physics);
    this.highway.reset();
    this.explosions.reset();
    this.eventsDirector.reset();
    this.wasInTunnel = false;
  }

  private togglePause(): void {
    if (this.state === 'PLAYING') {
      this.state = 'PAUSED';
      this.audio.setPaused(true);
      this.ui.setPaused(true);
    } else if (this.state === 'PAUSED') {
      this.resumeGame();
    }
  }

  private resumeGame(): void {
    if (this.state !== 'PAUSED') return;
    this.state = 'PLAYING';
    this.audio.setPaused(false);
    this.ui.setPaused(false);
  }

  private triggerFatalCrashSequence(reason: string): void {
    if (this.state === 'CRASHING' || this.state === 'GAMEOVER') return;
    this.state = 'CRASHING';
    this.crashReason = reason;
    this.crashSlowMoTimer = 1.45;
    this.player.isWrecked = true;

    // Spawn front-end impact fireball slightly ahead of the hood so slow-mo frames show the car, debris & flames!
    const sinH = Math.sin(this.player.heading);
    const cosH = Math.cos(this.player.heading);
    const blastPos = new THREE.Vector3(
      this.player.position.x - sinH * 3.6,
      0.85,
      this.player.position.z - cosH * 3.6,
    );
    this.explosions.triggerExplosion(blastPos, 0.96, this.rainAndSpray, this.player.position, (tr) =>
      this.camController.addTrauma(tr),
    );
    this.audio.playExplosion(3.6, 1.15);
  }

  private finishGameOver(): void {
    this.state = 'GAMEOVER';
    const result = this.score.finalizeRun();
    this.ui.showGameOver({
      finalScore: result.finalScore,
      bestScore: result.bestScore,
      isNewRecord: result.isNewRecord,
      distanceKm: this.score.distanceKm,
      topSpeedKmh: this.score.topSpeedKmh,
      nearMisses: this.score.nearMisses,
      reason: this.crashReason,
    });
  }

  private frameLoop = (nowMs: number): void => {
    requestAnimationFrame(this.frameLoop);

    const rawDt = Math.min(0.05, Math.max(0.0005, (nowMs - this.lastRafMs) / 1000));
    this.lastRafMs = nowMs;

    // Handle global edge-triggered keys
    if (this.input.consumePauseToggle()) {
      if (this.state === 'PLAYING' || this.state === 'PAUSED') {
        this.togglePause();
      }
    }
    if (this.input.consumeConfirm()) {
      if (this.state === 'MENU') {
        this.audio.playUiClick(true);
        this.startNewRun();
      } else if (this.state === 'GAMEOVER') {
        this.audio.playUiClick(true);
        this.startNewRun();
      }
    }
    if (this.state === 'PLAYING' && this.input.consumeCameraToggle()) {
      this.camController.cycleMode();
      this.ui.setCameraLabel(this.camController.modeLabel);
      this.audio.playUiClick();
    }

    // Record true frame duration & Dynamic Resolution Scaling
    const perf = this.quality.recordFrame(rawDt);
    this.latestMetrics.fps = perf.fps;
    this.latestMetrics.avgMs = perf.avgMs;
    if (perf.drsChanged) {
      this.applyQualitySettings();
    }

    if (this.state !== 'PAUSED') {
      const simScale = this.state === 'CRASHING' ? 0.34 : 1.0;
      const simDt = rawDt * simScale;
      this.clockTime += simDt;
      this.stepSimulation(simDt, rawDt);
    }

    this.renderFrame();
  };

  private stepSimulation(dt: number, realDt: number): void {
    if (this.state === 'MENU') {
      // Live animated rain, wet puddle ripples & passing background highway traffic on Main Menu!
      this.highway.update(this.player.position.z, this.clockTime);
      for (const v of this.traffic.vehicles) {
        if (!v.active) continue;
        // Keep menu traffic moving in left lanes (-5.7, -1.9) away from parked showcase car at +1.4
        if (v.pos.x > -0.5) v.pos.x = -5.7;
        v.pos.z -= 26.0 * dt;
        if (v.pos.z < this.player.position.z - 220) v.pos.z = this.player.position.z + 55;
        v.group.position.copy(v.pos);
        for (const w of v.wheels) w.rotation.x += (26.0 / v.wheelRadius) * dt;
      }
      this.camController.updateMenuShowcase(dt, this.clockTime, this.player);
      this.rainAndSpray.update(
        dt,
        this.clockTime,
        this.camController.camera,
        this.player.position,
        this.player.heading,
        0,
        false,
        false,
        this.highway.getTunnelBounds(),
        this.explosions.latestBlastLight,
      );
      this.explosions.update(dt, this.clockTime, this.camController.camera);
      this.audio.updateContinuous({
        activeGameplay: false,
        rpm: 950,
        gear: 1,
        throttle: 0,
        speedKmh: 0,
        slipRatio: 0,
        isBraking: false,
        isNitro: false,
        inTunnel: false,
      });
      return;
    }

    // Floating-Origin Rebase every 2,000m so float32 stays ultra-precise forever
    if (this.player.position.z < -2000) {
      const shiftZ = 2000;
      this.player.applyRebase(shiftZ);
      this.highway.applyOriginRebase(shiftZ);
      this.traffic.applyRebase(shiftZ, this.physics);
      this.rainAndSpray.applyRebase(shiftZ);
      this.explosions.applyRebase(shiftZ);
      this.eventsDirector.applyRebase(shiftZ);
      this.camController.applyRebase(shiftZ);
    }

    const vehicleInput = this.state === 'PLAYING'
      ? this.input.getVehicleInput()
      : { throttle: 0, brake: 0.6, steer: 0, handbrake: false, nitro: false };

    // 1. Update Player Vehicle Simcade Physics
    this.player.update(dt, this.clockTime, vehicleInput, (contactPos, intensity) => {
      this.rainAndSpray.emitSparks(contactPos, Math.round(14 * intensity), this.player.velocity.z, 8.5);
      this.camController.addTrauma(intensity * 0.28);
      this.audio.playImpact(intensity * 0.55);
      this.score.onCollisionPenalty();
      if (this.player.isWrecked) {
        this.triggerFatalCrashSequence('BARRIER IMPACT // CHASSIS FAILURE');
      }
    });

    // Update shadow-casting directional light around player
    this.moonDirLight.position.set(this.player.position.x + 12, 32, this.player.position.z + 16);
    this.moonDirLight.target.position.copy(this.player.position);

    // 2. Step Rapier3D Rigid Body World & Endless Highway
    this.physics.step(dt);
    this.highway.update(this.player.position.z, this.clockTime);

    const inTunnel = this.highway.isInsideTunnel(this.player.position.z);
    if (inTunnel && !this.wasInTunnel && this.state === 'PLAYING') {
      this.ui.pushCallout('ENTERING HARBOR TUNNEL');
    }
    this.wasInTunnel = inTunnel;

    // 3. Update Traffic AI, Collisions & Near Misses
    const trafficEvents = this.traffic.update(
      dt,
      this.clockTime,
      this.score.difficulty,
      this.player,
      this.physics,
      this.rainAndSpray,
      this.explosions,
      inTunnel,
      (tr) => this.camController.addTrauma(tr),
    );

    for (const nm of trafficEvents.nearMisses) {
      const res = this.score.registerNearMiss(nm.closingSpeedKmh);
      this.player.nitroCharge = Math.min(100, this.player.nitroCharge + 14);
      this.audio.playNearMissWhoosh();
      this.ui.pushCallout(`NEAR MISS +${res.points} (x${res.multiplier.toFixed(1)})`);
    }

    for (const ex of trafficEvents.explosionTriggered) {
      this.audio.playExplosion(this.player.position.distanceTo(ex.pos), ex.scale);
    }

    if (trafficEvents.playerImpact) {
      const imp = trafficEvents.playerImpact;
      this.score.onCollisionPenalty();
      this.camController.addTrauma(Math.min(0.85, imp.severity * 0.7));
      this.audio.playImpact(imp.severity);
      if (imp.fatal || this.player.isWrecked) {
        this.triggerFatalCrashSequence(
          imp.otherKind === 'TANKER'
            ? 'HAZARD TANKER DETONATION // TOTAL LOSS'
            : 'HIGH-SPEED TRAFFIC COLLISION',
        );
      } else {
        this.ui.pushCallout('COLLISION — MULTIPLIER RESET');
      }
    }

    // 4. Update Real-Time Cinematic Events (Event A & Event B)
    if (this.state === 'PLAYING') {
      this.eventsDirector.update(
        dt,
        this.clockTime,
        this.player,
        this.traffic,
        this.physics,
        this.explosions,
        this.rainAndSpray,
        {
          onBanner: (kicker, title, dur) => this.ui.showEventBanner(kicker, title, dur),
          onBonusAwarded: (label, rawPts) => {
            const pts = this.score.registerBonus(rawPts);
            this.ui.pushCallout(`${label} +${pts}`);
            this.audio.playNearMissWhoosh();
          },
          onExplosionAudio: (dist, scale) => this.audio.playExplosion(dist, scale),
          onLightningAudio: () => this.audio.playLightningCrack(),
          onTrauma: (amt) => this.camController.addTrauma(amt),
        },
      );
    }

    // 5. Score, Camera, Rain/Spray, Explosions, Audio & HUD
    this.score.update(dt, this.player.speedMps, this.player.speedKmh, this.player.isNitroActive, this.player.isWrecked);
    this.camController.updateGameplay(dt, this.clockTime, this.player);

    this.rainAndSpray.update(
      dt,
      this.clockTime,
      this.camController.camera,
      this.player.position,
      this.player.heading,
      this.player.speedMps,
      this.player.isBraking,
      inTunnel,
      this.highway.getTunnelBounds(),
      this.explosions.latestBlastLight,
    );

    this.explosions.update(dt, this.clockTime, this.camController.camera);

    this.audio.updateContinuous({
      activeGameplay: this.state === 'PLAYING',
      rpm: this.player.rpm,
      gear: this.player.gear,
      throttle: vehicleInput.throttle,
      speedKmh: this.player.speedKmh,
      slipRatio: this.player.slipRatio,
      isBraking: this.player.isBraking,
      isNitro: this.player.isNitroActive,
      inTunnel,
    });

    if (this.state === 'CRASHING') {
      this.crashSlowMoTimer -= realDt;
      if (this.crashSlowMoTimer <= 0) {
        this.finishGameOver();
      }
    }

    if (this.state === 'PLAYING' || this.state === 'CRASHING') {
      this.ui.updateHUD({
        score: this.score.score,
        distanceKm: this.score.distanceKm,
        nearMisses: this.score.nearMisses,
        combo: this.score.comboMultiplier,
        comboBar: this.score.comboTimer,
        integrity: this.player.integrity,
        speedKmh: this.player.speedKmh,
        gear: this.player.gear,
        rpm: this.player.rpm,
        nitroCharge: this.player.nitroCharge,
        isNitroActive: this.player.isNitroActive,
        fps: this.latestMetrics.fps,
        avgMs: this.latestMetrics.avgMs,
        drawCalls: this.latestMetrics.drawCalls,
      });
    }
  }

  private renderFrame(): void {
    this.renderer.info.reset();
    const cam = this.camController.camera;
    this.skyDome.position.copy(cam.position);

    // 1. Planar Wet Road Reflection Pass (skips road & rain particles)
    this.reflector.render(this.renderer, this.scene, cam, this.reflectionSkipObjects);

    // 2. Main MSAA HDR Scene + Bloom + Peripheral Lens Rain + Filmic ToneMapping
    const inTunnel = this.highway.isInsideTunnel(cam.position.z);
    this.postProcess.render(this.renderer, this.scene, cam, {
      time: this.clockTime,
      speedKmh: this.player.speedKmh,
      nitroFactor: this.player.isNitroActive ? 1.0 : 0.0,
      stormExposure: inTunnel ? 0.1 : 1.0,
      flashPulse: this.explosions.flashPulse,
      spec: this.quality.spec,
    });

    this.latestMetrics.drawCalls = this.renderer.info.render.calls;
    this.latestMetrics.triangles = this.renderer.info.render.triangles;
  }

  private installDebugBridge(): void {
    (window as unknown as Record<string, unknown>).__NIGHTSHIFT_DEBUG__ = {
      getState: () => ({
        state: this.state,
        speedKmh: +this.player.speedKmh.toFixed(1),
        position: {
          x: +this.player.position.x.toFixed(2),
          y: +this.player.position.y.toFixed(2),
          z: +this.player.position.z.toFixed(2),
        },
        score: Math.floor(this.score.score),
        distanceKm: +this.score.distanceKm.toFixed(3),
        nearMisses: this.score.nearMisses,
        combo: this.score.comboMultiplier,
        integrity: +this.player.integrity.toFixed(1),
        nitro: +this.player.nitroCharge.toFixed(1),
        cameraMode: this.camController.mode,
        inTunnel: this.highway.isInsideTunnel(this.player.position.z),
        quality: this.quality.currentPreset,
        drsScale: this.quality.drsScale,
        metrics: { ...this.latestMetrics },
      }),
      triggerEvent: (type: CinematicEventType) =>
        this.eventsDirector.triggerSpecificEventNow(type, this.player, this.traffic, {
          onBanner: (k, t, d) => this.ui.showEventBanner(k, t, d),
          onBonusAwarded: (lbl, pts) => {
            const p = this.score.registerBonus(pts);
            this.ui.pushCallout(`${lbl} +${p}`);
          },
          onExplosionAudio: (d, s) => this.audio.playExplosion(d, s),
          onLightningAudio: () => this.audio.playLightningCrack(),
          onTrauma: (a) => this.camController.addTrauma(a),
        }),
      triggerShowcaseExplosionAhead: (dist = 38) => {
        const pos = new THREE.Vector3(this.player.position.x - 1.5, 0.8, this.player.position.z - dist);
        this.explosions.triggerExplosion(pos, 1.75, this.rainAndSpray, this.player.position, (t) =>
          this.camController.addTrauma(t),
        );
      },
      teleportToTunnel: () => {
        // Tunnel spans segments 7..10 -> z = -560..-800
        this.player.position.set(1.9, 0, -595);
        this.highway.update(this.player.position.z, this.clockTime);
        this.camController.snapBehindPlayer(this.player);
      },
      setMenuOrbitAngle: (rad: number) => this.camController.setMenuOrbitAngle(rad),
      forceCrash: () => this.triggerFatalCrashSequence('HIGH-SPEED COLLISION // SIMULATION TEST'),
    };
  }
}
