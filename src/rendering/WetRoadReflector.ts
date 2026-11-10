import * as THREE from 'three';

export const REFLECTION_SKIP_LAYER = 2;

export class WetRoadReflector {
  public renderTarget: THREE.WebGLRenderTarget;
  public readonly textureMatrix = new THREE.Matrix4();
  public enabled = true;

  private readonly reflectCamera = new THREE.PerspectiveCamera();
  private readonly reflectPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly clipPlane = new THREE.Vector4();
  private readonly q = new THREE.Vector4();
  private readonly cameraWorldPos = new THREE.Vector3();
  private readonly targetPos = new THREE.Vector3();
  private readonly lookAtPos = new THREE.Vector3();
  private readonly rotationMatrix = new THREE.Matrix4();
  private readonly normal = new THREE.Vector3(0, 1, 0);
  private readonly view = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  private scale = 0.5;

  private static readonly BIAS_MATRIX = new THREE.Matrix4().set(
    0.5, 0.0, 0.0, 0.5,
    0.0, 0.5, 0.0, 0.5,
    0.0, 0.0, 0.5, 0.5,
    0.0, 0.0, 0.0, 1.0,
  );

  constructor(width: number, height: number, scale = 0.5) {
    this.scale = scale;
    const rw = Math.max(64, Math.floor(width * scale));
    const rh = Math.max(64, Math.floor(height * scale));
    this.renderTarget = new THREE.WebGLRenderTarget(rw, rh, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    // Enable layer 0 only (objects tagged on REFLECTION_SKIP_LAYER only won't render; objects moved solely to layer 2 are skipped)
    this.reflectCamera.layers.enable(0);
    this.reflectCamera.layers.disable(REFLECTION_SKIP_LAYER);
  }

  public setSize(width: number, height: number, scale?: number): void {
    if (scale !== undefined) this.scale = scale;
    const rw = Math.max(64, Math.floor(width * this.scale));
    const rh = Math.max(64, Math.floor(height * this.scale));
    if (this.renderTarget.width !== rw || this.renderTarget.height !== rh) {
      this.renderTarget.setSize(rw, rh);
    }
  }

  public render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    mainCamera: THREE.PerspectiveCamera,
    skipObjects: THREE.Object3D[],
  ): void {
    if (!this.enabled) return;

    mainCamera.updateMatrixWorld();
    this.cameraWorldPos.setFromMatrixPosition(mainCamera.matrixWorld);
    // Only reflect when camera is above road plane y = 0.04
    if (this.cameraWorldPos.y < 0.05) return;

    this.rotationMatrix.extractRotation(mainCamera.matrixWorld);

    // Mirror camera position across y = 0
    this.view.copy(this.cameraWorldPos);
    this.view.y = -this.view.y;

    // Mirror look direction across y = 0
    this.lookAtPos.set(0, 0, -1).applyMatrix4(this.rotationMatrix).add(this.cameraWorldPos);
    this.target.copy(this.lookAtPos);
    this.target.y = -this.target.y;

    // Mirror up vector across y = 0 and invert to preserve handedness
    this.up.set(0, 1, 0).applyMatrix4(this.rotationMatrix);
    this.up.y = -this.up.y;

    this.reflectCamera.position.copy(this.view);
    this.reflectCamera.up.copy(this.up);
    this.reflectCamera.lookAt(this.target);
    this.reflectCamera.fov = mainCamera.fov;
    this.reflectCamera.aspect = mainCamera.aspect;
    this.reflectCamera.near = mainCamera.near;
    this.reflectCamera.far = mainCamera.far;
    this.reflectCamera.updateProjectionMatrix();
    this.reflectCamera.updateMatrixWorld();

    // Update texture projection matrix for road shader
    this.textureMatrix.copy(WetRoadReflector.BIAS_MATRIX);
    this.textureMatrix.multiply(this.reflectCamera.projectionMatrix);
    this.textureMatrix.multiply(this.reflectCamera.matrixWorldInverse);

    // Oblique near-plane clipping at y = -0.04 so geometry below road doesn't leak into reflection
    this.reflectPlane.set(this.normal, 0.04);
    this.reflectPlane.applyMatrix4(this.reflectCamera.matrixWorldInverse);
    this.clipPlane.set(
      this.reflectPlane.normal.x,
      this.reflectPlane.normal.y,
      this.reflectPlane.normal.z,
      this.reflectPlane.constant,
    );

    const proj = this.reflectCamera.projectionMatrix;
    const elements = proj.elements;
    this.q.x = (Math.sign(this.clipPlane.x) + elements[8]) / elements[0];
    this.q.y = (Math.sign(this.clipPlane.y) + elements[9]) / elements[5];
    this.q.z = -1.0;
    this.q.w = (1.0 + elements[10]) / elements[14];

    this.clipPlane.multiplyScalar(2.0 / this.clipPlane.dot(this.q));
    elements[2] = this.clipPlane.x;
    elements[6] = this.clipPlane.y;
    elements[10] = this.clipPlane.z + 1.0 - 0.002;
    elements[14] = this.clipPlane.w;

    const prevVisibility: boolean[] = [];
    for (let i = 0; i < skipObjects.length; i++) {
      prevVisibility.push(skipObjects[i].visible);
      skipObjects[i].visible = false;
    }

    const prevRT = renderer.getRenderTarget();
    const prevShadows = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;

    renderer.setRenderTarget(this.renderTarget);
    renderer.clear();
    renderer.render(scene, this.reflectCamera);

    renderer.shadowMap.autoUpdate = prevShadows;
    renderer.setRenderTarget(prevRT);

    for (let i = 0; i < skipObjects.length; i++) {
      skipObjects[i].visible = prevVisibility[i];
    }
  }

  public dispose(): void {
    this.renderTarget.dispose();
  }
}
