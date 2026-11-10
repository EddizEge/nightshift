export type QualityPresetName = 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA';

export interface QualitySpec {
  name: QualityPresetName;
  pixelRatioCap: number;
  msaaSamples: number;
  enablePlanarReflection: boolean;
  planarReflectionScale: number;
  shadowMapSize: number;
  enableShadows: boolean;
  rainCount: number;
  sprayMaxParticles: number;
  bloomStrength: number;
  lensRainStrength: number;
  motionBlurStrength: number;
  anisotropy: number;
}

export const QUALITY_PRESETS: Record<QualityPresetName, QualitySpec> = {
  LOW: {
    name: 'LOW',
    pixelRatioCap: 1.0,
    msaaSamples: 0,
    enablePlanarReflection: false,
    planarReflectionScale: 0.25,
    shadowMapSize: 1024,
    enableShadows: false,
    rainCount: 2500,
    sprayMaxParticles: 120,
    bloomStrength: 0.28,
    lensRainStrength: 0.0,
    motionBlurStrength: 0.0,
    anisotropy: 2,
  },
  MEDIUM: {
    name: 'MEDIUM',
    pixelRatioCap: 1.25,
    msaaSamples: 2,
    enablePlanarReflection: true,
    planarReflectionScale: 0.35,
    shadowMapSize: 1024,
    enableShadows: true,
    rainCount: 5500,
    sprayMaxParticles: 240,
    bloomStrength: 0.34,
    lensRainStrength: 0.55,
    motionBlurStrength: 0.35,
    anisotropy: 4,
  },
  HIGH: {
    name: 'HIGH',
    pixelRatioCap: 1.5,
    msaaSamples: 4,
    enablePlanarReflection: true,
    planarReflectionScale: 0.5,
    shadowMapSize: 2048,
    enableShadows: true,
    rainCount: 9000,
    sprayMaxParticles: 380,
    bloomStrength: 0.38,
    lensRainStrength: 0.85,
    motionBlurStrength: 0.55,
    anisotropy: 8,
  },
  ULTRA: {
    name: 'ULTRA',
    pixelRatioCap: 2.0,
    msaaSamples: 4,
    enablePlanarReflection: true,
    planarReflectionScale: 0.65,
    shadowMapSize: 2048,
    enableShadows: true,
    rainCount: 13000,
    sprayMaxParticles: 520,
    bloomStrength: 0.42,
    lensRainStrength: 1.0,
    motionBlurStrength: 0.7,
    anisotropy: 16,
  },
};

const STORAGE_KEY = 'nightshift_settings_v1';

export class QualityManager {
  public currentPreset: QualityPresetName = 'HIGH';
  public dynamicResolutionEnabled = true;
  public drsScale = 1.0;
  public masterVolume = 0.8;
  public showTelemetry = false;

  private frameTimes: number[] = [];
  private drsCooldown = 0;
  private listeners: Array<(spec: QualitySpec) => void> = [];

  constructor() {
    this.loadFromStorage();
  }

  public get spec(): QualitySpec {
    return QUALITY_PRESETS[this.currentPreset];
  }

  public setPreset(preset: QualityPresetName): void {
    this.currentPreset = preset;
    this.drsScale = 1.0;
    this.frameTimes.length = 0;
    this.saveToStorage();
    const s = this.spec;
    for (const cb of this.listeners) cb(s);
  }

  public onChange(cb: (spec: QualitySpec) => void): void {
    this.listeners.push(cb);
  }

  /**
   * Monitors real frame duration (ms) and scales internal render resolution smoothly
   * if GPU falls below 50 FPS or recovers consistently above 59 FPS.
   */
  public recordFrame(dtSeconds: number): { fps: number; avgMs: number; drsChanged: boolean } {
    const ms = Math.min(dtSeconds * 1000, 100);
    this.frameTimes.push(ms);
    if (this.frameTimes.length > 90) this.frameTimes.shift();

    let sum = 0;
    for (let i = 0; i < this.frameTimes.length; i++) sum += this.frameTimes[i];
    const avgMs = sum / Math.max(1, this.frameTimes.length);
    const fps = 1000 / Math.max(1, avgMs);

    let drsChanged = false;
    this.drsCooldown -= dtSeconds;

    if (this.dynamicResolutionEnabled && this.frameTimes.length >= 60 && this.drsCooldown <= 0) {
      if (avgMs > 20.5 && this.drsScale > 0.68) {
        this.drsScale = Math.max(0.68, +(this.drsScale - 0.08).toFixed(2));
        this.drsCooldown = 2.0;
        drsChanged = true;
      } else if (avgMs < 15.2 && this.drsScale < 1.0) {
        this.drsScale = Math.min(1.0, +(this.drsScale + 0.06).toFixed(2));
        this.drsCooldown = 3.0;
        drsChanged = true;
      }
    }

    return { fps, avgMs, drsChanged };
  }

  public saveToStorage(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          preset: this.currentPreset,
          drs: this.dynamicResolutionEnabled,
          vol: this.masterVolume,
          telemetry: this.showTelemetry,
        }),
      );
    } catch {
      // Ignore storage quota / private mode restrictions
    }
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed.preset && QUALITY_PRESETS[parsed.preset as QualityPresetName]) {
        this.currentPreset = parsed.preset;
      }
      if (typeof parsed.drs === 'boolean') this.dynamicResolutionEnabled = parsed.drs;
      if (typeof parsed.vol === 'number') this.masterVolume = Math.max(0, Math.min(1, parsed.vol));
      if (typeof parsed.telemetry === 'boolean') this.showTelemetry = parsed.telemetry;
    } catch {
      // Default settings
    }
  }
}
