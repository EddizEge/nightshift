import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { HIGHWAY_HALF_WIDTH, HIGHWAY_LANES } from '../world/HighwayManager';
import type { LoadedGameAssets } from '../core/AssetLoader';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { PlayerVehicle } from '../vehicles/PlayerVehicle';
import type { RainAndSpraySystem } from '../vfx/RainAndSpraySystem';
import type { ExplosionSystem } from '../vfx/ExplosionSystem';

export type TrafficKind = 'SEDAN' | 'SUV' | 'TRUCK' | 'TANKER';

export interface TrafficVehicle {
  id: number;
  active: boolean;
  kind: TrafficKind;
  group: THREE.Group;
  modelWrap: THREE.Group;
  wheels: THREE.Object3D[];
  wheelRadius: number;
  halfWidth: number;
  halfLength: number;
  halfHeight: number;
  mass: number;

  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;

  laneIndex: number;
  targetLaneIndex: number;
  cruiseSpeed: number;
  laneChangeTimer: number;
  indicatorTimer: number; // >0 = blinking amber before lane change

  state: 'DRIVING' | 'SCRIPTED_JACKKNIFE' | 'CRASHED';
  crashBody: RAPIER.RigidBody | null;
  crashedTimer: number;
  exploded: boolean;
  nearMissAwarded: boolean;
  sprayTimer: number;

  indicatorMeshL: THREE.Mesh;
  indicatorMeshR: THREE.Mesh;
}

const REALISTIC_CAR_PAINTS = [
  0x14181f, // Obsidian Midnight Black
  0x6b7480, // Brushed Titanium Silver
  0x262d36, // Gunmetal Slate
  0x59626e, // Storm Pewter Metallic
  0x142338, // Deep Sapphire Blue
  0x451017, // Dark Bordeaux Metallic
  0x36332f, // Warm Anthracite Bronze
];

export interface TrafficStepEvents {
  nearMisses: Array<{ pos: THREE.Vector3; closingSpeedKmh: number }>;
  playerImpact: {
    severity: number; // 0..1+
    fatal: boolean;
    contactPos: THREE.Vector3;
    otherKind: TrafficKind;
  } | null;
  explosionTriggered: Array<{ pos: THREE.Vector3; scale: number }>;
}

export class TrafficManager {
  public readonly root = new THREE.Group();
  public readonly vehicles: TrafficVehicle[] = [];

  private readonly templates: Record<TrafficKind, THREE.Group>;
  private readonly shadowTex: THREE.CanvasTexture;
  private readonly indicatorMatOff: THREE.MeshBasicMaterial;
  private readonly indicatorMatOn: THREE.MeshBasicMaterial;

  private readonly poolSize = 24;
  private nextId = 1;
  private spawnCooldown = 0.4;

  constructor(assets: LoadedGameAssets) {
    this.templates = {
      SEDAN: assets.sedanGltf.scene,
      SUV: assets.suvGltf.scene,
      TRUCK: assets.truckGltf.scene,
      TANKER: assets.tankerGltf.scene,
    };

    // Prepare envMaps on template materials & disable redundant per-part shadowMap casting (grounded via AO contact shadow)
    for (const kind of Object.keys(this.templates) as TrafficKind[]) {
      this.templates[kind].traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          const m = o as THREE.Mesh;
          m.castShadow = false;
          m.receiveShadow = true;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) {
            const std = mat as THREE.MeshStandardMaterial;
            if (std) {
              std.envMap = assets.envMap;
              std.envMapIntensity = 1.55;
              if (std.name === 'Taillight') {
                std.emissive = new THREE.Color(0xff0c18);
                std.emissiveIntensity = 8.5;
              } else if (std.name === 'TrailerBox' || std.name === 'TankSteel') {
                std.color.setHex(std.name === 'TrailerBox' ? 0x222832 : 0x48505c);
                std.roughness = std.name === 'TrailerBox' ? 0.52 : 0.24;
                std.metalness = std.name === 'TrailerBox' ? 0.45 : 0.85;
                if ('clearcoat' in std) {
                  (std as THREE.MeshPhysicalMaterial).clearcoat = std.name === 'TrailerBox' ? 0.12 : 0.5;
                }
              }
            }
          }
        }
      });
    }

    this.shadowTex = this.createContactShadowTexture();
    this.indicatorMatOff = new THREE.MeshBasicMaterial({ color: 0x221405 });
    this.indicatorMatOn = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.5, 2.1, 0.15) });

    this.initVehiclePool(assets.envMap);
  }

  private createContactShadowTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 128, 12, 64, 128, 62);
    g.addColorStop(0, 'rgba(0,0,0,0.92)');
    g.addColorStop(0.68, 'rgba(0,0,0,0.68)');
    g.addColorStop(1, 'rgba(0,0,0,0.0)');
    ctx.fillStyle = g;
    ctx.save();
    ctx.scale(1.0, 2.0);
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return new THREE.CanvasTexture(c);
  }

  private initVehiclePool(envMap: THREE.Texture): void {
    // Balanced traffic distribution: 10 Sedans, 8 SUVs, 4 Semi-Trucks, 2 Hazard Fuel Tankers
    const kinds: TrafficKind[] = [
      'SEDAN', 'SEDAN', 'SUV', 'SEDAN', 'TRUCK', 'SUV',
      'SEDAN', 'SUV', 'SEDAN', 'TANKER', 'SEDAN', 'SUV',
      'TRUCK', 'SEDAN', 'SUV', 'SEDAN', 'SUV', 'TRUCK',
      'SEDAN', 'SUV', 'TANKER', 'SEDAN', 'SUV', 'TRUCK',
    ];

    for (let i = 0; i < this.poolSize; i++) {
      const kind = kinds[i % kinds.length];
      const v = this.instantiateTrafficVehicle(kind, i, envMap);
      this.vehicles.push(v);
      this.root.add(v.group);
    }
  }

  private instantiateTrafficVehicle(kind: TrafficKind, idx: number, envMap: THREE.Texture): TrafficVehicle {
    const group = new THREE.Group();
    group.visible = false;

    const modelWrap = new THREE.Group();
    // Rotate 180 deg around Y so headlights (+Z in glTF) face -Z forward down highway, taillights (+Z) face player!
    modelWrap.rotation.y = Math.PI;
    const clone = this.templates[kind].clone(true);

    // Give sedans & SUVs individualized metallic clearcoat body paint
    const paintHex = REALISTIC_CAR_PAINTS[idx % REALISTIC_CAR_PAINTS.length];
    const wheels: THREE.Object3D[] = [];

    clone.traverse((obj) => {
      if (obj.name.startsWith('Wheel')) {
        wheels.push(obj);
      }
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        if (!Array.isArray(mesh.material)) {
          const mat = mesh.material as THREE.MeshPhysicalMaterial;
          if (mat.name === 'CarBody' || (mat.name === 'CabPaint' && kind === 'TRUCK')) {
            const customPaint = mat.clone();
            customPaint.color.setHex(paintHex);
            customPaint.envMap = envMap;
            customPaint.envMapIntensity = 2.0;
            mesh.material = customPaint;
          }
        }
      }
    });

    modelWrap.add(clone);
    group.add(modelWrap);

    const isHeavy = kind === 'TRUCK' || kind === 'TANKER';
    const halfWidth = isHeavy ? 1.24 : kind === 'SUV' ? 1.01 : 0.94;
    const halfLength = isHeavy ? 5.82 : kind === 'SUV' ? 2.46 : 2.36;
    const halfHeight = isHeavy ? 1.78 : kind === 'SUV' ? 0.85 : 0.72;
    const wheelRadius = isHeavy ? 0.50 : kind === 'SUV' ? 0.39 : 0.34;
    const mass = isHeavy ? 9500 : kind === 'SUV' ? 2150 : 1650;

    // Ground contact AO shadow
    const shadowMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(halfWidth * 2.45, halfLength * 2.25),
      new THREE.MeshBasicMaterial({
        map: this.shadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.86,
      }),
    );
    shadowMesh.rotation.x = -Math.PI * 0.5;
    shadowMesh.position.set(0, 0.02, 0);
    group.add(shadowMesh);

    // Rear Amber Turn Signal Indicators (visible to approaching player before lane shifts!)
    const indGeo = new THREE.BoxGeometry(0.18, 0.08, 0.08);
    const indL = new THREE.Mesh(indGeo, this.indicatorMatOff);
    const indR = new THREE.Mesh(indGeo, this.indicatorMatOff);
    indL.position.set(-halfWidth * 0.82, 0.78, halfLength - 0.05);
    indR.position.set(halfWidth * 0.82, 0.78, halfLength - 0.05);
    group.add(indL, indR);

    return {
      id: this.nextId++,
      active: false,
      kind,
      group,
      modelWrap,
      wheels,
      wheelRadius,
      halfWidth,
      halfLength,
      halfHeight,
      mass,
      pos: new THREE.Vector3(0, 0, 100),
      vel: new THREE.Vector3(),
      yaw: 0,
      laneIndex: 1,
      targetLaneIndex: 1,
      cruiseSpeed: 24,
      laneChangeTimer: 5,
      indicatorTimer: 0,
      state: 'DRIVING',
      crashBody: null,
      crashedTimer: 0,
      exploded: false,
      nearMissAwarded: false,
      sprayTimer: 0,
      indicatorMeshL: indL,
      indicatorMeshR: indR,
    };
  }

  public populateInitialTraffic(playerZ: number): void {
    // Seed visible, fair, well-staggered highway traffic from 36m..245m ahead for immediate overtaking & Near-Miss action
    const initialPlacements: Array<{ lane: number; dist: number; kind: TrafficKind; speed?: number }> = [
      { lane: 1, dist: 36, kind: 'SEDAN', speed: 21.5 },
      { lane: 3, dist: 68, kind: 'TRUCK', speed: 20.5 },
      { lane: 0, dist: 96, kind: 'SUV' },
      { lane: 2, dist: 138, kind: 'SEDAN', speed: 23.0 },
      { lane: 1, dist: 174, kind: 'SUV' },
      { lane: 3, dist: 210, kind: 'TANKER' },
      { lane: 0, dist: 246, kind: 'SEDAN' },
    ];

    for (const p of initialPlacements) {
      this.spawnSpecificVehicle(p.kind, p.lane, playerZ - p.dist, p.speed);
    }
  }

  public spawnSpecificVehicle(
    preferredKind: TrafficKind,
    laneIndex: number,
    zPos: number,
    speedOverride?: number,
  ): TrafficVehicle | null {
    let slot = this.vehicles.find((v) => !v.active && v.kind === preferredKind);
    if (!slot) slot = this.vehicles.find((v) => !v.active);
    if (!slot) return null;

    const laneX = HIGHWAY_LANES[laneIndex];
    // Verify safe clearance at zPos
    for (const other of this.vehicles) {
      if (!other.active) continue;
      if (Math.abs(other.pos.x - laneX) < 2.2 && Math.abs(other.pos.z - zPos) < slot.halfLength + other.halfLength + 12.0) {
        return null;
      }
    }

    slot.active = true;
    slot.group.visible = true;
    slot.group.rotation.set(0, 0, 0);
    slot.state = 'DRIVING';
    slot.crashedTimer = 0;
    slot.exploded = false;
    slot.nearMissAwarded = false;
    slot.laneIndex = laneIndex;
    slot.targetLaneIndex = laneIndex;
    slot.yaw = 0;

    const isHeavy = slot.kind === 'TRUCK' || slot.kind === 'TANKER';
    // Realistic expressway lane speeds: inner fast lanes ~105-130 km/h, outer truck lanes ~80-100 km/h
    const baseSpeed = isHeavy
      ? 21.5 + Math.random() * 4.5
      : 26.5 + (3 - laneIndex) * 2.2 + Math.random() * 5.5;
    slot.cruiseSpeed = speedOverride ?? baseSpeed;

    slot.pos.set(laneX, 0, zPos);
    slot.vel.set(0, 0, -slot.cruiseSpeed);
    slot.laneChangeTimer = 3.5 + Math.random() * 6.5;
    slot.indicatorTimer = 0;
    slot.indicatorMeshL.material = this.indicatorMatOff;
    slot.indicatorMeshR.material = this.indicatorMatOff;
    slot.group.position.copy(slot.pos);

    return slot;
  }

  private trySpawnAhead(playerZ: number, difficulty: number): void {
    // Heavy trucks prefer outer lanes (2, 3); sedans/SUVs use all 4 lanes
    const free = this.vehicles.filter((v) => !v.active);
    if (free.length === 0) return;

    const candidate = free[Math.floor(Math.random() * free.length)];
    const isHeavy = candidate.kind === 'TRUCK' || candidate.kind === 'TANKER';
    const laneChoices = isHeavy ? [2, 3, 0] : [0, 1, 2, 3];
    const lane = laneChoices[Math.floor(Math.random() * laneChoices.length)];
    const spawnZ = playerZ - (245 + Math.random() * 55);

    // Anti-Impossible-Wall Check: ensure we NEVER block all 4 lanes within a 34m longitudinal band!
    const occupiedLanesNearBand = new Set<number>();
    for (const other of this.vehicles) {
      if (!other.active) continue;
      if (Math.abs(other.pos.z - spawnZ) < 34.0) {
        occupiedLanesNearBand.add(other.targetLaneIndex);
        occupiedLanesNearBand.add(other.laneIndex);
      }
      // Same-lane minimum longitudinal spacing
      if ((other.laneIndex === lane || other.targetLaneIndex === lane) && Math.abs(other.pos.z - spawnZ) < 28.0) {
        return;
      }
    }

    occupiedLanesNearBand.add(lane);
    if (occupiedLanesNearBand.size >= 4) {
      // Leave at least 1 guaranteed clear escape lane!
      return;
    }

    const speedScale = 1.0 + difficulty * 0.14;
    this.spawnSpecificVehicle(candidate.kind, lane, spawnZ, undefined);
    if (candidate.active) {
      candidate.cruiseSpeed *= speedScale;
    }
  }

  public convertToDynamicCrash(
    v: TrafficVehicle,
    physics: PhysicsWorld,
    impulseVel: THREE.Vector3,
    angularImpulse: THREE.Vector3,
  ): void {
    if (v.state === 'CRASHED') {
      if (v.crashBody) {
        const lv = v.crashBody.linvel();
        v.crashBody.setLinvel(
          { x: lv.x + impulseVel.x * 0.45, y: Math.max(lv.y, impulseVel.y * 0.5), z: lv.z + impulseVel.z * 0.45 },
          true,
        );
      }
      return;
    }

    v.state = 'CRASHED';
    v.crashedTimer = 0;
    v.indicatorMeshL.material = this.indicatorMatOn;
    v.indicatorMeshR.material = this.indicatorMatOn;

    v.crashBody = physics.createDynamicCrashBody(
      v.pos.x,
      v.halfHeight + 0.08,
      v.pos.z,
      { x: v.halfWidth, y: v.halfHeight, z: v.halfLength },
      {
        x: v.vel.x + impulseVel.x,
        y: Math.min(6.5, Math.max(1.2, impulseVel.y)),
        z: v.vel.z + impulseVel.z,
      },
      { x: angularImpulse.x, y: angularImpulse.y, z: angularImpulse.z },
      v.mass,
    );
  }

  public applyShockwaveImpulse(
    blastOrigin: THREE.Vector3,
    radius: number,
    forceScale: number,
    physics: PhysicsWorld,
  ): void {
    for (const v of this.vehicles) {
      if (!v.active) continue;
      const dx = v.pos.x - blastOrigin.x;
      const dz = v.pos.z - blastOrigin.z;
      const dist = Math.hypot(dx, dz);
      if (dist < radius && dist > 0.1) {
        const strength = (1.0 - dist / radius) * 14.0 * forceScale;
        const nx = dx / dist;
        const nz = dz / dist;
        this.convertToDynamicCrash(
          v,
          physics,
          new THREE.Vector3(nx * strength, 2.8 * forceScale, nz * strength),
          new THREE.Vector3((Math.random() - 0.5) * 3.5, nx * 2.8, -nx * 3.2),
        );
      }
    }
  }

  public applyRebase(deltaZ: number, physics: PhysicsWorld): void {
    for (const v of this.vehicles) {
      if (!v.active) continue;
      v.pos.z += deltaZ;
      v.group.position.z += deltaZ;
      if (v.crashBody && physics.world.bodies.contains(v.crashBody.handle)) {
        const t = v.crashBody.translation();
        v.crashBody.setTranslation({ x: t.x, y: t.y, z: t.z + deltaZ }, true);
      }
    }
  }

  public update(
    dt: number,
    time: number,
    difficulty: number, // 0..1.5 escalating over run duration
    player: PlayerVehicle,
    physics: PhysicsWorld,
    rainAndSparks: RainAndSpraySystem,
    explosions: ExplosionSystem,
    inTunnel: boolean,
    onTrauma: (t: number) => void,
  ): TrafficStepEvents {
    const events: TrafficStepEvents = {
      nearMisses: [],
      playerImpact: null,
      explosionTriggered: [],
    };

    // 1. Spawn cadence scales smoothly with difficulty
    const targetActive = Math.min(18, Math.round(9 + difficulty * 7));
    const currentActive = this.vehicles.reduce((acc, v) => acc + (v.active ? 1 : 0), 0);
    this.spawnCooldown -= dt;
    if (this.spawnCooldown <= 0 && currentActive < targetActive) {
      this.trySpawnAhead(player.position.z, difficulty);
      this.spawnCooldown = Math.max(0.24, 0.62 - difficulty * 0.22);
    }

    // 2. Update every active vehicle
    for (const v of this.vehicles) {
      if (!v.active) continue;

      // Despawn cleanly once >55m behind player or >360m ahead
      if (v.pos.z - player.position.z > 58 || player.position.z - v.pos.z > 370) {
        this.despawnVehicle(v, physics);
        continue;
      }

      if (v.state === 'DRIVING') {
        this.updateDrivingAI(v, dt, time);

        // Subtle rear tire spray on fast traffic outside tunnels
        if (!inTunnel && Math.abs(v.vel.z) > 18 && Math.abs(v.pos.z - player.position.z) < 75) {
          v.sprayTimer += dt;
          if (v.sprayTimer > 0.055) {
            v.sprayTimer = 0;
            rainAndSparks.emitTireSpray(
              v.pos.x + (Math.random() > 0.5 ? 0.75 : -0.75),
              v.pos.z + v.halfLength * 0.82,
              v.vel.z,
              0,
              0.42,
              0.55,
            );
          }
        }
      } else if (v.state === 'CRASHED' && v.crashBody) {
        v.crashedTimer += dt;
        const tr = v.crashBody.translation();
        const rot = v.crashBody.rotation();
        const lv = v.crashBody.linvel();
        v.pos.set(tr.x, Math.max(0, tr.y - v.halfHeight), tr.z);
        v.vel.set(lv.x, lv.y, lv.z);
        v.group.position.set(tr.x, tr.y - v.halfHeight, tr.z);
        v.group.quaternion.set(rot.x, rot.y, rot.z, rot.w);

        // Emit scraping sparks while skidding fast on asphalt
        const speedSq = lv.x * lv.x + lv.z * lv.z;
        if (speedSq > 36 && tr.y < v.halfHeight + 0.35 && Math.random() < dt * 16) {
          rainAndSparks.emitSparks(new THREE.Vector3(tr.x, 0.12, tr.z), 5, lv.z, 6.0);
        }
      }

      // Spin wheels when driving
      if (v.state !== 'CRASHED') {
        const spinDelta = (Math.abs(v.vel.z) / v.wheelRadius) * dt;
        for (const w of v.wheels) {
          w.rotation.x += spinDelta;
        }
        v.group.position.copy(v.pos);
        v.group.rotation.set(0, v.yaw, 0);
      }

      // 3. Player <-> Traffic Collision & Near-Miss Evaluation
      if (!player.isWrecked) {
        const dx = player.position.x - v.pos.x;
        const dz = player.position.z - v.pos.z;
        const absDx = Math.abs(dx);
        const absDz = Math.abs(dz);

        const sumHalfW = player.halfWidth + v.halfWidth - 0.08;
        const sumHalfL = player.halfLength + v.halfLength - 0.14;

        if (absDx < sumHalfW && absDz < sumHalfL) {
          // Physical Vehicle Collision!
          const overlapX = sumHalfW - absDx;
          const overlapZ = sumHalfL - absDz;
          const relVelZ = Math.abs(player.velocity.z - v.vel.z);
          const relVelX = Math.abs(player.velocity.x - v.vel.x);
          const impactSpeed = Math.hypot(relVelX, relVelZ);

          const contactPos = new THREE.Vector3(
            (player.position.x + v.pos.x) * 0.5,
            0.65,
            (player.position.z + v.pos.z) * 0.5,
          );

          if (overlapX < overlapZ) {
            // Side-to-side trade-paint / shunt!
            const pushSign = dx >= 0 ? 1 : -1;
            player.position.x += pushSign * overlapX * 0.75;
            player.velocity.x = pushSign * Math.max(4.5, relVelX * 0.55);
            player.velocity.z *= 0.92;

            const damage = THREE.MathUtils.clamp(12 + impactSpeed * 0.55, 12, 38);
            const fatal = player.applyDamage(damage);

            this.convertToDynamicCrash(
              v,
              physics,
              new THREE.Vector3(-pushSign * (7.5 + relVelX * 0.6), 1.6, player.velocity.z * 0.25),
              new THREE.Vector3(0, -pushSign * 2.2, pushSign * 1.4),
            );
            rainAndSparks.emitSparks(contactPos, 26, player.velocity.z, 11.0);

            events.playerImpact = {
              severity: THREE.MathUtils.clamp(impactSpeed / 35, 0.35, 1.0),
              fatal,
              contactPos,
              otherKind: v.kind,
            };
          } else {
            // Longitudinal Rear-End / Direct Slam!
            const pushZ = dz >= 0 ? 1 : -1;
            player.position.z += pushZ * overlapZ * 0.85;
            player.velocity.z *= 0.48;
            player.velocity.x += (dx >= 0 ? 1 : -1) * 5.5;

            const isHeavy = v.kind === 'TRUCK' || v.kind === 'TANKER';
            const damage = THREE.MathUtils.clamp(
              (isHeavy ? 34 : 22) + relVelZ * (isHeavy ? 1.45 : 1.08),
              24,
              100,
            );
            const fatal = player.applyDamage(damage);

            this.convertToDynamicCrash(
              v,
              physics,
              new THREE.Vector3(-dx * 3.2, isHeavy ? 1.4 : 3.4, -Math.max(12, relVelZ * 0.68)),
              new THREE.Vector3(-1.8, (Math.random() - 0.5) * 3.2, (Math.random() - 0.5) * 2.2),
            );
            rainAndSparks.emitSparks(contactPos, 38, player.velocity.z, 14.0);

            // High-energy rear-end into Tanker or fatal high-speed smash triggers spectacular explosion!
            if ((v.kind === 'TANKER' && relVelZ > 16 && !v.exploded) || (fatal && !v.exploded)) {
              v.exploded = true;
              const blastScale = v.kind === 'TANKER' ? 1.65 : 1.15;
              explosions.triggerExplosion(v.pos, blastScale, rainAndSparks, player.position, onTrauma);
              this.applyShockwaveImpulse(v.pos, 18.0, blastScale, physics);
              events.explosionTriggered.push({ pos: v.pos.clone(), scale: blastScale });
            }

            events.playerImpact = {
              severity: THREE.MathUtils.clamp(relVelZ / 28, 0.55, 1.2),
              fatal,
              contactPos,
              otherKind: v.kind,
            };
          }
        } else if (
          !v.nearMissAwarded &&
          player.speedKmh > 108 &&
          absDz < sumHalfL * 0.92 &&
          absDx >= sumHalfW &&
          absDx < sumHalfW + 1.48
        ) {
          // Razor-close high-speed Near Miss!
          v.nearMissAwarded = true;
          const closingKmh = Math.abs(player.velocity.z - v.vel.z) * 3.6;
          events.nearMisses.push({
            pos: v.pos.clone(),
            closingSpeedKmh: closingKmh,
          });
        }
      }
    }

    return events;
  }

  private updateDrivingAI(v: TrafficVehicle, dt: number, time: number): void {
    // Check distance to any slower vehicle ahead in the same target lane
    let desiredSpeed = v.cruiseSpeed;
    let blockedAhead = false;

    for (const other of this.vehicles) {
      if (!other.active || other === v) continue;
      if (other.targetLaneIndex === v.targetLaneIndex || Math.abs(other.pos.x - v.pos.x) < 2.2) {
        const gapAhead = v.pos.z - other.pos.z - (v.halfLength + other.halfLength);
        if (gapAhead > 0 && gapAhead < 28.0) {
          blockedAhead = true;
          desiredSpeed = Math.min(desiredSpeed, Math.max(12.0, -other.vel.z * 0.94));
        }
      }
    }

    // Controlled lane change decision with 1.0s advance amber turn-signal warning!
    v.laneChangeTimer -= dt;
    const isHeavy = v.kind === 'TRUCK' || v.kind === 'TANKER';
    if (!isHeavy && v.laneIndex === v.targetLaneIndex && (v.laneChangeTimer <= 0 || blockedAhead)) {
      v.laneChangeTimer = 5.5 + Math.random() * 7.5;
      const candidates = [v.laneIndex - 1, v.laneIndex + 1].filter((l) => l >= 0 && l < HIGHWAY_LANES.length);
      if (candidates.length > 0) {
        const nextLane = candidates[Math.floor(Math.random() * candidates.length)];
        const nextX = HIGHWAY_LANES[nextLane];
        let clear = true;
        for (const other of this.vehicles) {
          if (!other.active || other === v) continue;
          if (
            (other.laneIndex === nextLane || other.targetLaneIndex === nextLane || Math.abs(other.pos.x - nextX) < 2.5) &&
            Math.abs(other.pos.z - v.pos.z) < 24.0
          ) {
            clear = false;
            break;
          }
        }
        if (clear) {
          v.targetLaneIndex = nextLane;
          v.indicatorTimer = 1.05; // Blink amber indicator before moving laterally!
        }
      }
    }

    // Blink turn signal when changing lanes
    const targetX = HIGHWAY_LANES[v.targetLaneIndex];
    const dx = targetX - v.pos.x;
    if (Math.abs(dx) > 0.08 || v.indicatorTimer > 0) {
      const blinkOn = Math.floor(time * 7.5) % 2 === 0;
      if (dx < -0.05) {
        v.indicatorMeshL.material = blinkOn ? this.indicatorMatOn : this.indicatorMatOff;
        v.indicatorMeshR.material = this.indicatorMatOff;
      } else if (dx > 0.05) {
        v.indicatorMeshR.material = blinkOn ? this.indicatorMatOn : this.indicatorMatOff;
        v.indicatorMeshL.material = this.indicatorMatOff;
      }
    } else {
      v.laneIndex = v.targetLaneIndex;
      v.indicatorMeshL.material = this.indicatorMatOff;
      v.indicatorMeshR.material = this.indicatorMatOff;
    }

    if (v.indicatorTimer > 0) {
      v.indicatorTimer -= dt;
      v.vel.x = THREE.MathUtils.lerp(v.vel.x, 0, 1.0 - Math.exp(-8 * dt));
    } else {
      const latVel = THREE.MathUtils.clamp(dx * 2.1, -3.4, 3.4);
      v.vel.x = THREE.MathUtils.lerp(v.vel.x, latVel, 1.0 - Math.exp(-6 * dt));
      if (Math.abs(dx) < 0.1) v.laneIndex = v.targetLaneIndex;
    }

    const currFwd = -v.vel.z;
    const nextFwd = THREE.MathUtils.lerp(currFwd, desiredSpeed, 1.0 - Math.exp(-3.5 * dt));
    v.vel.z = -nextFwd;
    v.yaw = THREE.MathUtils.clamp(-v.vel.x * 0.055, -0.18, 0.18);

    v.pos.addScaledVector(v.vel, dt);
    v.pos.x = THREE.MathUtils.clamp(v.pos.x, -(HIGHWAY_HALF_WIDTH - v.halfWidth), HIGHWAY_HALF_WIDTH - v.halfWidth);
  }

  public despawnVehicle(v: TrafficVehicle, physics: PhysicsWorld): void {
    v.active = false;
    v.group.visible = false;
    v.state = 'DRIVING';
    if (v.crashBody) {
      physics.removeBody(v.crashBody);
      v.crashBody = null;
    }
  }

  public reset(physics: PhysicsWorld): void {
    for (const v of this.vehicles) {
      this.despawnVehicle(v, physics);
    }
    this.spawnCooldown = 0.4;
  }
}
