import type { QualityManager, QualityPresetName } from '../core/QualityManager';

export interface UICallbacks {
  onStartPlay: () => void;
  onResume: () => void;
  onRestart: () => void;
  onReturnToMenu: () => void;
  onTogglePause: () => void;
  onQualitySelected: (preset: QualityPresetName) => void;
  onDrsToggled: (enabled: boolean) => void;
  onVolumeChanged: (vol01: number) => void;
  onTelemetryToggled: (visible: boolean) => void;
  onUiSound: (primary?: boolean) => void;
}

export class UIManager {
  private readonly loadingOverlay = document.getElementById('loading-overlay')!;
  private readonly loadingFill = document.getElementById('loading-bar-fill')!;
  private readonly loadingStatus = document.getElementById('loading-status')!;

  private readonly menuOverlay = document.getElementById('menu-overlay')!;
  private readonly menuBestScore = document.getElementById('menu-best-score')!;
  private readonly menuQualityBadge = document.getElementById('menu-quality-badge')!;

  private readonly settingsModal = document.getElementById('settings-modal')!;
  private readonly controlsModal = document.getElementById('controls-modal')!;

  private readonly hudOverlay = document.getElementById('hud-overlay')!;
  private readonly hudScore = document.getElementById('hud-score')!;
  private readonly hudDistance = document.getElementById('hud-distance')!;
  private readonly hudNearMiss = document.getElementById('hud-nearmiss')!;
  private readonly hudComboBox = document.getElementById('hud-combo-box')!;
  private readonly hudCombo = document.getElementById('hud-combo')!;
  private readonly hudComboBar = document.getElementById('hud-combo-bar')!;
  private readonly hudIntegrityText = document.getElementById('hud-integrity-text')!;
  private readonly hudIntegrityFill = document.getElementById('hud-integrity-fill')!;
  private readonly hudEventBanner = document.getElementById('hud-event-banner')!;
  private readonly hudEventKicker = document.getElementById('hud-event-kicker')!;
  private readonly hudEventTitle = document.getElementById('hud-event-title')!;
  private readonly hudCalloutFeed = document.getElementById('hud-callout-feed')!;
  private readonly hudCameraName = document.getElementById('hud-camera-name')!;
  private readonly hudTelemetry = document.getElementById('hud-telemetry')!;
  private readonly hudRpmFill = document.getElementById('hud-rpm-fill')!;
  private readonly hudGear = document.getElementById('hud-gear')!;
  private readonly hudSpeed = document.getElementById('hud-speed')!;
  private readonly hudNitroPct = document.getElementById('hud-nitro-pct')!;
  private readonly hudNitroFill = document.getElementById('hud-nitro-fill')!;

  private readonly pauseOverlay = document.getElementById('pause-overlay')!;
  private readonly gameoverOverlay = document.getElementById('gameover-overlay')!;
  private readonly goReason = document.getElementById('gameover-reason')!;
  private readonly goNewBest = document.getElementById('gameover-new-best')!;
  private readonly goFinalScore = document.getElementById('go-final-score')!;
  private readonly goDistance = document.getElementById('go-distance')!;
  private readonly goTopSpeed = document.getElementById('go-top-speed')!;
  private readonly goNearMisses = document.getElementById('go-near-misses')!;
  private readonly goBestScore = document.getElementById('go-best-score')!;

  private bannerTimeout: number | null = null;

  constructor(quality: QualityManager, cb: UICallbacks) {
    this.syncSettingsControls(quality);

    // Main Menu buttons
    document.getElementById('btn-play')!.addEventListener('click', () => {
      cb.onUiSound(true);
      cb.onStartPlay();
    });
    document.getElementById('btn-settings')!.addEventListener('click', () => {
      cb.onUiSound();
      this.settingsModal.classList.add('active');
    });
    document.getElementById('btn-controls')!.addEventListener('click', () => {
      cb.onUiSound();
      this.controlsModal.classList.add('active');
    });

    // Settings Modal
    const closeSettings = () => {
      cb.onUiSound();
      this.settingsModal.classList.remove('active');
    };
    document.getElementById('btn-close-settings')!.addEventListener('click', closeSettings);
    document.getElementById('btn-save-settings')!.addEventListener('click', closeSettings);

    const qGroup = document.getElementById('quality-selector')!;
    qGroup.querySelectorAll('button[data-quality]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const q = (btn as HTMLElement).dataset.quality as QualityPresetName;
        cb.onUiSound();
        cb.onQualitySelected(q);
        this.syncSettingsControls(quality);
      });
    });

    const drsBtn = document.getElementById('btn-toggle-drs')!;
    drsBtn.addEventListener('click', () => {
      cb.onUiSound();
      cb.onDrsToggled(!quality.dynamicResolutionEnabled);
      this.syncSettingsControls(quality);
    });

    const fpsBtn = document.getElementById('btn-toggle-fps')!;
    fpsBtn.addEventListener('click', () => {
      cb.onUiSound();
      cb.onTelemetryToggled(!quality.showTelemetry);
      this.syncSettingsControls(quality);
    });

    const volInput = document.getElementById('input-volume') as HTMLInputElement;
    const volLabel = document.getElementById('label-volume')!;
    volInput.addEventListener('input', () => {
      const pct = Number(volInput.value);
      volLabel.textContent = `${pct}%`;
      cb.onVolumeChanged(pct / 100);
    });

    // Controls Modal
    const closeControls = () => {
      cb.onUiSound();
      this.controlsModal.classList.remove('active');
    };
    document.getElementById('btn-close-controls')!.addEventListener('click', closeControls);
    document.getElementById('btn-ok-controls')!.addEventListener('click', closeControls);

    // Pause Overlay & HUD Pause button
    document.getElementById('btn-hud-pause')!.addEventListener('click', () => {
      cb.onUiSound();
      cb.onTogglePause();
    });
    document.getElementById('btn-resume')!.addEventListener('click', () => {
      cb.onUiSound(true);
      cb.onResume();
    });
    document.getElementById('btn-pause-restart')!.addEventListener('click', () => {
      cb.onUiSound(true);
      cb.onRestart();
    });
    document.getElementById('btn-pause-settings')!.addEventListener('click', () => {
      cb.onUiSound();
      this.settingsModal.classList.add('active');
    });
    document.getElementById('btn-pause-menu')!.addEventListener('click', () => {
      cb.onUiSound();
      cb.onReturnToMenu();
    });

    // Game Over Overlay
    document.getElementById('btn-play-again')!.addEventListener('click', () => {
      cb.onUiSound(true);
      cb.onRestart();
    });
    document.getElementById('btn-go-menu')!.addEventListener('click', () => {
      cb.onUiSound();
      cb.onReturnToMenu();
    });
  }

  public syncSettingsControls(quality: QualityManager): void {
    this.menuQualityBadge.textContent = quality.currentPreset;
    document.querySelectorAll('#quality-selector .seg-btn').forEach((el) => {
      const b = el as HTMLElement;
      b.classList.toggle('active', b.dataset.quality === quality.currentPreset);
    });

    const drsBtn = document.getElementById('btn-toggle-drs')!;
    drsBtn.textContent = quality.dynamicResolutionEnabled ? 'ENABLED' : 'DISABLED';
    drsBtn.classList.toggle('active', quality.dynamicResolutionEnabled);

    const fpsBtn = document.getElementById('btn-toggle-fps')!;
    fpsBtn.textContent = quality.showTelemetry ? 'VISIBLE' : 'HIDDEN';
    fpsBtn.classList.toggle('active', quality.showTelemetry);
    this.hudTelemetry.classList.toggle('hidden', !quality.showTelemetry);

    const volInput = document.getElementById('input-volume') as HTMLInputElement;
    const volLabel = document.getElementById('label-volume')!;
    const pct = Math.round(quality.masterVolume * 100);
    volInput.value = String(pct);
    volLabel.textContent = `${pct}%`;
  }

  public setLoadingProgress(pct: number, statusText: string): void {
    this.loadingFill.style.width = `${Math.max(5, Math.min(100, pct))}%`;
    this.loadingStatus.textContent = statusText;
  }

  public showMainMenu(bestScore: number): void {
    this.loadingOverlay.classList.remove('active');
    this.pauseOverlay.classList.remove('active');
    this.gameoverOverlay.classList.remove('active');
    this.hudOverlay.classList.remove('active');
    this.menuBestScore.textContent = bestScore.toLocaleString('en-US');
    this.menuOverlay.classList.add('active');
  }

  public showGameplayHUD(): void {
    this.loadingOverlay.classList.remove('active');
    this.menuOverlay.classList.remove('active');
    this.pauseOverlay.classList.remove('active');
    this.gameoverOverlay.classList.remove('active');
    this.settingsModal.classList.remove('active');
    this.controlsModal.classList.remove('active');
    this.hudOverlay.classList.add('active');
  }

  public setPaused(paused: boolean): void {
    this.pauseOverlay.classList.toggle('active', paused);
    if (!paused) {
      this.settingsModal.classList.remove('active');
    }
  }

  public showGameOver(stats: {
    finalScore: number;
    bestScore: number;
    isNewRecord: boolean;
    distanceKm: number;
    topSpeedKmh: number;
    nearMisses: number;
    reason: string;
  }): void {
    this.hudOverlay.classList.remove('active');
    this.pauseOverlay.classList.remove('active');

    this.goReason.textContent = stats.reason;
    this.goNewBest.classList.toggle('hidden', !stats.isNewRecord);
    this.goFinalScore.textContent = stats.finalScore.toLocaleString('en-US');
    this.goDistance.textContent = `${stats.distanceKm.toFixed(2)} km`;
    this.goTopSpeed.textContent = `${Math.round(stats.topSpeedKmh)} km/h`;
    this.goNearMisses.textContent = String(stats.nearMisses);
    this.goBestScore.textContent = stats.bestScore.toLocaleString('en-US');

    this.gameoverOverlay.classList.add('active');
  }

  public setCameraLabel(label: string): void {
    this.hudCameraName.textContent = label;
  }

  public showEventBanner(kicker: string, title: string, durationSec = 3.2): void {
    this.hudEventKicker.textContent = kicker;
    this.hudEventTitle.textContent = title;
    this.hudEventBanner.classList.add('active');
    if (this.bannerTimeout !== null) window.clearTimeout(this.bannerTimeout);
    this.bannerTimeout = window.setTimeout(() => {
      this.hudEventBanner.classList.remove('active');
    }, durationSec * 1000);
  }

  public pushCallout(text: string): void {
    const chip = document.createElement('div');
    chip.className = 'callout-chip';
    chip.textContent = text;
    this.hudCalloutFeed.appendChild(chip);
    while (this.hudCalloutFeed.children.length > 3) {
      this.hudCalloutFeed.removeChild(this.hudCalloutFeed.firstChild!);
    }
    window.setTimeout(() => {
      if (chip.parentElement) chip.parentElement.removeChild(chip);
    }, 1350);
  }

  public updateHUD(data: {
    score: number;
    distanceKm: number;
    nearMisses: number;
    combo: number;
    comboBar: number;
    integrity: number;
    speedKmh: number;
    gear: number;
    rpm: number;
    nitroCharge: number;
    isNitroActive: boolean;
    fps: number;
    avgMs: number;
    drawCalls: number;
  }): void {
    this.hudScore.textContent = Math.floor(data.score).toLocaleString('en-US');
    this.hudDistance.textContent = `${data.distanceKm.toFixed(2)} km`;
    this.hudNearMiss.textContent = String(data.nearMisses);

    this.hudCombo.textContent = `x${data.combo.toFixed(1)}`;
    this.hudComboBar.style.width = `${Math.round(data.comboBar * 100)}%`;
    this.hudComboBox.classList.toggle('hot', data.combo >= 2.0);

    const intPct = Math.ceil(data.integrity);
    this.hudIntegrityText.textContent = `${intPct}%`;
    this.hudIntegrityFill.style.width = `${intPct}%`;
    this.hudIntegrityFill.classList.toggle('warn', intPct <= 55 && intPct > 25);
    this.hudIntegrityFill.classList.toggle('critical', intPct <= 25);

    const spd = Math.round(data.speedKmh);
    this.hudSpeed.textContent = String(spd).padStart(3, '0');
    this.hudGear.textContent = data.gear === 0 ? 'R' : String(data.gear);

    const rpmPct = Math.min(100, Math.max(8, ((data.rpm - 900) / 7300) * 100));
    this.hudRpmFill.style.width = `${rpmPct.toFixed(1)}%`;

    const nitroPct = Math.round(data.nitroCharge);
    this.hudNitroPct.textContent = `${nitroPct}%`;
    this.hudNitroFill.style.width = `${nitroPct}%`;
    this.hudNitroFill.classList.toggle('active', data.isNitroActive);

    if (!this.hudTelemetry.classList.contains('hidden')) {
      this.hudTelemetry.textContent = `${Math.round(data.fps)} FPS • ${data.avgMs.toFixed(1)} ms • ${data.drawCalls} DC`;
    }
  }
}
