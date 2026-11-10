// NIGHTSHIFT tanıtım videosu — sanal zaman kancası (Playwright addInitScript ile sayfa betiklerinden ÖNCE yüklenir).
// Oyun koduna dokunmaz; yalnız tarayıcının zaman API'lerini sarar:
//  - requestAnimationFrame / performance.now / Date.now / setTimeout  -> sanal saat (kayıt modunda)
//  - CSS animasyon / geçişleri (document.getAnimations)                -> sanal saatle ilerler
//  - AudioContext                                                     -> OfflineAudioContext, kare kare suspend/resume
//  - Math.random                                                      -> tohumlu PRNG (tekrarlanabilir koreografi)
(() => {
  const realRAF = window.requestAnimationFrame.bind(window);
  const realCAF = window.cancelAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  const realDateNow = Date.now.bind(Date);
  const realSetTimeout = window.setTimeout.bind(window);
  const realClearTimeout = window.clearTimeout.bind(window);
  const NativeOffline = window.OfflineAudioContext;

  const AUDIO_SR = 76800; // 76800 / 60 fps = 1280 örnek = tam 10 render kuantumu (128) -> kayma yok
  const AUDIO_MAX_SEC = 200;

  let seedState = 0x9e3779b9;
  function mulberry32() {
    seedState |= 0;
    seedState = (seedState + 0x6d2b79f5) | 0;
    let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  Math.random = mulberry32;

  const vt = {
    enabled: false,
    now: 0,
    dateOffset: 0,
    frame: 0,
    rafQueue: [],
    timers: [],
    nextId: 50_000_000,
    anims: new Map(),
    audio: null,
    audioEnabled: false,
    fps: 60,
  };
  window.__VT__ = vt;

  vt.seed = (s) => {
    seedState = s >>> 0;
  };

  window.requestAnimationFrame = (cb) => {
    if (vt.enabled) {
      const id = vt.nextId++;
      vt.rafQueue.push({ id, cb });
      return id;
    }
    // Gerçek rAF; kayıt modu bu arada açılırsa geri çağrıyı sanal kuyruğa aktar
    return realRAF((t) => {
      if (vt.enabled) vt.rafQueue.push({ id: -1, cb });
      else cb(t);
    });
  };
  window.cancelAnimationFrame = (id) => {
    const i = vt.rafQueue.findIndex((e) => e.id === id);
    if (i >= 0) vt.rafQueue.splice(i, 1);
    else realCAF(id);
  };
  performance.now = () => (vt.enabled ? vt.now : realNow());
  Date.now = () => (vt.enabled ? Math.floor(vt.now + vt.dateOffset) : realDateNow());

  window.setTimeout = (fn, delay = 0, ...args) => {
    if (!vt.enabled) return realSetTimeout(fn, delay, ...args);
    const id = vt.nextId++;
    vt.timers.push({ id, due: vt.now + Math.max(0, Number(delay) || 0), fn, args });
    return id;
  };
  window.clearTimeout = (id) => {
    const i = vt.timers.findIndex((t) => t.id === id);
    if (i >= 0) vt.timers.splice(i, 1);
    else realClearTimeout(id);
  };

  vt.enable = () => {
    vt.now = realNow();
    vt.dateOffset = realDateNow() - vt.now;
    vt.enabled = true;
    vt.sweepAnims(0);
  };

  // CSS animasyon / geçişlerini sanal saate bağla: hepsini duraklat, currentTime'ı elle ilerlet
  vt.sweepAnims = (dtMs) => {
    const list = document.getAnimations();
    const alive = new Set(list);
    for (const a of list) {
      if (!vt.anims.has(a)) {
        try {
          const ct = typeof a.currentTime === 'number' ? a.currentTime : 0;
          a.pause();
          a.currentTime = ct;
          vt.anims.set(a, ct);
        } catch {
          /* yok say */
        }
      } else if (dtMs > 0) {
        const t = vt.anims.get(a) + dtMs;
        vt.anims.set(a, t);
        try {
          a.currentTime = t;
        } catch {
          /* yok say */
        }
      }
    }
    for (const a of vt.anims.keys()) if (!alive.has(a)) vt.anims.delete(a);
  };

  // ---- Ses: AudioContext -> OfflineAudioContext (kare kare işlenir) ----
  const RealAudioContext = window.AudioContext;
  function PatchedAudioContext() {
    if (!vt.audioEnabled) return new RealAudioContext();
    const ctx = new NativeOffline({ numberOfChannels: 2, length: AUDIO_SR * AUDIO_MAX_SEC, sampleRate: AUDIO_SR });
    const nativeSuspend = NativeOffline.prototype.suspend;
    const nativeResume = NativeOffline.prototype.resume;
    Object.defineProperty(ctx, 'state', { get: () => 'running', configurable: true });
    ctx.resume = () => Promise.resolve();
    ctx.suspend = () => Promise.resolve();
    ctx.close = () => Promise.resolve();
    vt.audio = {
      ctx,
      k: 0,
      started: false,
      startFrame: vt.frame + 1, // ses örneği 0 = bir sonraki adımın karesi
      samplesPerFrame: AUDIO_SR / vt.fps,
      suspendAt: (t) => nativeSuspend.call(ctx, t),
      resumeNative: () => nativeResume.call(ctx),
      renderPromise: null,
    };
    return ctx;
  }
  window.AudioContext = PatchedAudioContext;
  window.webkitAudioContext = PatchedAudioContext;

  async function audioAdvance() {
    const a = vt.audio;
    if (!a) return;
    a.k++;
    const p = a.suspendAt((a.k * a.samplesPerFrame) / AUDIO_SR);
    if (!a.started) {
      a.started = true;
      a.renderPromise = a.ctx.startRendering();
    } else {
      a.resumeNative();
    }
    await p;
  }

  // Tek sanal kare: saat ilerler, zamanlayıcılar, rAF (oyun karesi), CSS animasyonları, ses
  vt.step = async () => {
    const dtMs = 1000 / vt.fps;
    vt.frame++;
    vt.now += dtMs;
    // vadesi gelen setTimeout'lar
    for (;;) {
      vt.timers.sort((x, y) => x.due - y.due);
      if (!vt.timers.length || vt.timers[0].due > vt.now) break;
      const t = vt.timers.shift();
      try {
        t.fn(...t.args);
      } catch (e) {
        console.error('[vt timer]', e);
      }
    }
    const q = vt.rafQueue;
    vt.rafQueue = [];
    for (const e of q) {
      try {
        e.cb(vt.now);
      } catch (err) {
        console.error('[vt raf]', err);
      }
    }
    vt.sweepAnims(dtMs);
    await audioAdvance();
    return vt.frame;
  };

  // Trafik havuzunu salt-okur yakala (otomatik pilot için): oyun menüde `for (const v of traffic.vehicles)` döner;
  // dizi yineleyicisini bir kez sarıp o diziyi tanırız, sonra özgün yineleyiciyi geri koyarız.
  const origIter = Array.prototype[Symbol.iterator];
  vt.traffic = null;
  vt.hookTraffic = () => {
    Array.prototype[Symbol.iterator] = function () {
      if (!vt.traffic && this.length > 3) {
        const e = this[0];
        if (e && typeof e === 'object' && e.pos && e.vel && 'nearMissAwarded' in e && 'halfLength' in e) {
          vt.traffic = this;
          Array.prototype[Symbol.iterator] = origIter;
        }
      }
      return origIter.call(this);
    };
  };
  vt.trafficSnap = () => {
    if (!vt.traffic) return null;
    const out = [];
    for (let i = 0; i < vt.traffic.length; i++) {
      const v = vt.traffic[i];
      if (!v.active) continue;
      out.push([+v.pos.x.toFixed(2), +v.pos.z.toFixed(2), +v.vel.z.toFixed(2), v.halfLength, v.halfWidth, v.kind, v.state[0]]);
    }
    return out;
  };

  // Kayıt sonunda: kalan sesi işle, istenen örnekleri 16-bit PCM olarak hazırla
  vt.finishAudio = async () => {
    const a = vt.audio;
    if (!a || !a.started) return null;
    const used = Math.round(a.k * a.samplesPerFrame);
    a.resumeNative();
    const buf = await a.renderPromise;
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const pcm = new Int16Array(used * 2);
    let peak = 0;
    for (let i = 0; i < used; i++) {
      const l = Math.max(-1, Math.min(1, L[i]));
      const r = Math.max(-1, Math.min(1, R[i]));
      peak = Math.max(peak, Math.abs(l), Math.abs(r));
      pcm[i * 2] = l * 32767;
      pcm[i * 2 + 1] = r * 32767;
    }
    vt.pcm = pcm;
    return { samples: used, sampleRate: AUDIO_SR, startFrame: a.startFrame, frames: a.k, peak };
  };
  vt.pcmChunk = (offset, count) => {
    const sub = new Uint8Array(vt.pcm.buffer, offset * 2, Math.min(count, vt.pcm.length - offset) * 2);
    let s = '';
    for (let i = 0; i < sub.length; i += 0x8000) s += String.fromCharCode.apply(null, sub.subarray(i, i + 0x8000));
    return btoa(s);
  };
})();
