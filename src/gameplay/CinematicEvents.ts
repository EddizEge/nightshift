import * as THREE from 'three';
import { HIGHWAY_LANES } from '../world/HighwayManager';
import type { TrafficManager, TrafficVehicle } from '../traffic/TrafficManager';
import type { PlayerVehicle } from '../vehicles/PlayerVehicle';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { ExplosionSystem } from '../vfx/ExplosionSystem';
import type { RainAndSpraySystem } from '../vfx/RainAndSpraySystem';

export type CinematicEventType = 'CHAIN_REACTION' | 'LAST_SECOND_ESCAPE';

export interface CinematicEventCallbacks {
  onBanner: (kicker: string, title: string, durationSec: number) => void;
  onBonusAwarded: (label: string, points: number) => void;
  onExplosionAudio: (dist: number, scale: number) => void;
  onLightningAudio: () => void;
  onTrauma: (amount: number) => void;
}

/**
 * Real-time gameplay cinematic hazard director (Section 11):
 * - Event A: HIGHWAY CHAIN REACTION (multi-vehicle tanker jackknife & dual-stage explosion ahead)
 * - Event B: THE LAST-SECOND ESCAPE (lightning/transformer arc strike + rolling lane blasts & collapsing hazard)
 * Both occur organically in live 3D physics/gameplay with fair, thrilling escape corridors.
 */
export class CinematicEventsDirector {
  public readonly root = new THREE.Group();

  private activeEvent: CinematicEventType | null = null;
  private eventStage = 0;
  private eventTimer = 0;
  private nextEventCountdown = 21.0; // First thrilling cinematic event within first ~22-26s!
  private nextTypeToggle: CinematicEventType = 'CHAIN_REACTION';

  // Event A state
  private tankerActor: TrafficVehicle | null = null;
  private speederActor: TrafficVehicle | null = null;
  private escapeSide: 'LEFT' | 'RIGHT' = 'LEFT';
  private eventZAnchor = 0;
  private survivorAwarded = false;

  // Event B state (overhead arc bolts + collapsing flaming truss hazard)
  private lightningMesh: THREE.LineSegments;
  private lightningMat: THREE.LineBasicMaterial;
  private fallingBeamMesh: THREE.Mesh;
  private warningFlareMesh: THREE.Mesh;
  private hazardSideSign = 1; // -1 = left lanes (0,1) struck, +1 = right lanes (2,3) struck

  constructor() {
    // High-voltage electrical arc geometry for Event B
    const pts: number[] = [];
    for (let i = 0; i < 16; i++) {
      pts.push(0, 0, 0, 0, 1, 0);
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.lightningMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(3.5, 6.0, 12.0),
      transparent: true,
      opacity: 0.95,
    });
    this.lightningMesh = new THREE.LineSegments(lineGeo, this.lightningMat);
    this.lightningMesh.visible = false;
    this.lightningMesh.frustumCulled = false;
    this.root.add(this.lightningMesh);

    // Collapsing burning gantry beam for Event B
    const beamMat = new THREE.MeshStandardMaterial({
      color: 0x22262c,
      metalness: 0.85,
      roughness: 0.35,
      emissive: new THREE.Color(0xff4508),
      emissiveIntensity: 1.6,
    });
    this.fallingBeamMesh = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.78, 0.88), beamMat);
    this.fallingBeamMesh.visible = false;
    this.root.add(this.fallingBeamMesh);

    // Subtle ground emergency hazard strobe illuminating the danger zone ahead
    this.warningFlareMesh = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 2.2, 28),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(4.0, 0.5, 0.15),
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.warningFlareMesh.rotation.x = -Math.PI * 0.5;
    this.warningFlareMesh.visible = false;
    this.root.add(this.warningFlareMesh);
  }

  public triggerSpecificEventNow(
    type: CinematicEventType,
    player: PlayerVehicle,
    traffic: TrafficManager,
    cb: CinematicEventCallbacks,
  ): boolean {
    if (this.activeEvent !== null) return false;
    if (type === 'CHAIN_REACTION') {
      return this.startChainReaction(player, traffic, cb);
    }
    return this.startLastSecondEscape(player, cb);
  }

  private startChainReaction(
    player: PlayerVehicle,
    traffic: TrafficManager,
    cb: CinematicEventCallbacks,
  ): boolean {
    // Choose side to pile up so opposite side (2 lanes) stays open as a thrilling high-speed escape gap
    this.escapeSide = player.position.x > 0 ? 'LEFT' : 'RIGHT';
    const tankerLane = this.escapeSide === 'LEFT' ? 2 : 1;
    const speederLane = this.escapeSide === 'LEFT' ? 3 : 0;

    const aheadDist = Math.max(125, Math.min(168, player.speedMps * 2.35));
    const tankerZ = player.position.z - aheadDist;

    // Clear conflicting traffic right inside the scripted stunt pocket so escape lane is 100% fair
    for (const v of traffic.vehicles) {
      if (v.active && Math.abs(v.pos.z - tankerZ) < 42) {
        v.pos.z -= 85;
      }
    }

    const tanker = traffic.spawnSpecificVehicle('TANKER', tankerLane, tankerZ, 20.0);
    const speeder = traffic.spawnSpecificVehicle('SEDAN', speederLane, tankerZ + 22.0, 42.0);
    if (!tanker || !speeder) return false;

    this.activeEvent = 'CHAIN_REACTION';
    this.eventStage = 0;
    this.eventTimer = 0;
    this.tankerActor = tanker;
    this.speederActor = speeder;
    this.eventZAnchor = tankerZ;
    this.survivorAwarded = false;

    cb.onBanner(
      'EMERGENCY ALERT // EVENT A',
      `HIGHWAY CHAIN REACTION — KEEP ${this.escapeSide}!`,
      3.4,
    );
    return true;
  }

  private startLastSecondEscape(player: PlayerVehicle, cb: CinematicEventCallbacks): boolean {
    this.activeEvent = 'LAST_SECOND_ESCAPE';
    this.eventStage = 0;
    this.eventTimer = 0;
    this.survivorAwarded = false;

    // Strike the side the player is currently favoring so they must execute a dramatic high-speed evade!
    this.hazardSideSign = player.position.x >= 0 ? 1 : -1;
    const escapeDirLabel = this.hazardSideSign > 0 ? 'LEFT LANES' : 'RIGHT LANES';

    const aheadDist = Math.max(135, Math.min(182, player.speedMps * 2.55));
    this.eventZAnchor = player.position.z - aheadDist;

    this.fallingBeamMesh.visible = true;
    this.fallingBeamMesh.position.set(this.hazardSideSign * 4.6, 9.2, this.eventZAnchor);
    this.fallingBeamMesh.rotation.set(0, 0, 0);

    this.warningFlareMesh.visible = true;
    this.warningFlareMesh.position.set(this.hazardSideSign * 4.2, 0.07, this.eventZAnchor);

    cb.onBanner(
      'CRITICAL HAZARD // EVENT B',
      `OVERPASS COLLAPSE — ESCAPE ${escapeDirLabel}!`,
      3.6,
    );
    cb.onLightningAudio();
    return true;
  }

  private updateLightningGeometry(originX: number, originZ: number): void {
    const attr = this.lightningMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    let px = originX + (Math.random() - 0.5) * 3.0;
    let py = 26.0;
    let pz = originZ + (Math.random() - 0.5) * 2.0;

    for (let i = 0; i < 16; i++) {
      const nx = originX + (Math.random() - 0.5) * 2.8;
      const ny = 26.0 - ((i + 1) / 16) * 17.5;
      const nz = originZ + (Math.random() - 0.5) * 2.4;
      arr[i * 6 + 0] = px;
      arr[i * 6 + 1] = py;
      arr[i * 6 + 2] = pz;
      arr[i * 6 + 3] = nx;
      arr[i * 6 + 4] = ny;
      arr[i * 6 + 5] = nz;
      px = nx;
      py = ny;
      pz = nz;
    }
    attr.needsUpdate = true;
  }

  public applyRebase(deltaZ: number): void {
    this.eventZAnchor += deltaZ;
    this.fallingBeamMesh.position.z += deltaZ;
    this.warningFlareMesh.position.z += deltaZ;
  }

  public update(
    dt: number,
    time: number,
    player: PlayerVehicle,
    traffic: TrafficManager,
    physics: PhysicsWorld,
    explosions: ExplosionSystem,
    rainAndSparks: RainAndSpraySystem,
    cb: CinematicEventCallbacks,
  ): void {
    if (player.isWrecked) return;

    if (this.activeEvent === null) {
      if (player.speedKmh > 95) {
        this.nextEventCountdown -= dt;
      }
      if (this.nextEventCountdown <= 0) {
        const started = this.triggerSpecificEventNow(this.nextTypeToggle, player, traffic, cb);
        if (started) {
          this.nextTypeToggle = this.nextTypeToggle === 'CHAIN_REACTION' ? 'LAST_SECOND_ESCAPE' : 'CHAIN_REACTION';
          this.nextEventCountdown = 28.0 + Math.random() * 10.0;
        } else {
          this.nextEventCountdown = 3.0;
        }
      }
      return;
    }

    this.eventTimer += dt;

    if (this.activeEvent === 'CHAIN_REACTION') {
      this.updateChainReaction(dt, player, traffic, physics, explosions, rainAndSparks, cb);
    } else if (this.activeEvent === 'LAST_SECOND_ESCAPE') {
      this.updateLastSecondEscape(dt, time, player, traffic, physics, explosions, rainAndSparks, cb);
    }
  }

  private updateChainReaction(
    dt: number,
    player: PlayerVehicle,
    traffic: TrafficManager,
    physics: PhysicsWorld,
    explosions: ExplosionSystem,
    rainAndSparks: RainAndSpraySystem,
    cb: CinematicEventCallbacks,
  ): void {
    const tanker = this.tankerActor;
    const speeder = this.speederActor;
    if (!tanker || !tanker.active) {
      this.endActiveEvent();
      return;
    }

    this.eventZAnchor = tanker.pos.z;

    // Stage 0: Speeder swerves violently into Fuel Tanker's flank (t ~ 0.65s)
    if (this.eventStage === 0) {
      if (speeder && speeder.active) {
        const targetX = tanker.pos.x;
        speeder.pos.x = THREE.MathUtils.lerp(speeder.pos.x, targetX, 1.0 - Math.exp(-3.8 * dt));
      }
      if (this.eventTimer >= 0.68 || Math.abs(player.position.z - tanker.pos.z) < 92) {
        this.eventStage = 1;
        tanker.state = 'SCRIPTED_JACKKNIFE';
        rainAndSparks.emitSparks(tanker.pos.clone().add(new THREE.Vector3(0, 0.8, 2.0)), 42, tanker.vel.z, 13.0);

        if (speeder && speeder.active) {
          const awayX = this.escapeSide === 'LEFT' ? 8.5 : -8.5;
          traffic.convertToDynamicCrash(
            speeder,
            physics,
            new THREE.Vector3(awayX, 3.2, 4.0),
            new THREE.Vector3(1.5, 3.2, -2.5),
          );
        }
      }
    }
    // Stage 1: Tanker jackknifes throwing massive sparks across hazard lanes -> Detonates!
    else if (this.eventStage === 1) {
      const jackSign = this.escapeSide === 'LEFT' ? -1 : 1;
      tanker.yaw = THREE.MathUtils.lerp(tanker.yaw, jackSign * 0.82, 1.0 - Math.exp(-3.5 * dt));
      tanker.vel.z = THREE.MathUtils.lerp(tanker.vel.z, -6.5, 1.0 - Math.exp(-2.8 * dt));
      tanker.pos.x = THREE.MathUtils.clamp(
        tanker.pos.x - jackSign * 2.8 * dt,
        this.escapeSide === 'LEFT' ? 1.8 : -7.6,
        this.escapeSide === 'LEFT' ? 7.6 : -1.8,
      );
      tanker.pos.addScaledVector(tanker.vel, dt);

      if (Math.random() < dt * 24) {
        rainAndSparks.emitSparks(tanker.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), 8, tanker.vel.z, 9.0);
      }

      const distToPlayer = Math.abs(player.position.z - tanker.pos.z);
      if (this.eventTimer >= 1.55 || distToPlayer < 68) {
        this.eventStage = 2;
        tanker.exploded = true;

        // Primary colossal Fuel Tanker Detonation!
        const blast1 = tanker.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
        explosions.triggerExplosion(blast1, 1.85, rainAndSparks, player.position, cb.onTrauma);
        cb.onExplosionAudio(distToPlayer, 1.85);

        const pushDir = this.escapeSide === 'LEFT' ? 6.0 : -6.0;
        traffic.convertToDynamicCrash(
          tanker,
          physics,
          new THREE.Vector3(pushDir, 3.6, -4.0),
          new THREE.Vector3(0.8, 1.6, -1.2),
        );
        traffic.applyShockwaveImpulse(blast1, 24.0, 1.45, physics);
      }
    }
    // Stage 2: Secondary chain explosion 0.38s later + Survivor bonus as player slices past!
    else if (this.eventStage === 2) {
      if (this.eventTimer >= 1.95) {
        this.eventStage = 3;
        const secPos = tanker.pos.clone().add(new THREE.Vector3(this.escapeSide === 'LEFT' ? 2.6 : -2.6, 0.9, -5.5));
        explosions.triggerExplosion(secPos, 1.35, rainAndSparks, player.position, cb.onTrauma);
        cb.onExplosionAudio(player.position.distanceTo(secPos), 1.35);
      }
    }

    // Award CHAIN SURVIVOR when player threads past the burning tanker!
    if (!this.survivorAwarded && player.position.z < this.eventZAnchor - 8.0) {
      this.survivorAwarded = true;
      player.nitroCharge = Math.min(100, player.nitroCharge + 35);
      cb.onBonusAwarded('CHAIN REACTION SURVIVED', 2500);
    }

    if (player.position.z < this.eventZAnchor - 55.0 || this.eventTimer > 9.0) {
      this.endActiveEvent();
    }
  }

  private updateLastSecondEscape(
    dt: number,
    time: number,
    player: PlayerVehicle,
    traffic: TrafficManager,
    physics: PhysicsWorld,
    explosions: ExplosionSystem,
    rainAndSparks: RainAndSpraySystem,
    cb: CinematicEventCallbacks,
  ): void {
    const hazardX = this.hazardSideSign * 4.4;
    const distZ = player.position.z - this.eventZAnchor; // positive while approaching

    // Flickering overhead blue-white electrical arcs during Stage 0..1
    if (this.eventTimer < 1.55) {
      this.lightningMesh.visible = Math.floor(time * 28) % 2 === 0;
      if (this.lightningMesh.visible) {
        this.updateLightningGeometry(hazardX, this.eventZAnchor);
      }
      if (Math.random() < dt * 20) {
        rainAndSparks.emitSparks(new THREE.Vector3(hazardX, 8.5, this.eventZAnchor), 10, 0, 11.0);
      }
    } else {
      this.lightningMesh.visible = false;
    }

    this.warningFlareMesh.scale.setScalar(1.0 + 0.25 * Math.sin(time * 18.0));

    // Stage 0 -> 1: Transformer explosion & gantry beam breaks loose!
    if (this.eventStage === 0 && (this.eventTimer >= 0.72 || distZ < 96)) {
      this.eventStage = 1;
      const topBlast = new THREE.Vector3(hazardX, 7.8, this.eventZAnchor);
      explosions.triggerExplosion(topBlast, 1.35, rainAndSparks, player.position, cb.onTrauma);
      cb.onExplosionAudio(player.position.distanceTo(topBlast), 1.35);
    }

    // Beam falls & crashes onto the stricken highway side (strictly leaving opposite 2 lanes 100% open!)
    if (this.eventStage >= 1) {
      if (this.fallingBeamMesh.position.y > 0.52) {
        this.fallingBeamMesh.position.y = Math.max(0.52, this.fallingBeamMesh.position.y - 13.5 * dt);
        this.fallingBeamMesh.rotation.z += this.hazardSideSign * 0.42 * dt;
        if (this.fallingBeamMesh.position.y <= 0.53 && this.eventStage === 1) {
          this.eventStage = 2;
          const groundHit = new THREE.Vector3(hazardX, 0.8, this.eventZAnchor);
          explosions.triggerExplosion(groundHit, 1.75, rainAndSparks, player.position, cb.onTrauma);
          cb.onExplosionAudio(player.position.distanceTo(groundHit), 1.75);
          traffic.applyShockwaveImpulse(groundHit, 22.0, 1.4, physics);
        }
      }
    }

    // Check collision against fallen burning gantry beam ONLY on the stricken half of the highway
    if (this.fallingBeamMesh.position.y < 2.1 && Math.abs(distZ) < 2.2) {
      const beamMinX = this.hazardSideSign > 0 ? 0.2 : -9.4;
      const beamMaxX = this.hazardSideSign > 0 ? 9.4 : -0.2;
      if (player.position.x + player.halfWidth > beamMinX && player.position.x - player.halfWidth < beamMaxX) {
        const hitPos = player.position.clone().add(new THREE.Vector3(0, 0.8, -1.2));
        const fatal = player.applyDamage(58);
        player.velocity.z *= 0.45;
        explosions.triggerExplosion(hitPos, 1.45, rainAndSparks, player.position, cb.onTrauma);
        cb.onExplosionAudio(4.0, 1.45);
        if (fatal) {
          this.endActiveEvent();
          return;
        }
        // Push beam aside after impact so it doesn't multi-hit every frame
        this.fallingBeamMesh.position.z += 12.0;
      }
    }

    // Award LAST-SECOND ESCAPE when player rockets cleanly past the collapsed inferno!
    if (!this.survivorAwarded && distZ < -6.0) {
      this.survivorAwarded = true;
      player.nitroCharge = Math.min(100, player.nitroCharge + 45);
      cb.onBonusAwarded('LAST-SECOND ESCAPE', 4000);
    }

    if (distZ < -55.0 || this.eventTimer > 9.5) {
      this.endActiveEvent();
    }
  }

  private endActiveEvent(): void {
    this.activeEvent = null;
    this.tankerActor = null;
    this.speederActor = null;
    this.lightningMesh.visible = false;
    this.fallingBeamMesh.visible = false;
    this.warningFlareMesh.visible = false;
  }

  public reset(): void {
    this.endActiveEvent();
    this.nextEventCountdown = 21.0;
    this.nextTypeToggle = 'CHAIN_REACTION';
  }
}
