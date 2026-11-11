import * as THREE from 'three';
import type { PlayerVehicle } from '../vehicles/PlayerVehicle';

export type CameraMode = 'CHASE' | 'ACTION' | 'HOOD';

const MODE_ORDER: CameraMode[] = ['CHASE', 'ACTION', 'HOOD'];

const MODE_LABELS: Record<CameraMode, string> = {
  CHASE: 'CHASE CAM',
  ACTION: 'ACTION CAM',
  HOOD: 'HOOD CAM',
};

export class CinematicCamera {
  public readonly camera: THREE.PerspectiveCamera;
  public mode: CameraMode = 'CHASE';

  private readonly currentPos = new THREE.Vector3(1.9, 2.2, 6.5);
  private readonly currentLook = new THREE.Vector3(1.9, 0.85, -14.0);
  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();

  private lateralLag = 0;
  private trauma = 0; // 0..1 controlled impact/blast camera shake
  private menuOrbitAngle = 0.52;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(54, aspect, 0.22, 920);
  }

  public get modeLabel(): string {
    return MODE_LABELS[this.mode];
  }

  public cycleMode(): CameraMode {
    const idx = (MODE_ORDER.indexOf(this.mode) + 1) % MODE_ORDER.length;
    this.mode = MODE_ORDER[idx];
    return this.mode;
  }

  public addTrauma(amount: number): void {
    this.trauma = Math.min(1.0, this.trauma + amount);
  }

  public applyRebase(deltaZ: number): void {
    this.currentPos.z += deltaZ;
    this.currentLook.z += deltaZ;
    this.camera.position.z += deltaZ;
  }

  public setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  public setMenuOrbitAngle(angle: number): void {
    this.menuOrbitAngle = angle;
  }

  /**
   * Dramatic low-angle showcase camera for the Main Menu: slowly sweeps around the wet supercar
   * from rear-three-quarter (taillight horizon & active wing) to front-three-quarter (xenon headlamps & splitter).
   */
  public updateMenuShowcase(dt: number, time: number, player: PlayerVehicle): void {
    this.menuOrbitAngle += dt * 0.16;
    const sweep = Math.sin(this.menuOrbitAngle) * 1.05 + 1.28; // sweeps 0.23 rad (rear 3/4) <-> 2.33 rad (front 3/4)
    const radius = 5.05 + Math.cos(this.menuOrbitAngle * 0.7) * 0.45;
    const height = 1.18 + Math.sin(time * 0.45) * 0.14;

    const tx = THREE.MathUtils.clamp(player.position.x + Math.sin(sweep) * radius, -8.8, 8.8);
    const tz = player.position.z + Math.cos(sweep) * radius;

    this.camera.position.set(tx, height, tz);
    this.camera.lookAt(player.position.x, 0.62, player.position.z - 0.15);
    if (Math.abs(this.camera.fov - 45) > 0.1) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 45, 1.0 - Math.exp(-4 * dt));
      this.camera.updateProjectionMatrix();
    }
  }

  public updateGameplay(dt: number, time: number, player: PlayerVehicle): void {
    const speedRatio = THREE.MathUtils.clamp(player.speedKmh / 290, 0, 1.2);
    const nitroFactor = player.isNitroActive ? 1.0 : 0.0;

    // Smooth lateral camera lag reveals sleek vehicle side-profile when carving lanes
    const targetLag = -player.steerAngle * 0.68 * THREE.MathUtils.clamp(player.speedKmh / 140, 0.2, 1.0);
    this.lateralLag = THREE.MathUtils.lerp(this.lateralLag, targetLag, 1.0 - Math.exp(-6.5 * dt));

    const sinH = Math.sin(player.heading);
    const cosH = Math.cos(player.heading);
    const fwdX = -sinH;
    const fwdZ = -cosH;
    const rightX = cosH;
    const rightZ = -sinH;

    if (this.mode === 'HOOD') {
      // Rigidly mounted Exterior Bonnet / Hood Camera showing sculpted power-hood & muscular GT front fenders!
      const hoodFwd = 0.86;
      const hoodUp = 0.94 + player.heaveOffset;
      this.desiredPos.set(
        player.position.x + fwdX * hoodFwd,
        player.position.y + hoodUp,
        player.position.z + fwdZ * hoodFwd,
      );
      this.desiredLook.set(
        player.position.x + fwdX * 44.0 + rightX * (player.steerAngle * 2.4),
        0.64 + player.heaveOffset * 0.5,
        player.position.z + fwdZ * 44.0 + rightZ * (player.steerAngle * 2.4),
      );
      this.currentPos.copy(this.desiredPos);
      this.currentLook.copy(this.desiredLook);
    } else {
      const isAction = this.mode === 'ACTION';
      const distBack = (isAction ? 4.55 : 5.65) + speedRatio * 0.55 + nitroFactor * 0.48;
      const heightUp = (isAction ? 1.34 : 1.78) - nitroFactor * 0.08;
      const lookAhead = isAction ? 16.0 : 13.5;

      // Follow mostly highway axis + subtle fraction of car heading so drifts look super cinematic!
      const camYaw = player.heading * 0.52;
      const cSin = Math.sin(camYaw);
      const cCos = Math.cos(camYaw);

      const rawX = player.position.x + cSin * distBack + this.lateralLag;
      this.desiredPos.set(
        THREE.MathUtils.clamp(rawX, -9.1, 9.1),
        player.position.y + heightUp,
        player.position.z + cCos * distBack,
      );

      this.desiredLook.set(
        player.position.x + fwdX * lookAhead * 0.45,
        0.78 + (isAction ? -0.08 : 0.04),
        player.position.z - lookAhead,
      );

      // Tight longitudinal follow so car never outruns camera; smooth lateral spring
      const followRateXZ = 1.0 - Math.exp(-14.5 * dt);
      this.currentPos.x = THREE.MathUtils.lerp(this.currentPos.x, this.desiredPos.x, followRateXZ);
      this.currentPos.y = THREE.MathUtils.lerp(this.currentPos.y, this.desiredPos.y, 1.0 - Math.exp(-10.0 * dt));
      this.currentPos.z = THREE.MathUtils.lerp(this.currentPos.z, this.desiredPos.z, 1.0 - Math.exp(-24.0 * dt));
      this.currentLook.lerp(this.desiredLook, 1.0 - Math.exp(-16.0 * dt));
    }

    // Controlled trauma shake + subtle high-speed/Nitro road vibration
    this.trauma = Math.max(0, this.trauma - 1.65 * dt);
    const shakeMag = this.trauma * this.trauma * 0.42 + nitroFactor * 0.016 + Math.max(0, speedRatio - 0.75) * 0.01;
    const sx = (Math.sin(time * 43.0) + 0.5 * Math.cos(time * 71.0)) * shakeMag;
    const sy = (Math.cos(time * 37.0) + 0.5 * Math.sin(time * 63.0)) * shakeMag * 0.75;

    this.camera.position.set(this.currentPos.x + sx, Math.max(0.45, this.currentPos.y + sy), this.currentPos.z);
    this.camera.lookAt(this.currentLook);

    // Subtle dynamic roll into corners
    const targetBank = -player.steerAngle * speedRatio * (this.mode === 'ACTION' ? 0.038 : 0.022)
                     + Math.sin(time * 29.0) * (this.trauma * this.trauma * 0.035);
    this.camera.rotation.z += targetBank;

    // Speed + Nitro dynamic FOV
    const baseFov = this.mode === 'HOOD' ? 60 : this.mode === 'ACTION' ? 57 : 53;
    const targetFov = baseFov + speedRatio * 10.5 + nitroFactor * 6.5 + this.trauma * 2.5;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1.0 - Math.exp(-7.5 * dt));
    this.camera.updateProjectionMatrix();
  }

  public snapBehindPlayer(player: PlayerVehicle): void {
    this.lateralLag = 0;
    this.trauma = 0;
    this.currentPos.set(player.position.x, 1.82, player.position.z + 5.8);
    this.currentLook.set(player.position.x, 0.8, player.position.z - 14.0);
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLook);
  }
}
