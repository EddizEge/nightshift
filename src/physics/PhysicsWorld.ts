import RAPIER from '@dimforge/rapier3d-compat';
import { HIGHWAY_HALF_WIDTH } from '../world/HighwayManager';

export class PhysicsWorld {
  public world!: RAPIER.World;
  public ready = false;

  private groundBody!: RAPIER.RigidBody;
  private leftWallBody!: RAPIER.RigidBody;
  private rightWallBody!: RAPIER.RigidBody;

  public async init(): Promise<void> {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 });

    // Static highway road surface collider (huge box so dynamic crashed cars/debris bounce cleanly on y = 0)
    const groundDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1.0, 0);
    this.groundBody = this.world.createRigidBody(groundDesc);
    const groundCol = RAPIER.ColliderDesc.cuboid(60.0, 1.0, 20000.0)
      .setFriction(0.65)
      .setRestitution(0.18);
    this.world.createCollider(groundCol, this.groundBody);

    // Left & Right Concrete Jersey Barrier colliders
    for (const sx of [-1, 1]) {
      const wallDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(sx * (HIGHWAY_HALF_WIDTH + 0.45), 1.5, 0);
      const wallBody = this.world.createRigidBody(wallDesc);
      const wallCol = RAPIER.ColliderDesc.cuboid(0.45, 2.5, 20000.0)
        .setFriction(0.25)
        .setRestitution(0.35);
      this.world.createCollider(wallCol, wallBody);
      if (sx < 0) this.leftWallBody = wallBody;
      else this.rightWallBody = wallBody;
    }

    this.ready = true;
  }

  public createDynamicCrashBody(
    x: number,
    y: number,
    z: number,
    halfExtents: { x: number; y: number; z: number },
    linVel: { x: number; y: number; z: number },
    angVel: { x: number; y: number; z: number },
    mass = 1500,
  ): RAPIER.RigidBody {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinvel(linVel.x, linVel.y, linVel.z)
      .setAngvel(angVel)
      .setLinearDamping(0.35)
      .setAngularDamping(0.45);
    const body = this.world.createRigidBody(desc);
    const col = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setMass(mass)
      .setFriction(0.55)
      .setRestitution(0.28);
    this.world.createCollider(col, body);
    return body;
  }

  public removeBody(body: RAPIER.RigidBody): void {
    if (this.world.bodies.contains(body.handle)) {
      this.world.removeRigidBody(body);
    }
  }

  public step(dt: number): void {
    if (!this.ready) return;
    this.world.timestep = Math.min(dt, 1 / 30);
    this.world.step();
  }
}
