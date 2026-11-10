import * as THREE from 'three';
import type { RainAndSpraySystem } from './RainAndSpraySystem';

interface FireballLobe {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  offset: THREE.Vector3;
  vel: THREE.Vector3;
  baseRadius: number;
  delay: number;
}

interface SmokePuff {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  life: number;
  startScale: number;
  endScale: number;
  heat: number;
  fireOrigin: THREE.Vector3;
}

interface DebrisChunk {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  angVel: THREE.Vector3;
  scale: THREE.Vector3;
  age: number;
  life: number;
  smokeTimer: number;
}

interface GroundFirePatch {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  age: number;
  life: number;
  active: boolean;
}

interface ActiveExplosion {
  active: boolean;
  origin: THREE.Vector3;
  age: number;
  duration: number;
  scale: number;
  flashSprite: THREE.Mesh;
  flashMat: THREE.MeshBasicMaterial;
  shockRing: THREE.Mesh;
  shockMat: THREE.ShaderMaterial;
  shockSphere: THREE.Mesh;
  shockSphereMat: THREE.ShaderMaterial;
  lobes: FireballLobe[];
  light: THREE.PointLight;
}

const FIREBALL_VERT = /* glsl */ `
uniform float uTime;
uniform float uProgress;
uniform float uSeed;
varying vec3 vNormalW;
varying vec3 vViewDir;
varying float vNoise;

float hash31(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),
        mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
        mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

float fbm3(vec3 p) {
  float v = 0.0;
  float a = 0.52;
  for (int i = 0; i < 4; i++) {
    v += a * noise3(p);
    p = p * 2.07 + vec3(0.0, -uTime * 1.65, 0.0);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 nPos = normalize(position) * 2.15 + vec3(uSeed * 7.3, -uTime * 1.4, uSeed * 3.9);
  float n = fbm3(nPos);
  vNoise = n;

  // Turbulent volumetric billowing displacement
  float disp = (n - 0.38) * (0.55 + uProgress * 0.65);
  vec3 displaced = position + normal * disp;

  vec4 wp = modelMatrix * vec4(displaced, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FIREBALL_FRAG = /* glsl */ `
uniform float uProgress;
varying vec3 vNormalW;
varying vec3 vViewDir;
varying float vNoise;

// Physically motivated Blackbody Fire -> Soot gradient (rich orange/crimson folds + dark soot crevices)
vec3 blackbodyFire(float temp) {
  vec3 soot = vec3(0.015, 0.014, 0.018);
  vec3 deepRed = vec3(1.05, 0.07, 0.010);
  vec3 brightOrange = vec3(2.75, 0.64, 0.055);
  vec3 whiteHot = vec3(4.35, 2.55, 0.78);

  vec3 c = mix(soot, deepRed, smoothstep(0.10, 0.40, temp));
  c = mix(c, brightOrange, smoothstep(0.38, 0.72, temp));
  c = mix(c, whiteHot, smoothstep(0.76, 0.99, temp));
  return c;
}

void main() {
  float ndv = clamp(dot(normalize(vNormalW), normalize(vViewDir)), 0.0, 1.0);
  // Core is hotter; outer billowing ridges cool rapidly into dark soot crust
  float cooling = uProgress * 1.05;
  float heat = clamp(vNoise * 1.18 + ndv * 0.34 - cooling, 0.0, 1.0);

  // Dissolve edges organically in late explosion stage
  float erode = smoothstep(uProgress * 0.88 - 0.15, uProgress * 0.88 + 0.16, vNoise + ndv * 0.25);
  if (erode < 0.02) discard;

  vec3 col = blackbodyFire(heat);
  float alpha = erode * (1.0 - smoothstep(0.76, 1.0, uProgress));
  gl_FragColor = vec4(col, alpha);
}
`;

export class ExplosionSystem {
  public readonly root = new THREE.Group();
  public flashPulse = 0; // Feeds PostProcessPipeline exposure spike
  public readonly latestBlastLight = new THREE.Vector4(0, -100, 0, 0); // xyz + intensity for rain shader

  private readonly explosions: ActiveExplosion[] = [];
  private readonly maxConcurrentExplosions = 5;

  // Instanced Multi-Layer Smoke Plume Pool (lit from below by fireball!)
  private smokeMesh!: THREE.InstancedMesh;
  private smokeMat!: THREE.ShaderMaterial;
  private smokePuffs: SmokePuff[] = [];
  private readonly maxSmoke = 220;
  private smokeCursor = 0;

  // Instanced 3D Tumbling Debris Chunks Pool
  private debrisMesh!: THREE.InstancedMesh;
  private debrisChunks: DebrisChunk[] = [];
  private readonly maxDebris = 96;
  private debrisCursor = 0;

  // Lingering Ground Burning Fuel Patches
  private groundFires: GroundFirePatch[] = [];
  private fireCursor = 0;

  private readonly dummy = new THREE.Object3D();

  constructor() {
    this.initExplosionPool();
    this.initSmokePool();
    this.initDebrisPool();
    this.initGroundFirePool();
  }

  private initExplosionPool(): void {
    const sphereGeo = new THREE.IcosahedronGeometry(1.0, 5);
    const ringGeo = new THREE.PlaneGeometry(2.0, 2.0);
    ringGeo.rotateX(-Math.PI * 0.5);

    // Soft star/core flash texture
    const flashCanvas = document.createElement('canvas');
    flashCanvas.width = 128;
    flashCanvas.height = 128;
    const fctx = flashCanvas.getContext('2d')!;
    const grad = fctx.createRadialGradient(64, 64, 1, 64, 64, 64);
    grad.addColorStop(0.0, 'rgba(255, 252, 235, 1.0)');
    grad.addColorStop(0.22, 'rgba(255, 185, 90, 0.82)');
    grad.addColorStop(0.55, 'rgba(255, 95, 20, 0.25)');
    grad.addColorStop(1.0, 'rgba(255, 50, 0, 0.0)');
    fctx.fillStyle = grad;
    fctx.fillRect(0, 0, 128, 128);
    const flashTex = new THREE.CanvasTexture(flashCanvas);

    for (let i = 0; i < this.maxConcurrentExplosions; i++) {
      const flashMat = new THREE.MeshBasicMaterial({
        map: flashTex,
        color: new THREE.Color(9.0, 6.2, 3.2),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const flashSprite = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flashMat);
      flashSprite.visible = false;
      this.root.add(flashSprite);

      // Ground Mach vapor shockwave ring
      const shockMat = new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { uAlpha: { value: 0.0 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uAlpha;
          varying vec2 vUv;
          void main() {
            float r = length(vUv - 0.5) * 2.0;
            float d = (r - 0.80) * 7.5;
            float wave = exp(-d * d) * smoothstep(1.0, 0.82, r) * smoothstep(0.15, 0.55, r);
            gl_FragColor = vec4(vec3(1.6, 1.15, 0.75), wave * uAlpha);
          }
        `,
      });
      const shockRing = new THREE.Mesh(ringGeo, shockMat);
      shockRing.visible = false;
      this.root.add(shockRing);

      // 3D Spherical Pressure Wave Shell
      const shockSphereMat = new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        uniforms: { uAlpha: { value: 0.0 } },
        vertexShader: /* glsl */ `
          varying vec3 vN;
          varying vec3 vV;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vN = normalize(mat3(modelMatrix) * normal);
            vV = normalize(cameraPosition - wp.xyz);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uAlpha;
          varying vec3 vN;
          varying vec3 vV;
          void main() {
            float rimBase = clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
            float rim = rimBase * rimBase * rimBase * rimBase;
            gl_FragColor = vec4(vec3(1.4, 1.1, 0.85), rim * uAlpha);
          }
        `,
      });
      const shockSphere = new THREE.Mesh(sphereGeo, shockSphereMat);
      shockSphere.visible = false;
      this.root.add(shockSphere);

      // 5 Coordinated Volumetric Fireball Lobes per explosion for multi-lobed organic realism!
      const lobes: FireballLobe[] = [];
      for (let l = 0; l < 5; l++) {
        const mat = new THREE.ShaderMaterial({
          vertexShader: FIREBALL_VERT,
          fragmentShader: FIREBALL_FRAG,
          transparent: true,
          depthWrite: false,
          uniforms: {
            uTime: { value: 0 },
            uProgress: { value: 0 },
            uSeed: { value: i * 5.0 + l * 1.37 },
          },
        });
        const mesh = new THREE.Mesh(sphereGeo, mat);
        mesh.visible = false;
        this.root.add(mesh);
        lobes.push({
          mesh,
          mat,
          offset: new THREE.Vector3(),
          vel: new THREE.Vector3(),
          baseRadius: 1.0,
          delay: l * 0.045,
        });
      }

      const light = new THREE.PointLight(0xff7b24, 0, 88, 1.45);
      light.visible = false;
      this.root.add(light);

      this.explosions.push({
        active: false,
        origin: new THREE.Vector3(),
        age: 0,
        duration: 2.2,
        scale: 1.0,
        flashSprite,
        flashMat,
        shockRing,
        shockMat,
        shockSphere,
        shockSphereMat,
        lobes,
        light,
      });
    }
  }

  private initSmokePool(): void {
    // Procedural soft turbulent smoke puff alpha + normal-like internal fire underlighting
    const quad = new THREE.PlaneGeometry(1, 1);
    const heatAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.maxSmoke), 1);
    const alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.maxSmoke), 1);
    quad.setAttribute('aHeat', heatAttr);
    quad.setAttribute('aAlpha', alphaAttr);

    this.smokeMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aHeat;
        attribute float aAlpha;
        varying vec2 vUv;
        varying float vHeat;
        varying float vAlpha;
        void main() {
          vUv = uv;
          vHeat = aHeat;
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        varying float vHeat;
        varying float vAlpha;

        float hash21(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.2);
          return fract(p.x * p.y);
        }
        float noise2(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash21(i), hash21(i + vec2(1, 0)), f.x),
            mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x),
            f.y
          );
        }

        void main() {
          vec2 c = vUv - 0.5;
          float r = length(c) * 2.0;
          float n = noise2(vUv * 4.5 + vec2(0.0, -uTime * 0.45)) * 0.55
                  + noise2(vUv * 9.2 - vec2(uTime * 0.25, 0.0)) * 0.45;
          float mask = smoothstep(1.0, 0.18, r + (n - 0.5) * 0.48);
          if (mask * vAlpha < 0.008) discard;

          // Dense dark hydrocarbon smoke underlit on bottom half by fiery orange core!
          float bottomGlow = clamp((0.62 - vUv.y) * 1.6, 0.0, 1.0) * vHeat;
          vec3 darkSoot = vec3(0.028, 0.032, 0.040);
          vec3 fireBounce = vec3(2.4, 0.72, 0.12) * (bottomGlow * (0.45 + 0.55 * n));
          vec3 col = darkSoot + fireBounce;

          gl_FragColor = vec4(col, mask * vAlpha);
        }
      `,
    });

    this.smokeMesh = new THREE.InstancedMesh(quad, this.smokeMat, this.maxSmoke);
    this.smokeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.smokeMesh.frustumCulled = false;

    for (let i = 0; i < this.maxSmoke; i++) {
      this.smokePuffs.push({
        active: false,
        pos: new THREE.Vector3(0, -100, 0),
        vel: new THREE.Vector3(),
        age: 0,
        life: 3.5,
        startScale: 1.5,
        endScale: 6.5,
        heat: 0,
        fireOrigin: new THREE.Vector3(),
      });
      this.dummy.position.set(0, -100, 0);
      this.dummy.scale.setScalar(0.001);
      this.dummy.updateMatrix();
      this.smokeMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.root.add(this.smokeMesh);
  }

  private initDebrisPool(): void {
    // Jagged metallic car-panel / chassis chunk geometry
    const geo = new THREE.DodecahedronGeometry(0.28, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1e2024,
      metalness: 0.78,
      roughness: 0.36,
      emissive: new THREE.Color(0xff4208),
      emissiveIntensity: 0.95,
    });

    this.debrisMesh = new THREE.InstancedMesh(geo, mat, this.maxDebris);
    this.debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debrisMesh.frustumCulled = false;

    for (let i = 0; i < this.maxDebris; i++) {
      this.debrisChunks.push({
        active: false,
        pos: new THREE.Vector3(0, -100, 0),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(),
        angVel: new THREE.Vector3(),
        scale: new THREE.Vector3(1, 1, 1),
        age: 0,
        life: 3.0,
        smokeTimer: 0,
      });
      this.dummy.position.set(0, -100, 0);
      this.dummy.scale.setScalar(0.001);
      this.dummy.updateMatrix();
      this.debrisMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.root.add(this.debrisMesh);
  }

  private initGroundFirePool(): void {
    const planeGeo = new THREE.PlaneGeometry(1, 1);
    planeGeo.rotateX(-Math.PI * 0.5);

    for (let i = 0; i < 14; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uFade: { value: 0 },
          uSeed: { value: i * 3.17 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform float uFade;
          uniform float uSeed;
          varying vec2 vUv;
          void main() {
            vec2 c = vUv - 0.5;
            float d = length(c) * 2.0;
            float flicker = 0.72 + 0.28 * sin(uTime * 22.0 + uSeed + c.x * 14.0) * cos(uTime * 17.0 - c.y * 12.0);
            float mask = smoothstep(1.0, 0.15, d) * uFade * flicker;
            vec3 col = mix(vec3(2.8, 0.55, 0.05), vec3(6.5, 3.4, 0.85), smoothstep(0.75, 0.0, d));
            gl_FragColor = vec4(col, mask);
          }
        `,
      });
      const mesh = new THREE.Mesh(planeGeo, mat);
      mesh.visible = false;
      this.root.add(mesh);
      this.groundFires.push({ mesh, mat, age: 0, life: 5.5, active: false });
    }
  }

  public spawnSmokePuff(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    startScale: number,
    endScale: number,
    life: number,
    heat: number,
  ): void {
    const idx = this.smokeCursor % this.maxSmoke;
    this.smokeCursor++;
    const p = this.smokePuffs[idx];
    p.active = true;
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.age = 0;
    p.life = life;
    p.startScale = startScale;
    p.endScale = endScale;
    p.heat = heat;
  }

  /**
   * Triggers a full 10-layer coordinated AAA cinematic explosion at `origin`.
   */
  public triggerExplosion(
    origin: THREE.Vector3,
    scale: number,
    rainAndSparks: RainAndSpraySystem,
    playerPos: THREE.Vector3,
    onTrauma?: (trauma: number) => void,
  ): void {
    // Pick free or oldest explosion slot
    let slot = this.explosions.find((e) => !e.active);
    if (!slot) {
      slot = this.explosions.reduce((a, b) => (a.age > b.age ? a : b));
    }

    slot.active = true;
    slot.origin.copy(origin);
    slot.origin.y = Math.max(0.6, origin.y);
    slot.age = 0;
    slot.scale = scale;
    slot.duration = 1.65 + scale * 0.45;

    // 1. Instant Core Flash & Controlled Exposure Spike (clamped at close range so camera never whites out!)
    const distToPlayer = origin.distanceTo(playerPos);
    const closeClamp = THREE.MathUtils.smoothstep(distToPlayer, 2.0, 18.0);
    slot.flashSprite.visible = closeClamp > 0.08;
    slot.flashSprite.position.copy(slot.origin).add(new THREE.Vector3(0, 0.8 * scale, 0));
    slot.flashSprite.scale.setScalar(8.5 * scale * (0.35 + 0.65 * closeClamp));

    const distAtten = THREE.MathUtils.clamp(1.0 - distToPlayer / 135.0, 0, 1);
    this.flashPulse = Math.min(0.24, Math.max(this.flashPulse, 0.22 * scale * distAtten * distAtten));

    // 2. Coordinated Multi-Lobe Volumetric Fireballs
    for (let i = 0; i < slot.lobes.length; i++) {
      const lobe = slot.lobes[i];
      lobe.mesh.visible = false;
      lobe.delay = i === 0 ? 0 : 0.035 * i + Math.random() * 0.04;
      const ang = (i / slot.lobes.length) * Math.PI * 2 + Math.random() * 0.5;
      const rad = i === 0 ? 0 : (0.8 + Math.random() * 1.1) * scale;
      lobe.offset.set(Math.cos(ang) * rad, (i === 0 ? 0.5 : 0.9 + Math.random() * 1.2) * scale, Math.sin(ang) * rad);
      lobe.vel.set(Math.cos(ang) * 2.2 * scale, (3.2 + Math.random() * 2.8) * scale, Math.sin(ang) * 2.2 * scale);
      lobe.baseRadius = (i === 0 ? 2.45 : 1.55 + Math.random() * 0.7) * scale;
    }

    // 3. Shockwave Ring & 3D Pressure Shell
    slot.shockRing.visible = true;
    slot.shockRing.position.set(origin.x, 0.08, origin.z);
    slot.shockRing.scale.setScalar(0.5);
    slot.shockSphere.visible = true;
    slot.shockSphere.position.copy(slot.origin);
    slot.shockSphere.scale.setScalar(0.5);

    // 4 & 8. Multi-layered Billowing Plume Smoke & Lingering Rising Smoke Column
    const smokeCount = Math.round(18 * scale);
    for (let s = 0; s < smokeCount; s++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 2.2 * scale;
      this.spawnSmokePuff(
        new THREE.Vector3(origin.x + Math.cos(a) * r, 0.7 + Math.random() * 1.8 * scale, origin.z + Math.sin(a) * r),
        new THREE.Vector3(Math.cos(a) * (1.5 + Math.random() * 2.8), 3.2 + Math.random() * 4.8 * scale, Math.sin(a) * (1.5 + Math.random() * 2.8)),
        (1.6 + Math.random() * 1.2) * scale,
        (5.5 + Math.random() * 4.2) * scale,
        2.6 + Math.random() * 2.4,
        1.0,
      );
    }

    // 5. Hot Ballistic Sparks bouncing across wet asphalt
    rainAndSparks.emitSparks(slot.origin, Math.round(42 * scale), 0, 15.5 * scale);

    // 6. Varying-Size 3D Flying Debris Chunks (panels, struts, burning parts)
    const numDebris = Math.min(28, Math.round(16 * scale));
    for (let d = 0; d < numDebris; d++) {
      const idx = this.debrisCursor % this.maxDebris;
      this.debrisCursor++;
      const ch = this.debrisChunks[idx];
      ch.active = true;
      ch.age = 0;
      ch.life = 2.4 + Math.random() * 1.8;
      ch.smokeTimer = 0;
      ch.pos.copy(slot.origin).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.4 + Math.random() * 1.0, (Math.random() - 0.5) * 1.5));
      const ang = Math.random() * Math.PI * 2;
      const spd = (7.5 + Math.random() * 15.0) * scale;
      ch.vel.set(Math.cos(ang) * spd, (6.5 + Math.random() * 11.5) * scale, Math.sin(ang) * spd);
      ch.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      ch.angVel.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      // Vary chunk shapes from flat hood/door panels to chunky mechanical blocks!
      if (d % 3 === 0) {
        ch.scale.set(1.6 + Math.random(), 0.22, 1.3 + Math.random());
      } else {
        const s = 0.45 + Math.random() * 0.95;
        ch.scale.set(s, s * 0.7, s * 1.1);
      }
    }

    // 7. Environmental PointLight
    slot.light.visible = true;
    slot.light.position.set(origin.x, origin.y + 2.4 * scale, origin.z);
    slot.light.intensity = 280 * scale;

    // 8b. Burning Ground Fuel Patches on Wet Asphalt
    const patchCount = Math.min(3, Math.max(1, Math.round(scale * 1.6)));
    for (let p = 0; p < patchCount; p++) {
      const gf = this.groundFires[this.fireCursor % this.groundFires.length];
      this.fireCursor++;
      gf.active = true;
      gf.age = 0;
      gf.life = 4.5 + Math.random() * 2.5;
      gf.mesh.visible = true;
      gf.mesh.position.set(
        origin.x + (Math.random() - 0.5) * 3.5 * scale,
        0.05,
        origin.z + (Math.random() - 0.5) * 3.5 * scale,
      );
      const fs = (2.8 + Math.random() * 2.6) * scale;
      gf.mesh.scale.set(fs, 1, fs * 1.35);
    }

    // 9. Distance-attenuated Camera Trauma
    if (onTrauma && distAtten > 0.02) {
      onTrauma(THREE.MathUtils.clamp(distAtten * 0.82 * scale, 0.08, 0.92));
    }
  }

  public applyRebase(deltaZ: number): void {
    for (const ex of this.explosions) {
      if (ex.active) {
        ex.origin.z += deltaZ;
        ex.flashSprite.position.z += deltaZ;
        ex.shockRing.position.z += deltaZ;
        ex.shockSphere.position.z += deltaZ;
        ex.light.position.z += deltaZ;
      }
    }
    for (const s of this.smokePuffs) {
      if (s.active) s.pos.z += deltaZ;
    }
    for (const d of this.debrisChunks) {
      if (d.active) d.pos.z += deltaZ;
    }
    for (const gf of this.groundFires) {
      if (gf.active) gf.mesh.position.z += deltaZ;
    }
  }

  public update(dt: number, time: number, camera: THREE.Camera): void {
    this.flashPulse = Math.max(0, this.flashPulse - 2.8 * dt);
    this.latestBlastLight.set(0, -100, 0, 0);

    // 1. Update Active Explosions
    for (const ex of this.explosions) {
      if (!ex.active) continue;
      ex.age += dt;
      const norm = ex.age / ex.duration;

      if (norm >= 1.0) {
        ex.active = false;
        ex.flashSprite.visible = false;
        ex.shockRing.visible = false;
        ex.shockSphere.visible = false;
        ex.light.visible = false;
        for (const l of ex.lobes) l.mesh.visible = false;
        continue;
      }

      // Blinding core flash decays in first 0.12s (compact core so it never creates a flat circular halo)
      if (ex.age < 0.12) {
        const f = 1.0 - ex.age / 0.12;
        ex.flashSprite.visible = true;
        ex.flashSprite.quaternion.copy(camera.quaternion);
        ex.flashSprite.scale.setScalar((2.6 + f * 4.2) * ex.scale);
        ex.flashMat.opacity = f * 0.85;
      } else {
        ex.flashSprite.visible = false;
      }

      // Ground Mach vapor shockwave ring: ultra-fast transient (0.18s) so slow-mo frames show pure fire, smoke & debris!
      if (ex.age < 0.18) {
        const st = ex.age / 0.18;
        const rad = (1.5 + Math.pow(st, 0.55) * 14.0) * ex.scale;
        ex.shockRing.visible = true;
        ex.shockRing.scale.setScalar(rad);
        ex.shockMat.uniforms.uAlpha.value = (1.0 - st) * (1.0 - st) * 0.38;
      } else {
        ex.shockRing.visible = false;
      }

      ex.shockSphere.visible = false;

      // Volumetric Fireball Lobes
      for (const lobe of ex.lobes) {
        const lt = ex.age - lobe.delay;
        if (lt < 0) {
          lobe.mesh.visible = false;
          continue;
        }
        const lp = THREE.MathUtils.clamp(lt / (ex.duration * 0.85), 0, 1);
        if (lp >= 1.0) {
          lobe.mesh.visible = false;
          continue;
        }
        lobe.mesh.visible = true;
        const expand = Math.pow(lp, 0.36) * 1.85;
        lobe.mesh.scale.setScalar(lobe.baseRadius * (0.45 + expand));
        lobe.mesh.position.set(
          ex.origin.x + lobe.offset.x + lobe.vel.x * lt * 0.45,
          ex.origin.y + lobe.offset.y + lobe.vel.y * lt * 0.55,
          ex.origin.z + lobe.offset.z + lobe.vel.z * lt * 0.45,
        );
        lobe.mat.uniforms.uTime.value = time;
        lobe.mat.uniforms.uProgress.value = lp;
      }

      // Environmental PointLight with turbulent flame flicker
      const lightDecay = Math.pow(1.0 - norm, 1.85);
      const flicker = 0.82 + 0.18 * Math.sin(time * 38.0 + ex.origin.z);
      ex.light.intensity = 290 * ex.scale * lightDecay * flicker;
      ex.light.position.y = ex.origin.y + (2.0 + norm * 3.5) * ex.scale;

      if (ex.light.intensity > this.latestBlastLight.w * 80) {
        this.latestBlastLight.set(ex.origin.x, ex.origin.y + 2.0, ex.origin.z, lightDecay * ex.scale * 2.5);
      }
    }

    // 2. Update Multi-Layer Smoke Plumes
    this.smokeMat.uniforms.uTime.value = time;
    const heatArr = (this.smokeMesh.geometry.getAttribute('aHeat') as THREE.InstancedBufferAttribute).array as Float32Array;
    const alphaArr = (this.smokeMesh.geometry.getAttribute('aAlpha') as THREE.InstancedBufferAttribute).array as Float32Array;

    for (let i = 0; i < this.maxSmoke; i++) {
      const p = this.smokePuffs[i];
      if (!p.active) {
        alphaArr[i] = 0;
        continue;
      }
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        alphaArr[i] = 0;
        this.dummy.position.set(0, -100, 0);
        this.dummy.scale.setScalar(0.001);
        this.dummy.updateMatrix();
        this.smokeMesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }

      const t = p.age / p.life;
      p.vel.x *= Math.exp(-1.4 * dt);
      p.vel.z *= Math.exp(-1.4 * dt);
      p.vel.y = Math.max(1.4, p.vel.y * Math.exp(-0.65 * dt));
      p.pos.addScaledVector(p.vel, dt);

      const sc = THREE.MathUtils.lerp(p.startScale, p.endScale, Math.pow(t, 0.65));
      this.dummy.position.copy(p.pos);
      this.dummy.quaternion.copy(camera.quaternion);
      this.dummy.scale.setScalar(sc);
      this.dummy.updateMatrix();
      this.smokeMesh.setMatrixAt(i, this.dummy.matrix);

      heatArr[i] = p.heat * Math.pow(1.0 - Math.min(1.0, t * 1.65), 2.0);
      alphaArr[i] = Math.sin(Math.min(1.0, t * 4.5) * Math.PI * 0.5) * (1.0 - Math.pow(t, 1.45)) * 0.68;
    }
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    (this.smokeMesh.geometry.getAttribute('aHeat') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (this.smokeMesh.geometry.getAttribute('aAlpha') as THREE.InstancedBufferAttribute).needsUpdate = true;

    // 3. Update Tumbling 3D Debris Chunks (with wet asphalt bounce & trailing smoke!)
    for (let i = 0; i < this.maxDebris; i++) {
      const d = this.debrisChunks[i];
      if (!d.active) continue;
      d.age += dt;
      if (d.age >= d.life) {
        d.active = false;
        this.dummy.position.set(0, -100, 0);
        this.dummy.scale.setScalar(0.001);
        this.dummy.updateMatrix();
        this.debrisMesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }

      d.vel.y -= 17.5 * dt;
      d.pos.addScaledVector(d.vel, dt);
      if (d.pos.y < 0.14) {
        d.pos.y = 0.14;
        d.vel.y = Math.abs(d.vel.y) * 0.38;
        d.vel.x *= 0.74;
        d.vel.z *= 0.74;
        d.angVel.multiplyScalar(0.75);
      }

      d.rot.x += d.angVel.x * dt;
      d.rot.y += d.angVel.y * dt;
      d.rot.z += d.angVel.z * dt;

      d.smokeTimer += dt;
      if (d.smokeTimer > 0.09 && d.age < 1.3 && d.pos.y > 0.35) {
        d.smokeTimer = 0;
        this.spawnSmokePuff(
          d.pos,
          new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.2, (Math.random() - 0.5) * 0.6),
          0.45,
          1.65,
          1.1,
          0.45,
        );
      }

      const fade = 1.0 - THREE.MathUtils.smoothstep(d.age / d.life, 0.75, 1.0);
      this.dummy.position.copy(d.pos);
      this.dummy.rotation.copy(d.rot);
      this.dummy.scale.copy(d.scale).multiplyScalar(fade);
      this.dummy.updateMatrix();
      this.debrisMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.debrisMesh.instanceMatrix.needsUpdate = true;

    // 4. Update Lingering Burning Ground Fuel Patches & Rising Aftermath Smoke
    for (const gf of this.groundFires) {
      if (!gf.active) continue;
      gf.age += dt;
      if (gf.age >= gf.life) {
        gf.active = false;
        gf.mesh.visible = false;
        continue;
      }
      gf.mat.uniforms.uTime.value = time;
      gf.mat.uniforms.uFade.value = (1.0 - gf.age / gf.life) * 0.75;
      if (Math.random() < dt * 4.5) {
        this.spawnSmokePuff(
          new THREE.Vector3(gf.mesh.position.x + (Math.random() - 0.5) * 1.2, 0.35, gf.mesh.position.z + (Math.random() - 0.5) * 1.2),
          new THREE.Vector3((Math.random() - 0.5) * 0.8, 2.6 + Math.random() * 1.4, (Math.random() - 0.5) * 0.8),
          0.85,
          3.4,
          2.2,
          0.35,
        );
      }
    }
  }

  public reset(): void {
    this.flashPulse = 0;
    for (const ex of this.explosions) {
      ex.active = false;
      ex.flashSprite.visible = false;
      ex.shockRing.visible = false;
      ex.shockSphere.visible = false;
      ex.light.visible = false;
      for (const l of ex.lobes) l.mesh.visible = false;
    }
    for (const s of this.smokePuffs) s.active = false;
    for (const d of this.debrisChunks) d.active = false;
    for (const gf of this.groundFires) {
      gf.active = false;
      gf.mesh.visible = false;
    }
  }
}
