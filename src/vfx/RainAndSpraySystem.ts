import * as THREE from 'three';

interface SprayParticle {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  tintRed: number;
}

interface SparkParticle {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  life: number;
}

export class RainAndSpraySystem {
  public readonly root = new THREE.Group();

  // 1. GPU Rain Mesh
  private rainMesh!: THREE.Mesh;
  private rainMat!: THREE.ShaderMaterial;
  private maxRainCount = 13000;

  // 2. Tire Hydro-Spray Instanced Pool
  private sprayMesh!: THREE.InstancedMesh;
  private sprayParticles: SprayParticle[] = [];
  private maxSpray = 520;
  private activeSprayLimit = 380;
  private sprayCursor = 0;
  private spraySpawnAcc = 0;

  // 3. Collision / Scrape Sparks Instanced Pool
  private sparkMesh!: THREE.InstancedMesh;
  private sparkParticles: SparkParticle[] = [];
  private readonly maxSparks = 280;
  private sparkCursor = 0;

  private readonly dummy = new THREE.Object3D();
  private readonly colorTmp = new THREE.Color();

  constructor(initialRainCount: number, initialSprayMax: number) {
    this.buildGpuRainSystem(initialRainCount);
    this.buildTireSpraySystem(initialSprayMax);
    this.buildSparkSystem();
  }

  private buildGpuRainSystem(activeCount: number): void {
    const baseQuad = new THREE.PlaneGeometry(0.018, 0.85);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = baseQuad.index;
    geo.attributes.position = baseQuad.attributes.position;
    geo.attributes.uv = baseQuad.attributes.uv;

    const offsets = new Float32Array(this.maxRainCount * 3);
    const seeds = new Float32Array(this.maxRainCount * 2);

    let s = 9187;
    const rand = () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };

    for (let i = 0; i < this.maxRainCount; i++) {
      offsets[i * 3 + 0] = (rand() - 0.5) * 44.0;
      offsets[i * 3 + 1] = rand() * 20.0;
      offsets[i * 3 + 2] = (rand() - 0.5) * 78.0;
      seeds[i * 2 + 0] = 0.78 + rand() * 0.52; // fall speed multiplier
      seeds[i * 2 + 1] = rand(); // random brightness / phase
    }

    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 2));
    geo.instanceCount = Math.min(this.maxRainCount, activeCount);

    this.rainMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uCamPos: { value: new THREE.Vector3() },
        uPlayerPos: { value: new THREE.Vector3() },
        uPlayerFwd: { value: new THREE.Vector3(0, 0, -1) },
        uSpeedMps: { value: 0 },
        uTunnelRange: { value: new THREE.Vector2(99999, 99999) },
        uBlastPos: { value: new THREE.Vector4(0, -100, 0, 0) }, // xyz + intensity
      },
      vertexShader: /* glsl */ `
        attribute vec3 aOffset;
        attribute vec2 aSeed;

        uniform float uTime;
        uniform vec3 uCamPos;
        uniform vec3 uPlayerPos;
        uniform vec3 uPlayerFwd;
        uniform float uSpeedMps;
        uniform vec2 uTunnelRange;
        uniform vec4 uBlastPos;

        varying vec2 vUv;
        varying float vAlpha;
        varying vec3 vTint;

        void main() {
          vUv = uv;
          vec3 boxSize = vec3(44.0, 20.0, 78.0);

          // Continuous world-space raindrop wrapping around camera
          vec3 worldCenter = uCamPos + vec3(0.0, 6.0, -20.0);
          vec3 animShift = vec3(
            uTime * 2.4,
            -uTime * (26.0 * aSeed.x),
            uTime * 4.5
          );

          vec3 rel = mod(aOffset + animShift - worldCenter + boxSize * 0.5, boxSize) - boxSize * 0.5;
          vec3 dropWorld = worldCenter + rel;

          // Cull rain inside concrete highway tunnel!
          float inTunnel = step(uTunnelRange.x, dropWorld.z) * step(dropWorld.z, uTunnelRange.y);
          float aboveRoad = step(0.05, dropWorld.y);

          // Streak velocity vector in world space (falling + crosswind + relative motion)
          vec3 velDir = normalize(vec3(0.08, -1.0, 0.20 + clamp(uSpeedMps * 0.014, 0.0, 1.05)));
          vec3 toCam = normalize(uCamPos - dropWorld);
          vec3 sideDir = normalize(cross(velDir, toCam));

          float streakLen = (0.62 + clamp(uSpeedMps * 0.012, 0.0, 0.85)) * aSeed.x;
          float width = 0.014 + aSeed.y * 0.008;

          vec3 finalWorld = dropWorld + sideDir * (position.x / 0.018 * width) + velDir * (position.y * streakLen);

          // Compute real-time illumination from player's dual Xenon headlights!
          vec3 fromCar = dropWorld - (uPlayerPos + vec3(0.0, 0.68, -1.8));
          float forwardDist = dot(fromCar, uPlayerFwd);
          float coneFactor = 0.0;
          if (forwardDist > 0.4 && forwardDist < 48.0) {
            vec3 perp = fromCar - uPlayerFwd * forwardDist;
            float coneRad = 0.95 + forwardDist * 0.22;
            float radial = 1.0 - smoothstep(coneRad * 0.45, coneRad, length(perp));
            float atten = 1.0 - smoothstep(4.0, 48.0, forwardDist);
            coneFactor = radial * atten;
          }

          // Streetlamp warm ambient + explosion orange flash on falling rain
          float blastDist = length(dropWorld - uBlastPos.xyz);
          float blastLit = uBlastPos.w * exp(-blastDist * 0.055);

          vec3 baseRainCol = vec3(0.32, 0.42, 0.56);
          vec3 headLitCol = vec3(0.85, 0.94, 1.15) * (coneFactor * 1.65);
          vec3 blastCol = vec3(1.4, 0.68, 0.24) * blastLit;
          vTint = baseRainCol + headLitCol + blastCol;

          float camDist = length(dropWorld - uCamPos);
          float distFade = (1.0 - smoothstep(26.0, 52.0, camDist)) * smoothstep(0.9, 2.8, camDist);
          vAlpha = (0.13 + coneFactor * 0.34 + blastLit * 0.25) * distFade * (1.0 - inTunnel) * aboveRoad;

          gl_Position = projectionMatrix * viewMatrix * vec4(finalWorld, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vAlpha;
        varying vec3 vTint;

        void main() {
          if (vAlpha < 0.004) discard;
          float tipFade = sin(vUv.y * 3.14159265);
          float core = 1.0 - abs(vUv.x - 0.5) * 2.0;
          gl_FragColor = vec4(vTint, vAlpha * tipFade * core);
        }
      `,
    });

    this.rainMesh = new THREE.Mesh(geo, this.rainMat);
    this.rainMesh.frustumCulled = false;
    this.root.add(this.rainMesh);
  }

  private buildTireSpraySystem(initialActiveLimit: number): void {
    this.activeSprayLimit = Math.min(this.maxSpray, initialActiveLimit);

    // Soft radial mist texture generated once on Canvas
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0.0, 'rgba(220, 232, 245, 0.46)');
    grad.addColorStop(0.45, 'rgba(185, 202, 222, 0.22)');
    grad.addColorStop(1.0, 'rgba(150, 170, 195, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      opacity: 0.52,
    });

    const quad = new THREE.PlaneGeometry(1.0, 1.0);
    this.sprayMesh = new THREE.InstancedMesh(quad, mat, this.maxSpray);
    this.sprayMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sprayMesh.frustumCulled = false;

    for (let i = 0; i < this.maxSpray; i++) {
      this.sprayParticles.push({
        active: false,
        pos: new THREE.Vector3(0, -100, 0),
        vel: new THREE.Vector3(),
        age: 0,
        life: 0.5,
        size: 1.0,
        tintRed: 0,
      });
      this.dummy.position.set(0, -100, 0);
      this.dummy.scale.setScalar(0.001);
      this.dummy.updateMatrix();
      this.sprayMesh.setMatrixAt(i, this.dummy.matrix);
      this.sprayMesh.setColorAt(i, new THREE.Color(0xffffff));
    }
    this.root.add(this.sprayMesh);
  }

  private buildSparkSystem(): void {
    const geo = new THREE.BoxGeometry(0.035, 0.035, 0.52);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(5.5, 2.6, 0.65), // HDR fiery titanium spark
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.sparkMesh = new THREE.InstancedMesh(geo, mat, this.maxSparks);
    this.sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sparkMesh.frustumCulled = false;

    for (let i = 0; i < this.maxSparks; i++) {
      this.sparkParticles.push({
        active: false,
        pos: new THREE.Vector3(0, -100, 0),
        vel: new THREE.Vector3(),
        age: 0,
        life: 0.5,
      });
      this.dummy.position.set(0, -100, 0);
      this.dummy.scale.setScalar(0.001);
      this.dummy.updateMatrix();
      this.sparkMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.root.add(this.sparkMesh);
  }

  public setQualityCounts(rainCount: number, sprayCount: number): void {
    (this.rainMesh.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.min(
      this.maxRainCount,
      rainCount,
    );
    this.activeSprayLimit = Math.min(this.maxSpray, sprayCount);
  }

  public emitTireSpray(
    originX: number,
    originZ: number,
    velZ: number,
    lateralSpread: number,
    tintRed: number,
    sizeBase = 0.68,
  ): void {
    const idx = this.sprayCursor % this.activeSprayLimit;
    this.sprayCursor++;
    const p = this.sprayParticles[idx];
    p.active = true;
    p.age = 0;
    p.life = 0.34 + Math.random() * 0.24;
    p.pos.set(originX + (Math.random() - 0.5) * 0.22, 0.22 + Math.random() * 0.14, originZ);
    p.vel.set(
      lateralSpread + (Math.random() - 0.5) * 2.2,
      1.35 + Math.random() * 1.45,
      velZ * 0.38 + 3.5 + Math.random() * 2.5,
    );
    p.size = sizeBase * (0.85 + Math.random() * 0.35);
    p.tintRed = tintRed;
  }

  public emitSparks(origin: THREE.Vector3, count: number, baseVelZ: number, spread = 8.5): void {
    const n = Math.min(count, 48);
    for (let i = 0; i < n; i++) {
      const idx = this.sparkCursor % this.maxSparks;
      this.sparkCursor++;
      const sp = this.sparkParticles[idx];
      sp.active = true;
      sp.age = 0;
      sp.life = 0.28 + Math.random() * 0.42;
      sp.pos.copy(origin).add(
        new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.3, (Math.random() - 0.5) * 0.4),
      );
      sp.vel.set(
        (Math.random() - 0.5) * spread * 1.3,
        2.2 + Math.random() * spread * 0.85,
        baseVelZ * 0.45 + (Math.random() - 0.25) * spread,
      );
    }
  }

  public applyRebase(deltaZ: number): void {
    for (const p of this.sprayParticles) {
      if (p.active) p.pos.z += deltaZ;
    }
    for (const sp of this.sparkParticles) {
      if (sp.active) sp.pos.z += deltaZ;
    }
  }

  public update(
    dt: number,
    time: number,
    camera: THREE.Camera,
    playerPos: THREE.Vector3,
    playerHeading: number,
    speedMps: number,
    isBraking: boolean,
    inTunnel: boolean,
    tunnelRange: THREE.Vector2,
    blastLightInfo: THREE.Vector4,
  ): void {
    // 1. Update GPU Rain uniforms
    this.rainMat.uniforms.uTime.value = time;
    this.rainMat.uniforms.uCamPos.value.copy(camera.position);
    this.rainMat.uniforms.uPlayerPos.value.copy(playerPos);
    this.rainMat.uniforms.uPlayerFwd.value.set(-Math.sin(playerHeading), 0, -Math.cos(playerHeading));
    this.rainMat.uniforms.uSpeedMps.value = speedMps;
    this.rainMat.uniforms.uTunnelRange.value.copy(tunnelRange);
    this.rainMat.uniforms.uBlastPos.value.copy(blastLightInfo);

    // 2. Spawn player rear tire hydro-spray when outside tunnel at >45 km/h
    if (!inTunnel && speedMps > 12.5) {
      const rate = THREE.MathUtils.clamp((speedMps - 12.0) * 1.65, 6, 85);
      this.spraySpawnAcc += rate * dt;
      const sinH = Math.sin(playerHeading);
      const cosH = Math.cos(playerHeading);
      const rearZOff = 1.48;
      const trackX = 0.88;
      const brakeRed = isBraking ? 0.85 : 0.35;

      while (this.spraySpawnAcc >= 1.0) {
        this.spraySpawnAcc -= 1.0;
        for (const side of [-1, 1]) {
          const wx = playerPos.x + side * trackX * cosH + rearZOff * sinH;
          const wz = playerPos.z - side * trackX * sinH + rearZOff * cosH;
          this.emitTireSpray(wx, wz, -speedMps, side * 1.4, brakeRed, 0.72);
        }
      }
    }

    // 3. Simulate & billboarding update for Tire Spray
    const camQuat = camera.quaternion;
    for (let i = 0; i < this.maxSpray; i++) {
      const p = this.sprayParticles[i];
      if (!p.active || i >= this.activeSprayLimit) {
        this.dummy.position.set(0, -100, 0);
        this.dummy.scale.setScalar(0.001);
        this.dummy.updateMatrix();
        this.sprayMesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }

      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        this.dummy.position.set(0, -100, 0);
        this.dummy.scale.setScalar(0.001);
        this.dummy.updateMatrix();
        this.sprayMesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }

      p.vel.y -= 3.2 * dt;
      p.vel.x *= Math.exp(-2.0 * dt);
      p.pos.addScaledVector(p.vel, dt);

      const t = p.age / p.life;
      const scale = p.size * (0.55 + t * 1.75) * (1.0 - t * 0.45);
      this.dummy.position.copy(p.pos);
      this.dummy.quaternion.copy(camQuat);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.sprayMesh.setMatrixAt(i, this.dummy.matrix);

      // Crimson brake/tail light backscatter tint near vehicle tail, fading into cool grey-blue mist
      const redGlow = p.tintRed * (1.0 - t);
      this.colorTmp.setRGB(
        0.16 + redGlow * 0.85,
        0.19 * (1.0 - redGlow * 0.55),
        0.24 * (1.0 - redGlow * 0.65),
      );
      this.sprayMesh.setColorAt(i, this.colorTmp);
    }
    this.sprayMesh.instanceMatrix.needsUpdate = true;
    if (this.sprayMesh.instanceColor) this.sprayMesh.instanceColor.needsUpdate = true;

    // 4. Simulate & orient velocity-aligned metallic sparks (with wet road bounce!)
    const upVec = new THREE.Vector3(0, 1, 0);
    const dirVec = new THREE.Vector3();
    for (let i = 0; i < this.maxSparks; i++) {
      const sp = this.sparkParticles[i];
      if (!sp.active) continue;

      sp.age += dt;
      if (sp.age >= sp.life) {
        sp.active = false;
        this.dummy.position.set(0, -100, 0);
        this.dummy.scale.setScalar(0.001);
        this.dummy.updateMatrix();
        this.sparkMesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }

      sp.vel.y -= 18.5 * dt;
      sp.pos.addScaledVector(sp.vel, dt);
      if (sp.pos.y < 0.04) {
        sp.pos.y = 0.04;
        sp.vel.y = Math.abs(sp.vel.y) * 0.48;
        sp.vel.x *= 0.82;
        sp.vel.z *= 0.82;
      }

      const speed = sp.vel.length();
      const fade = 1.0 - sp.age / sp.life;
      this.dummy.position.copy(sp.pos);
      if (speed > 0.1) {
        dirVec.copy(sp.vel).normalize();
        this.dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dirVec);
      } else {
        this.dummy.quaternion.setFromAxisAngle(upVec, 0);
      }
      this.dummy.scale.set(fade, fade, THREE.MathUtils.clamp(speed * 0.09, 0.3, 2.2) * fade);
      this.dummy.updateMatrix();
      this.sparkMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.sparkMesh.instanceMatrix.needsUpdate = true;
  }
}
