export interface VehicleInputState {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1 (left) .. +1 (right) — Wait: let's define +1 = Steer Right, -1 = Steer Left explicitly!
  handbrake: boolean;
  nitro: boolean;
}

export class InputManager {
  private keys = new Set<string>();
  private cameraCycleQueued = false;
  private pauseQueued = false;
  private confirmQueued = false;

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;
    if (
      code === 'Space' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight'
    ) {
      e.preventDefault();
    }

    if (!this.keys.has(code)) {
      if (code === 'KeyC') this.cameraCycleQueued = true;
      if (code === 'Escape') this.pauseQueued = true;
      if (code === 'Enter') this.confirmQueued = true;
    }
    this.keys.add(code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
  };

  public getVehicleInput(): VehicleInputState {
    const throttle = this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0;
    const brake = this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0;
    const left = this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0;
    const right = this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0;
    const handbrake = this.keys.has('Space');
    const nitro = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');

    return {
      throttle,
      brake,
      steer: right - left, // -1 = Left (A), +1 = Right (D)
      handbrake,
      nitro,
    };
  }

  public consumeCameraToggle(): boolean {
    const v = this.cameraCycleQueued;
    this.cameraCycleQueued = false;
    return v;
  }

  public consumePauseToggle(): boolean {
    const v = this.pauseQueued;
    this.pauseQueued = false;
    return v;
  }

  public consumeConfirm(): boolean {
    const v = this.confirmQueued;
    this.confirmQueued = false;
    return v;
  }

  public isKeyPressed(code: string): boolean {
    return this.keys.has(code);
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
