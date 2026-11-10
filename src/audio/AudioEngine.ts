export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain!: GainNode;
  private compressor!: DynamicsCompressorNode;
  private tunnelConvolver!: ConvolverNode;
  private tunnelWetGain!: GainNode;

  // Continuous vehicle & storm loops
  private engineOsc1!: OscillatorNode;
  private engineOsc2!: OscillatorNode;
  private engineSubOsc!: OscillatorNode;
  private engineFilter!: BiquadFilterNode;
  private engineGain!: GainNode;

  private rainGain!: GainNode;
  private rainFilter!: BiquadFilterNode;
  private tireWetGain!: GainNode;
  private windGain!: GainNode;
  private screechGain!: GainNode;
  private screechFilter!: BiquadFilterNode;
  private nitroGain!: GainNode;
  private nitroOsc!: OscillatorNode;

  private noiseBuffer!: AudioBuffer;
  private volume = 0.8;
  private initialized = false;
  private mutedByPause = false;
  private prevGear = 1;

  public setMasterVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.mutedByPause ? 0 : this.volume, this.ctx.currentTime, 0.04);
    }
  }

  public setPaused(paused: boolean): void {
    this.mutedByPause = paused;
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(paused ? 0.05 * this.volume : this.volume, this.ctx.currentTime, 0.06);
    }
  }

  public unlock(): void {
    if (!this.initialized) {
      this.initGraph();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  private initGraph(): void {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    } catch {
      return;
    }

    const ctx = this.ctx;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -10;
    this.compressor.knee.value = 14;
    this.compressor.ratio.value = 6;
    this.compressor.attack.value = 0.004;
    this.compressor.release.value = 0.18;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.volume;
    this.compressor.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    // 2.5s stereo white/pink-ish noise buffer for rain, hydro-spray, wind & blast rumble
    const sampleRate = ctx.sampleRate;
    const len = sampleRate * 3;
    this.noiseBuffer = ctx.createBuffer(2, len, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = this.noiseBuffer.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + white * 0.029;
        b1 = 0.985 * b1 + white * 0.032;
        b2 = 0.950 * b2 + white * 0.048;
        data[i] = (b0 + b1 + b2 + white * 0.18) * 0.55;
      }
    }

    // Synthetic Tunnel Impulse Response for cavernous highway tunnel acoustics!
    const irLen = Math.floor(sampleRate * 1.15);
    const irBuf = ctx.createBuffer(2, irLen, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = irBuf.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        const t = i / irLen;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6) * 0.5;
      }
    }
    this.tunnelConvolver = ctx.createConvolver();
    this.tunnelConvolver.buffer = irBuf;
    this.tunnelWetGain = ctx.createGain();
    this.tunnelWetGain.gain.value = 0.0;
    this.tunnelConvolver.connect(this.tunnelWetGain);
    this.tunnelWetGain.connect(this.compressor);

    // 1. Multi-harmonic Sports Supercar Engine
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 420;
    this.engineFilter.Q.value = 2.4;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.0;

    this.engineOsc1 = ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc1.frequency.value = 55;

    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'triangle';
    this.engineOsc2.frequency.value = 110;

    this.engineSubOsc = ctx.createOscillator();
    this.engineSubOsc.type = 'sine';
    this.engineSubOsc.frequency.value = 27.5;

    const subGain = ctx.createGain();
    subGain.gain.value = 0.55;
    this.engineSubOsc.connect(subGain);
    subGain.connect(this.engineGain);

    this.engineOsc1.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.compressor);
    this.engineGain.connect(this.tunnelConvolver);

    this.engineOsc1.start();
    this.engineOsc2.start();
    this.engineSubOsc.start();

    // 2. Midnight Rain Downpour Loop
    const rainSrc = this.createLoopNoise(ctx);
    this.rainFilter = ctx.createBiquadFilter();
    this.rainFilter.type = 'bandpass';
    this.rainFilter.frequency.value = 1350;
    this.rainFilter.Q.value = 0.55;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0.14;
    rainSrc.connect(this.rainFilter);
    this.rainFilter.connect(this.rainGain);
    this.rainGain.connect(this.compressor);

    // 3. Wet Tire Hydro-Shearing Loop
    const tireSrc = this.createLoopNoise(ctx);
    const tireFilter = ctx.createBiquadFilter();
    tireFilter.type = 'bandpass';
    tireFilter.frequency.value = 2850;
    tireFilter.Q.value = 0.9;
    this.tireWetGain = ctx.createGain();
    this.tireWetGain.gain.value = 0.0;
    tireSrc.connect(tireFilter);
    tireFilter.connect(this.tireWetGain);
    this.tireWetGain.connect(this.compressor);

    // 4. High-Speed Aerodynamic Wind Rush
    const windSrc = this.createLoopNoise(ctx);
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 340;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.0;
    windSrc.connect(windFilter);
    windFilter.connect(this.windGain);
    this.windGain.connect(this.compressor);

    // 5. Tire Lateral Slip / Brake Screech
    const screechSrc = this.createLoopNoise(ctx);
    this.screechFilter = ctx.createBiquadFilter();
    this.screechFilter.type = 'bandpass';
    this.screechFilter.frequency.value = 1650;
    this.screechFilter.Q.value = 9.5;
    this.screechGain = ctx.createGain();
    this.screechGain.gain.value = 0.0;
    screechSrc.connect(this.screechFilter);
    this.screechFilter.connect(this.screechGain);
    this.screechGain.connect(this.compressor);

    // 6. Nitro Turbine Afterburner Loop
    const nitroNoise = this.createLoopNoise(ctx);
    const nitroFilter = ctx.createBiquadFilter();
    nitroFilter.type = 'bandpass';
    nitroFilter.frequency.value = 950;
    nitroFilter.Q.value = 1.6;
    this.nitroOsc = ctx.createOscillator();
    this.nitroOsc.type = 'sine';
    this.nitroOsc.frequency.value = 320;
    const nitroOscGain = ctx.createGain();
    nitroOscGain.gain.value = 0.25;
    this.nitroOsc.connect(nitroOscGain);

    this.nitroGain = ctx.createGain();
    this.nitroGain.gain.value = 0.0;
    nitroNoise.connect(nitroFilter);
    nitroFilter.connect(this.nitroGain);
    nitroOscGain.connect(this.nitroGain);
    this.nitroGain.connect(this.compressor);
    this.nitroOsc.start();

    this.initialized = true;
  }

  private createLoopNoise(ctx: AudioContext): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.loopStart = Math.random() * 0.4;
    src.start();
    return src;
  }

  public updateContinuous(params: {
    activeGameplay: boolean;
    rpm: number;
    gear: number;
    throttle: number;
    speedKmh: number;
    slipRatio: number;
    isBraking: boolean;
    isNitro: boolean;
    inTunnel: boolean;
  }): void {
    if (!this.initialized || !this.ctx) return;
    const t = this.ctx.currentTime;

    if (!params.activeGameplay) {
      // Subtle showcase idle engine purr + midnight rain on Main Menu
      this.engineOsc1.frequency.setTargetAtTime(42, t, 0.08);
      this.engineOsc2.frequency.setTargetAtTime(84.5, t, 0.08);
      this.engineSubOsc.frequency.setTargetAtTime(21, t, 0.08);
      this.engineFilter.frequency.setTargetAtTime(240, t, 0.08);
      this.engineGain.gain.setTargetAtTime(0.055, t, 0.1);
      this.rainGain.gain.setTargetAtTime(0.16, t, 0.1);
      this.tireWetGain.gain.setTargetAtTime(0.0, t, 0.1);
      this.windGain.gain.setTargetAtTime(0.0, t, 0.1);
      this.screechGain.gain.setTargetAtTime(0.0, t, 0.1);
      this.nitroGain.gain.setTargetAtTime(0.0, t, 0.1);
      this.tunnelWetGain.gain.setTargetAtTime(0.0, t, 0.1);
      return;
    }

    // Gearshift turbo blow-off chirp
    if (params.gear !== this.prevGear && params.gear > this.prevGear && params.speedKmh > 60) {
      this.playGearShiftFlutter();
    }
    this.prevGear = params.gear;

    const baseFreq = 34 + (params.rpm / 8200) * 198;
    this.engineOsc1.frequency.setTargetAtTime(baseFreq, t, 0.035);
    this.engineOsc2.frequency.setTargetAtTime(baseFreq * 1.502, t, 0.035);
    this.engineSubOsc.frequency.setTargetAtTime(baseFreq * 0.5, t, 0.035);

    const loadCutoff = 280 + (params.rpm / 8200) * 1850 + params.throttle * 680 + (params.isNitro ? 550 : 0);
    this.engineFilter.frequency.setTargetAtTime(loadCutoff, t, 0.04);
    this.engineGain.gain.setTargetAtTime(0.11 + params.throttle * 0.065, t, 0.05);

    // Tunnel acoustics: rain muffles dramatically overhead while cavernous engine reverb blooms!
    this.rainGain.gain.setTargetAtTime(params.inTunnel ? 0.025 : 0.15, t, 0.18);
    this.rainFilter.frequency.setTargetAtTime(params.inTunnel ? 420 : 1450, t, 0.18);
    this.tunnelWetGain.gain.setTargetAtTime(params.inTunnel ? 0.42 : 0.04, t, 0.18);

    // Wet tire hydro-spray hiss
    const speedNorm = Math.min(1.2, params.speedKmh / 260);
    const wetFactor = params.inTunnel ? 0.25 : 1.0;
    this.tireWetGain.gain.setTargetAtTime(speedNorm * 0.13 * wetFactor, t, 0.06);

    // High-speed wind rush
    this.windGain.gain.setTargetAtTime(Math.max(0, speedNorm - 0.25) * 0.20, t, 0.08);

    // Tire slip / hard wet brake squeal
    const brakeSlip = params.isBraking && params.speedKmh > 85 ? 0.35 : 0;
    const totalSlip = Math.min(1.0, params.slipRatio + brakeSlip);
    this.screechGain.gain.setTargetAtTime(totalSlip > 0.22 ? (totalSlip - 0.2) * 0.09 : 0, t, 0.04);
    this.screechFilter.frequency.setTargetAtTime(1450 + totalSlip * 520, t, 0.05);

    // Nitro turbine roar
    this.nitroGain.gain.setTargetAtTime(params.isNitro ? 0.18 : 0.0, t, 0.05);
    this.nitroOsc.frequency.setTargetAtTime(params.isNitro ? 420 + speedNorm * 380 : 280, t, 0.08);
  }

  private playGearShiftFlutter(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(3200, t);
    bp.frequency.exponentialRampToValueAtTime(1400, t + 0.11);
    bp.Q.value = 3.5;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.compressor);
    src.start(t);
    src.stop(t + 0.13);
  }

  public playNearMissWhoosh(): void {
    if (!this.initialized || !this.ctx) return;
    const t = this.ctx.currentTime;

    // 1. Aerodynamic Doppler pass-by whoosh
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.8;
    bp.frequency.setValueAtTime(980, t);
    bp.frequency.exponentialRampToValueAtTime(220, t + 0.26);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);

    src.connect(bp);
    bp.connect(g);
    g.connect(this.compressor);
    src.start(t);
    src.stop(t + 0.3);

    // 2. Crisp modern harmonic confirmation pulse
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(587.33, t);
    osc.frequency.setValueAtTime(880.0, t + 0.055);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.06, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(og);
    og.connect(this.compressor);
    osc.start(t);
    osc.stop(t + 0.24);
  }

  public playImpact(severity: number): void {
    if (!this.initialized || !this.ctx) return;
    const t = this.ctx.currentTime;
    const s = Math.max(0.2, Math.min(1.2, severity));

    // Metallic chassis thud + crunch noise
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(125, t);
    sub.frequency.exponentialRampToValueAtTime(34, t + 0.22);
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0.38 * s, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    sub.connect(sg);
    sg.connect(this.compressor);
    sub.start(t);
    sub.stop(t + 0.26);

    const crunch = this.ctx.createBufferSource();
    crunch.buffer = this.noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 1850;
    hp.Q.value = 1.1;
    const cg = this.ctx.createGain();
    cg.gain.setValueAtTime(0.28 * s, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    crunch.connect(hp);
    hp.connect(cg);
    cg.connect(this.compressor);
    crunch.start(t);
    crunch.stop(t + 0.25);
  }

  /**
   * 4-Layer Coordinated Cinematic Explosion Sound:
   * 1. Sub-bass shockwave chest punch (68Hz -> 24Hz)
   * 2. Sharp detonation transient crack
   * 3. Deep roaring hydrocarbon fireball rumble
   * 4. Metallic shrapnel & glass debris tail
   */
  public playExplosion(distanceMeters: number, scale = 1.0): void {
    if (!this.initialized || !this.ctx) return;
    const t = this.ctx.currentTime;
    const distAtten = Math.max(0.15, Math.min(1.0, 1.0 - distanceMeters / 185.0)) * Math.min(1.35, scale);

    // Layer 1: Sub-bass pressure wave
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(76, t);
    sub.frequency.exponentialRampToValueAtTime(24, t + 0.65);
    const subG = this.ctx.createGain();
    subG.gain.setValueAtTime(0.65 * distAtten, t);
    subG.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
    sub.connect(subG);
    subG.connect(this.compressor);
    sub.start(t);
    sub.stop(t + 0.78);

    // Layer 2: High-SPL Detonation Transient Crack
    const crack = this.ctx.createBufferSource();
    crack.buffer = this.noiseBuffer;
    const crackBp = this.ctx.createBiquadFilter();
    crackBp.type = 'highpass';
    crackBp.frequency.value = 950;
    const crackG = this.ctx.createGain();
    crackG.gain.setValueAtTime(0.45 * distAtten, t);
    crackG.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    crack.connect(crackBp);
    crackBp.connect(crackG);
    crackG.connect(this.compressor);
    crack.start(t);
    crack.stop(t + 0.15);

    // Layer 3: Rolling Fireball Low-Pass Roar
    const roar = this.ctx.createBufferSource();
    roar.buffer = this.noiseBuffer;
    const roarLp = this.ctx.createBiquadFilter();
    roarLp.type = 'lowpass';
    roarLp.frequency.setValueAtTime(520, t);
    roarLp.frequency.exponentialRampToValueAtTime(95, t + 1.8);
    const roarG = this.ctx.createGain();
    roarG.gain.setValueAtTime(0.52 * distAtten, t + 0.02);
    roarG.gain.exponentialRampToValueAtTime(0.001, t + 1.9);
    roar.connect(roarLp);
    roarLp.connect(roarG);
    roarG.connect(this.compressor);
    roarG.connect(this.tunnelConvolver);
    roar.start(t);
    roar.stop(t + 1.95);
  }

  public playLightningCrack(): void {
    if (!this.initialized || !this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2400, t);
    bp.frequency.exponentialRampToValueAtTime(380, t + 0.55);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.compressor);
    src.start(t);
    src.stop(t + 0.62);
  }

  public playUiClick(isPrimary = false): void {
    this.unlock();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isPrimary ? 520 : 420, t);
    osc.frequency.exponentialRampToValueAtTime(isPrimary ? 780 : 310, t + 0.07);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(g);
    g.connect(this.compressor);
    osc.start(t);
    osc.stop(t + 0.09);
  }
}
