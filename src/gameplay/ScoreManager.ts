const BEST_SCORE_KEY = 'nightshift_best_score_v1';

export class ScoreManager {
  public score = 0;
  public bestScore = 0;
  public distanceMeters = 0;
  public topSpeedKmh = 0;
  public nearMisses = 0;
  public survivalTime = 0;

  public comboMultiplier = 1.0;
  public comboTimer = 0; // 0..1 normalized decay bar
  private readonly comboMaxDuration = 5.2;

  constructor() {
    this.loadBestScore();
  }

  public get distanceKm(): number {
    return this.distanceMeters / 1000;
  }

  public get difficulty(): number {
    // Ramps smoothly from 0.0 -> 1.4 over ~140 seconds + distance
    return Math.min(1.45, this.survivalTime / 110.0 + this.distanceKm * 0.08);
  }

  public update(dt: number, speedMps: number, speedKmh: number, isNitro: boolean, isWrecked: boolean): void {
    if (isWrecked) return;

    this.survivalTime += dt;
    const dMeters = Math.max(0, speedMps * dt);
    this.distanceMeters += dMeters;
    if (speedKmh > this.topSpeedKmh) {
      this.topSpeedKmh = speedKmh;
    }

    // High-speed Risk Bonus: driving >175 km/h sustains combo bar & multiplies distance points!
    const highSpeedRisk = speedKmh > 175 ? (speedKmh - 175) / 115 : 0;
    if (highSpeedRisk > 0.15) {
      this.comboTimer = Math.min(1.0, this.comboTimer + highSpeedRisk * 0.28 * dt);
    } else if (this.comboMultiplier > 1.0) {
      this.comboTimer -= (dt / this.comboMaxDuration);
      if (this.comboTimer <= 0) {
        this.comboTimer = 0;
        this.comboMultiplier = Math.max(1.0, +(this.comboMultiplier - 0.5).toFixed(1));
        if (this.comboMultiplier > 1.0) this.comboTimer = 0.65;
      }
    }

    const nitroBonus = isNitro ? 1.45 : 1.0;
    const baseRate = dMeters * (1.15 + highSpeedRisk * 1.85) * nitroBonus;
    this.score += baseRate * this.comboMultiplier;
  }

  public registerNearMiss(closingSpeedKmh: number): { points: number; multiplier: number } {
    this.nearMisses++;
    this.comboMultiplier = Math.min(8.0, +(this.comboMultiplier + 0.5).toFixed(1));
    this.comboTimer = 1.0;

    const speedBonus = Math.round(Math.max(0, closingSpeedKmh - 60) * 1.8);
    const points = Math.round((250 + speedBonus) * this.comboMultiplier);
    this.score += points;
    return { points, multiplier: this.comboMultiplier };
  }

  public registerBonus(rawPoints: number): number {
    const pts = Math.round(rawPoints * Math.max(1.0, this.comboMultiplier * 0.5));
    this.score += pts;
    this.comboTimer = 1.0;
    return pts;
  }

  public onCollisionPenalty(): void {
    this.comboMultiplier = 1.0;
    this.comboTimer = 0;
  }

  public finalizeRun(): { isNewRecord: boolean; finalScore: number; bestScore: number } {
    const finalScore = Math.floor(this.score);
    let isNewRecord = false;
    if (finalScore > this.bestScore) {
      this.bestScore = finalScore;
      isNewRecord = true;
      this.saveBestScore();
    }
    return { isNewRecord, finalScore, bestScore: this.bestScore };
  }

  public reset(): void {
    this.score = 0;
    this.distanceMeters = 0;
    this.topSpeedKmh = 0;
    this.nearMisses = 0;
    this.survivalTime = 0;
    this.comboMultiplier = 1.0;
    this.comboTimer = 0;
  }

  private loadBestScore(): void {
    try {
      const v = Number(localStorage.getItem(BEST_SCORE_KEY) || '0');
      if (Number.isFinite(v) && v > 0) this.bestScore = Math.floor(v);
    } catch {
      // Ignore storage errors
    }
  }

  private saveBestScore(): void {
    try {
      localStorage.setItem(BEST_SCORE_KEY, String(this.bestScore));
    } catch {
      // Ignore storage errors
    }
  }
}
