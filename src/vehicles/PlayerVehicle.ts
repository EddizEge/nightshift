import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { VehicleInputState } from '../core/InputManager';
import { HIGHWAY_HALF_WIDTH } from '../world/HighwayManager';

interface WheelRig {
  knuckle: THREE.Object3D;
  spinParts: THREE.Object3D[];
  isFront: boolean;
}

const NITRO_FLAME_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewPos;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = -mv.xyz;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`;

const NITRO_FLAME_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewPos;

void main() {
  // vUv.y: 1.0 at exhaust nozzle -> 0.0 at flame tip
  float along = 1.0 - vUv.y;
  float env = smoothstep(0.0, 0.08, along) * pow(max(0.0, 1.0 - along), 1.65);

  // Supersonic Mach shock-diamonds pulsing along exhaust plume
  float diamonds = 0.55 + 0.45 * pow(max(0.0, sin(along * 26.0 - uTime * 48.0 + uSeed)), 2.0);
  float rim = pow(abs(dot(normalize(vNormalV), normalize(vViewPos))), 1.75);

  vec3 outerPlasma = vec3(0.22, 0.58, 2.8);
  vec3 innerCore = vec3(2.4, 4.2, 6.8);
  vec3 col = mix(outerPlasma, innerCore, rim * diamonds);

  float alpha = env * rim * (0.55 + 0.45 * diamonds);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

export class PlayerVehicle {
  public readonly root = new THREE.Group();
  public readonly chassisTiltGroup = new THREE.Group();
  private readonly modelPivot = new THREE.Group();

  // Simcade Physics State
  public readonly position = new THREE.Vector3(1.9, 0, 0);
  public readonly velocity = new THREE.Vector3(0, 0, 0);
  public heading = 0;
  public yawRate = 0;
  public steerAngle = 0;
  public slipRatio = 0;

  // Powertrain & Nitro
  public speedMps = 0;
  public speedKmh = 0;
  public gear = 1;
  public rpm = 1000;
  public nitroCharge = 100;
  public isNitroActive = false;
  public isBraking = false;

  // Chassis Health / Damage
  public integrity = 100;
  public isWrecked = false;

  public readonly halfWidth = 0.96;
  public readonly halfLength = 2.26;

  private wheels: WheelRig[] = [];
  private steeringWheelNode: THREE.Object3D | null = null;
  private wheelSpinAngle = 0;

  private brakeLightMats: THREE.MeshStandardMaterial[] = [];
  private brakeDiscMats: THREE.MeshStandardMaterial[] = [];
  private brakePointLight!: THREE.PointLight;
  private nitroPointLight!: THREE.PointLight;
  private nitroFlames: Array<{ mesh: THREE.Mesh; mat: THREE.ShaderMaterial }> = [];
  public readonly headlightSpots: THREE.SpotLight[] = [];

  private pitchAngle = 0;
  private rollAngle = 0;
  public heaveOffset = 0;
  private heaveVel = 0;
  private prevForwardSpeed = 0;
  private barrierScrapeCooldown = 0;

  constructor(carGltf: GLTF, envMap: THREE.Texture) {
    this.root.add(this.chassisTiltGroup);
    this.chassisTiltGroup.add(this.modelPivot);

    const carScene = carGltf.scene;
    this.modelPivot.rotation.y = Math.PI;
    this.modelPivot.add(carScene);

    this.setupMaterialsAndHierarchy(carScene, envMap);
    this.setupContactShadow();
    this.setupVehicleLightsAndExhaust();

    this.root.position.copy(this.position);
  }

  private setupMaterialsAndHierarchy(carScene: THREE.Group, envMap: THREE.Texture): void {
    const wheelNodeNames = [
      { name: 'WheelFrontL', isFront: true },
      { name: 'WheelFrontR', isFront: true },
      { name: 'WheelRearL', isFront: false },
      { name: 'WheelRearR', isFront: false },
    ];

    carScene.traverse((obj) => {
      if (obj.name === 'InteriorSteeringCylinder') {
        this.steeringWheelNode = obj;
      }

      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          const std = m as THREE.MeshPhysicalMaterial;
          if (!std) continue;
          std.envMap = envMap;

          if (std.name === 'Paint 1 Carmine' || std.name?.startsWith('Paint 1')) {
            // Rich, deep Midnight Crimson-Obsidian Metallic Clearcoat (never washed-out coral!)
            std.color.setRGB(0.14, 0.010, 0.017);
            std.metalness = 0.88;
            std.roughness = 0.22;
            std.envMapIntensity = 1.45;
            if ('clearcoat' in std) {
              std.clearcoat = 1.0;
              std.clearcoatRoughness = 0.06;
            }
          } else if (std.name === 'Paint 2 Carmine' || std.name?.startsWith('Paint 2')) {
            // Sleek dark Forged Carbon / Satin Gunmetal lower aero diffuser & side skirts
            std.color.setRGB(0.035, 0.038, 0.045);
            std.metalness = 0.72;
            std.roughness = 0.28;
            std.envMapIntensity = 1.25;
            if ('clearcoat' in std) {
              std.clearcoat = 0.7;
              std.clearcoatRoughness = 0.08;
            }
          } else if (std.name === 'Tireside' || std.name === 'Tiretread') {
            // Pure unbranded dark wet performance rubber (removes sample white tire sidewall text!)
            std.map = null;
            std.color.setRGB(0.022, 0.024, 0.028);
            std.metalness = 0.05;
            std.roughness = 0.62;
            std.envMapIntensity = 0.75;
            std.needsUpdate = true;
          } else if (std.name === 'Glass') {
            std.envMapIntensity = 2.15;
            std.roughness = 0.03;
            if ('transmission' in std) {
              std.transmission = 0.35;
            }
            std.color.setHex(0x060a10);
          } else if (std.name === 'Brakelight') {
            // Razor-sharp glowing ruby LED tail-light blades!
            std.color.setHex(0x220002);
            std.emissive = new THREE.Color(0xff0d1a);
            std.emissiveIntensity = 9.5;
            if (!this.brakeLightMats.includes(std)) {
              this.brakeLightMats.push(std);
            }
          } else if (std.name === 'Signallight') {
            std.emissive = new THREE.Color(0xff5500);
            std.emissiveIntensity = 2.2;
          } else if (std.name === 'Headlight') {
            std.emissive = new THREE.Color(0xdbeeff);
            std.emissiveIntensity = 8.5;
          } else if (std.name === 'Disc') {
            std.emissive = new THREE.Color(0xff3b0a);
            std.emissiveIntensity = 0.0;
            if (!this.brakeDiscMats.includes(std)) {
              this.brakeDiscMats.push(std);
            }
          } else if (std.name?.includes('Rim')) {
            std.color.setRGB(0.58, 0.62, 0.68);
            std.envMapIntensity = 1.65;
            std.metalness = 0.94;
            std.roughness = 0.16;
          } else {
            std.envMapIntensity = 1.05;
          }
        }
      }
    });

    for (const spec of wheelNodeNames) {
      const knuckle = carScene.getObjectByName(spec.name);
      if (!knuckle) continue;
      const spinParts: THREE.Object3D[] = [];
      for (const child of knuckle.children) {
        if (!child.name.includes('BrakePad')) {
          spinParts.push(child);
        }
      }
      this.wheels.push({ knuckle, spinParts, isFront: spec.isFront });
    }
  }

  private setupContactShadow(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(128, 256, 18, 128, 256, 124);
    grad.addColorStop(0.0, 'rgba(0, 0, 0, 0.96)');
    grad.addColorStop(0.64, 'rgba(0, 0, 0, 0.78)');
    grad.addColorStop(0.88, 'rgba(0, 0, 0, 0.28)');
    grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
    ctx.fillStyle = grad;
    ctx.save();
    ctx.scale(1.0, 1.95);
    ctx.beginPath();
    ctx.arc(128, 131, 122, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      opacity: 0.92,
    });
    const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(2.48, 5.2), mat);
    shadowPlane.rotation.x = -Math.PI * 0.5;
    shadowPlane.position.set(0, 0.018, 0.12);
    this.root.add(shadowPlane);
  }

  private setupVehicleLightsAndExhaust(): void {
    for (const sx of [-0.68, 0.68]) {
      const spot = new THREE.SpotLight(0xdcecff, 95, 145, Math.PI * 0.21, 0.58, 1.32);
      spot.position.set(sx, 0.68, -2.18);
      spot.target.position.set(sx * 0.85, 0.05, -38.0);
      spot.castShadow = false;
      this.chassisTiltGroup.add(spot);
      this.chassisTiltGroup.add(spot.target);
      this.headlightSpots.push(spot);

      const coneGeo = new THREE.ConeGeometry(2.35, 19.0, 20, 1, true);
      coneGeo.translate(0, -9.5, 0);
      coneGeo.rotateX(Math.PI * 0.5);
      const coneMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uColor: { value: new THREE.Color(0x9ec8ff) } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vNormalV;
          varying vec3 vViewPos;
          void main() {
            vUv = uv;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vViewPos = -mv.xyz;
            vNormalV = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          varying vec2 vUv;
          varying vec3 vNormalV;
          varying vec3 vViewPos;
          void main() {
            float along = 1.0 - vUv.y;
            float fade = pow(along, 2.2) * smoothstep(0.0, 0.12, along);
            float rim = pow(abs(dot(normalize(vNormalV), normalize(vViewPos))), 1.4);
            gl_FragColor = vec4(uColor, fade * rim * 0.09);
          }
        `,
      });
      const beamMesh = new THREE.Mesh(coneGeo, coneMat);
      beamMesh.position.set(sx, 0.64, -2.22);
      beamMesh.rotation.x = -0.032;
      this.chassisTiltGroup.add(beamMesh);
    }

    // Positioned low beneath diffuser so it paints the wet road crimson WITHOUT creating a white dot on the rear bumper!
    this.brakePointLight = new THREE.PointLight(0xff0e1e, 1.15, 7.5, 1.85);
    this.brakePointLight.position.set(0, 0.14, 2.52);
    this.chassisTiltGroup.add(this.brakePointLight);

    // Custom Twin Shock-Diamond Plasma Exhaust Plumes
    this.nitroPointLight = new THREE.PointLight(0x3898ff, 0.0, 12.0, 1.65);
    this.nitroPointLight.position.set(0, 0.36, 2.85);
    this.chassisTiltGroup.add(this.nitroPointLight);

    const flameGeo = new THREE.CylinderGeometry(0.045, 0.115, 1.55, 16, 8, true);
    flameGeo.translate(0, -0.775, 0);
    flameGeo.rotateX(-Math.PI * 0.5);

    for (let i = 0; i < 2; i++) {
      const ex = i === 0 ? -0.44 : 0.44;
      const mat = new THREE.ShaderMaterial({
        vertexShader: NITRO_FLAME_VERT,
        fragmentShader: NITRO_FLAME_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: { value: 0 },
          uSeed: { value: i * 2.1 },
        },
      });
      const mesh = new THREE.Mesh(flameGeo, mat);
      mesh.position.set(ex, 0.33, 2.14);
      mesh.visible = false;
      this.chassisTiltGroup.add(mesh);
      this.nitroFlames.push({ mesh, mat });
    }
  }

  public update(
    dt: number,
    time: number,
    input: VehicleInputState,
    onBarrierScrape?: (contactPos: THREE.Vector3, intensity: number) => void,
  ): void {
    this.barrierScrapeCooldown = Math.max(0, this.barrierScrapeCooldown - dt);

    if (this.isWrecked) {
      this.velocity.multiplyScalar(Math.exp(-2.2 * dt));
      this.position.addScaledVector(this.velocity, dt);
      this.position.x = THREE.MathUtils.clamp(
        this.position.x,
        -(HIGHWAY_HALF_WIDTH - this.halfWidth),
        HIGHWAY_HALF_WIDTH - this.halfWidth,
      );
      this.speedMps = this.velocity.length();
      this.speedKmh = this.speedMps * 3.6;
      this.isNitroActive = false;
      for (const f of this.nitroFlames) f.mesh.visible = false;
      this.nitroPointLight.intensity = 0;
      this.root.position.copy(this.position);
      this.root.rotation.y = this.heading;
      return;
    }

    const sinH = Math.sin(this.heading);
    const cosH = Math.cos(this.heading);
    const fwdX = -sinH;
    const fwdZ = -cosH;
    const rightX = cosH;
    const rightZ = -sinH;

    let vForward = this.velocity.x * fwdX + this.velocity.z * fwdZ;
    let vLateral = this.velocity.x * rightX + this.velocity.z * rightZ;

    // 1. Nitro activation
    const canNitro = this.nitroCharge > 4.0 && input.throttle > 0.1 && vForward > 8.0 && !input.handbrake;
    this.isNitroActive = input.nitro && canNitro;
    if (this.isNitroActive) {
      this.nitroCharge = Math.max(0, this.nitroCharge - 23.0 * dt);
    } else {
      const speedBonus = THREE.MathUtils.clamp(vForward / 68.0, 0.25, 1.4);
      this.nitroCharge = Math.min(100, this.nitroCharge + 4.4 * speedBonus * dt);
    }

    // 2. Longitudinal Powertrain
    const maxSpeedNormal = 80.5; // ~290 km/h
    const maxSpeedNitro = 97.5;  // ~351 km/h
    const topCap = this.isNitroActive ? maxSpeedNitro : maxSpeedNormal;

    let accel = 0;
    this.isBraking = false;

    if (input.throttle > 0) {
      const speedRatio = THREE.MathUtils.clamp(vForward / topCap, 0, 1.15);
      const torqueCurve = Math.max(0.14, 1.0 - Math.pow(speedRatio, 1.88));
      accel += input.throttle * (this.isNitroActive ? 30.5 : 18.4) * torqueCurve;
    }

    if (input.brake > 0) {
      if (vForward > 1.2) {
        this.isBraking = true;
        accel -= input.brake * 32.0;
      } else {
        accel -= input.brake * 10.5;
      }
    }

    if (input.handbrake && Math.abs(vForward) > 0.5) {
      this.isBraking = true;
      accel -= Math.sign(vForward) * 14.5;
    }

    const aeroDrag = 0.0023 * vForward * Math.abs(vForward) + 0.15 * vForward;
    vForward += (accel - aeroDrag) * dt;
    vForward = THREE.MathUtils.clamp(vForward, -13.0, maxSpeedNitro + 4.0);

    // 3. Precision Simcade Steering (crisp lane changes, natural self-alignment on release)
    const absSpeed = Math.abs(vForward);
    const steerRate = input.steer !== 0 ? 8.8 : 13.5;
    this.steerAngle = THREE.MathUtils.lerp(this.steerAngle, input.steer, 1.0 - Math.exp(-steerRate * dt));

    const speedSteerAtten = 1.0 / (1.0 + Math.pow(absSpeed / 46.0, 1.38));
    const lowSpeedFactor = THREE.MathUtils.smoothstep(absSpeed, 0.4, 5.5);
    const handbrakeYawBoost = input.handbrake ? 1.52 : 1.0;

    const reverseSign = vForward >= -0.2 ? 1.0 : -1.0;
    const targetYawRate = -this.steerAngle * reverseSign * (1.92 * speedSteerAtten + 0.34) * lowSpeedFactor * handbrakeYawBoost;
    this.yawRate = THREE.MathUtils.lerp(this.yawRate, targetYawRate, 1.0 - Math.exp(-13.0 * dt));

    const maxSafeHeading = input.handbrake ? 0.62 : 0.36;
    this.heading += this.yawRate * dt;
    if (Math.abs(input.steer) < 0.05 && !input.handbrake && absSpeed > 6.0) {
      // Crisp highway caster return so releasing A/D straightens smoothly down the lane!
      this.heading *= Math.exp(-2.6 * dt);
    }
    this.heading = THREE.MathUtils.clamp(this.heading, -maxSafeHeading, maxSafeHeading);

    const centrifugalSlip = -this.yawRate * vForward * (input.handbrake ? 0.34 : 0.095);
    vLateral += centrifugalSlip * dt;
    const wetLateralGrip = input.handbrake ? 3.2 : 10.6;
    vLateral *= Math.exp(-wetLateralGrip * dt);

    this.slipRatio = THREE.MathUtils.clamp(
      (Math.abs(vLateral) / 7.2) + (input.handbrake && absSpeed > 12 ? 0.65 : 0),
      0,
      1,
    );

    const nSin = Math.sin(this.heading);
    const nCos = Math.cos(this.heading);
    this.velocity.set(
      vForward * (-nSin) + vLateral * nCos,
      0,
      vForward * (-nCos) + vLateral * (-nSin),
    );

    this.position.addScaledVector(this.velocity, dt);

    // 4. Barrier Collision & Scrape Response
    const limitX = HIGHWAY_HALF_WIDTH - this.halfWidth;
    if (Math.abs(this.position.x) > limitX) {
      const side = Math.sign(this.position.x);
      const penetration = Math.abs(this.position.x) - limitX;
      this.position.x = side * limitX;

      const lateralImpactSpeed = Math.abs(this.velocity.x);
      this.velocity.x = -side * Math.max(2.0, lateralImpactSpeed * 0.35);
      this.heading *= 0.35;
      this.yawRate *= 0.2;

      if (absSpeed > 8.0 && this.barrierScrapeCooldown <= 0) {
        this.barrierScrapeCooldown = 0.14;
        const hitIntensity = THREE.MathUtils.clamp(lateralImpactSpeed / 14.0 + penetration * 0.5, 0.2, 1.0);
        this.applyDamage(hitIntensity * 5.0);
        if (onBarrierScrape) {
          onBarrierScrape(
            new THREE.Vector3(this.position.x + side * this.halfWidth, 0.48, this.position.z - 0.3),
            hitIntensity,
          );
        }
      }
    }

    this.speedMps = this.velocity.length();
    this.speedKmh = Math.max(0, vForward * 3.6);

    // 5. 6-Speed Gearbox & Live RPM
    const gearTopSpeedsKmh = [58, 104, 152, 202, 254, 352];
    let g = 1;
    for (let i = 0; i < gearTopSpeedsKmh.length; i++) {
      if (this.speedKmh <= gearTopSpeedsKmh[i] || i === gearTopSpeedsKmh.length - 1) {
        g = i + 1;
        break;
      }
    }
    this.gear = vForward < -0.5 ? 0 : g;
    const prevTop = g > 1 ? gearTopSpeedsKmh[g - 2] * 0.72 : 0;
    const currTop = gearTopSpeedsKmh[g - 1];
    const gearSpan = Math.max(1, currTop - prevTop);
    const targetRpm = 1150 + THREE.MathUtils.clamp((this.speedKmh - prevTop) / gearSpan, 0, 1) * 6950
                    + (this.isNitroActive ? 450 : 0);
    this.rpm = THREE.MathUtils.lerp(this.rpm, targetRpm, 1.0 - Math.exp(-14.0 * dt));

    // 6. Visual Suspension Weight Transfer
    const longAccel = (vForward - this.prevForwardSpeed) / Math.max(dt, 0.001);
    this.prevForwardSpeed = vForward;

    const targetPitch = THREE.MathUtils.clamp(longAccel * 0.0014, -0.035, 0.030);
    const targetRoll = THREE.MathUtils.clamp(this.steerAngle * (absSpeed / 65.0) * 0.042, -0.046, 0.046);
    this.pitchAngle = THREE.MathUtils.lerp(this.pitchAngle, targetPitch, 1.0 - Math.exp(-9.0 * dt));
    this.rollAngle = THREE.MathUtils.lerp(this.rollAngle, targetRoll, 1.0 - Math.exp(-10.0 * dt));

    const jointPhase = Math.abs(((this.position.z % 40) + 40) % 40 - 20);
    if (jointPhase < 0.45 && absSpeed > 12) {
      this.heaveVel += 0.14 * (absSpeed / 60);
    }
    const springForce = -140.0 * this.heaveOffset - 16.0 * this.heaveVel;
    this.heaveVel += springForce * dt;
    this.heaveOffset = THREE.MathUtils.clamp(this.heaveOffset + this.heaveVel * dt, -0.038, 0.038);

    this.chassisTiltGroup.position.y = this.heaveOffset;
    this.chassisTiltGroup.rotation.set(this.pitchAngle, 0, this.rollAngle);

    // 7. Wheels & Steering Wheel
    const wheelRadius = 0.361;
    this.wheelSpinAngle += (vForward / wheelRadius) * dt;
    const visualFrontSteer = -this.steerAngle * 0.44;

    for (const w of this.wheels) {
      if (w.isFront) {
        w.knuckle.rotation.set(0, 0, visualFrontSteer);
      }
      for (const part of w.spinParts) {
        part.rotation.x = this.wheelSpinAngle;
      }
    }

    if (this.steeringWheelNode) {
      this.steeringWheelNode.rotation.y = this.steerAngle * 1.35;
    }

    // 8. Dynamic Taillight Blades, Brake Glow & Supersonic Shock-Diamond Nitro
    const brakeGlow = this.isBraking ? 24.0 : 9.5;
    for (const bm of this.brakeLightMats) {
      bm.emissiveIntensity = THREE.MathUtils.lerp(bm.emissiveIntensity, brakeGlow, 1.0 - Math.exp(-18.0 * dt));
    }
    this.brakePointLight.intensity = this.isBraking ? 5.8 : 1.15;

    const rotorHeatTarget = this.isBraking && this.speedKmh > 120 ? 3.4 : 0.0;
    for (const dm of this.brakeDiscMats) {
      dm.emissiveIntensity = THREE.MathUtils.lerp(dm.emissiveIntensity, rotorHeatTarget, 1.0 - Math.exp(-5.0 * dt));
    }

    for (let i = 0; i < this.nitroFlames.length; i++) {
      const nf = this.nitroFlames[i];
      nf.mesh.visible = this.isNitroActive;
      if (this.isNitroActive) {
        nf.mat.uniforms.uTime.value = time;
        const lenScale = 0.92 + 0.24 * Math.sin(time * 54.0 + i * 1.9);
        nf.mesh.scale.set(1.0, 1.0, lenScale);
      }
    }
    this.nitroPointLight.intensity = this.isNitroActive ? 14.0 + Math.sin(time * 42.0) * 3.0 : 0.0;

    this.root.position.copy(this.position);
    this.root.rotation.y = this.heading;
  }

  public applyDamage(amount: number): boolean {
    if (this.isWrecked) return true;
    this.integrity = Math.max(0, this.integrity - amount);
    if (this.integrity <= 0.01) {
      this.integrity = 0;
      this.isWrecked = true;
      return true;
    }
    return false;
  }

  public applyRebase(deltaZ: number): void {
    this.position.z += deltaZ;
    this.root.position.z = this.position.z;
  }

  public reset(): void {
    this.position.set(1.9, 0, 0);
    this.velocity.set(0, 0, -26.0);
    this.heading = 0;
    this.yawRate = 0;
    this.steerAngle = 0;
    this.slipRatio = 0;
    this.speedMps = 26.0;
    this.speedKmh = 93.6;
    this.gear = 2;
    this.rpm = 3400;
    this.nitroCharge = 100;
    this.isNitroActive = false;
    this.isBraking = false;
    this.integrity = 100;
    this.isWrecked = false;
    this.pitchAngle = 0;
    this.rollAngle = 0;
    this.heaveOffset = 0;
    this.heaveVel = 0;
    this.prevForwardSpeed = 26.0;
    this.root.position.copy(this.position);
    this.root.rotation.set(0, 0, 0);
    this.chassisTiltGroup.rotation.set(0, 0, 0);
  }
}
