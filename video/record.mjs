// NIGHTSHIFT (Gemini) tanıtım videosu — kare kare kayıt.
// Oyun koduna dokunmaz: dist/ statik sunulur, sanal zaman kancası (vt_harness.js) ile her kare tek tek ilerletilir,
// CDP Page.captureScreenshot ile yakalanıp ffmpeg'e borulanır; oyunun Web Audio sesi OfflineAudioContext ile
// kareyle senkron işlenip WAV yazılır.
//
// Kullanım:  node video/record.mjs [--dry] [--quality ULTRA|HIGH] [--dpr 1] [--seed 1234] [--out video/raw/take]
//   --dry    : yakalama yok, yalnız koreografi denemesi (durum günlüğü)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const DRY = args.includes('--dry');
const QUALITY = opt('quality', 'ULTRA');
const DPR = Number(opt('dpr', '1'));
const SEED = Number(opt('seed', '20261110'));
const OUT = path.resolve(opt('out', 'video/raw/take'));
const MAX_DRIVE_SEC = Number(opt('maxsec', '70'));
const FPS = 60;
const MENU_SEC = Number(opt('menusec', '4.5'));

const ROOT = path.resolve('.');
const DIST_DIR = path.join(ROOT, 'dist');
const HARNESS = fs.readFileSync(path.join(ROOT, 'video', 'vt_harness.js'), 'utf8');
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};
function serve(root, port) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const u = decodeURIComponent((req.url || '/').split('?')[0]);
      let f = path.join(root, u === '/' ? 'index.html' : u);
      if (!f.startsWith(root)) { res.writeHead(403); res.end(); return; }
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, 'index.html');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

// Tuş kuyruğu: bir sonraki karenin adımından hemen önce sayfada gönderilir
const keyQueue = [];
const kd = (code) => { keyQueue.push(['keydown', code]); };
const ku = (code) => { keyQueue.push(['keyup', code]); };
const kp = (code) => { kd(code); ku(code); };

// ---------------- Otomatik pilot ----------------
const LANES = [-5.7, -1.9, 1.9, 5.7];
const P_HALF_W = 1.0;
const ap = {
  lane: 2,
  allowed: [0, 1, 2, 3],
  nearMissSeek: true,
  kamikaze: false,
  targetX: LANES[2],
  prevX: 1.9,
  keyL: false,
  keyR: false,
  pwmAcc: 0,
  brake: false,
  braking: false,
  victim: null,
};

function laneAhead(lx, pz, traffic, range = 260) {
  // Bu şerit hattında öndeki en yakın engel (m); kaza yapmış araçlar daha geniş sayılır
  let ahead = range;
  for (const [x, z, , hl, hw, , st] of traffic) {
    const m = hw + P_HALF_W + (st === 'C' ? 1.8 : 0.6);
    if (Math.abs(x - lx) > m) continue;
    const dz = pz - z; // >0 önde
    if (dz > -hl && dz - hl < ahead) ahead = Math.max(0, dz - hl);
  }
  return ahead;
}

function corridorBlocked(px, lx, pz, traffic) {
  // Şu anki x'ten hedef şerit merkezine yanal geçiş koridorunda yanımızda / az önümüzde araç var mı
  const lo = Math.min(px, lx);
  const hi = Math.max(px, lx);
  for (const [x, z, , hl, hw, , st] of traffic) {
    const m = hw + P_HALF_W + (st === 'C' ? 1.5 : 0.45);
    if (x < lo - m || x > hi + m) continue;
    if (Math.abs(x - lx) < m && Math.abs(x - px) < m) continue; // aynı hatta, öndeki engel laneAhead'de
    const dz = pz - z;
    if (dz > -hl - 5 && dz < hl + 14) return true;
  }
  return false;
}

function chooseLane(st, traffic) {
  const px = st.position.x;
  const pz = st.position.z;
  ap.brake = false;
  if (ap.kamikaze) {
    // Final: öndeki en yakın ağır araca (TANKER/TRUCK) dal; hedefe kilitlen
    if (ap.victim) {
      const v = traffic.find((t) => Math.abs(t[1] - ap.victim.z) < 40 && Math.abs(t[0] - ap.victim.x) < 3 && t[5] === ap.victim.kind);
      if (v) { ap.victim = { x: v[0], z: v[1], kind: v[5] }; ap.targetX = v[0]; return; }
    }
    let best = null;
    for (const [x, z, , , , kind, s] of traffic) {
      const dz = pz - z;
      if (s !== 'D' || dz < 25 || dz > 260) continue;
      const w = (kind === 'TANKER' ? 0 : kind === 'TRUCK' ? 60 : 160) + dz;
      if (!best || w < best.w) best = { x, z, kind, w };
    }
    if (best) { ap.victim = best; ap.targetX = best.x; return; }
  }
  const scores = LANES.map((lx, i) => {
    if (!ap.allowed.includes(i)) return -1e6;
    const ahead = laneAhead(lx, pz, traffic);
    const moving = Math.abs(lx - px) > 0.8;
    if (moving && i !== ap.lane && corridorBlocked(px, lx, pz, traffic)) return -1e5 + ahead;
    return ahead - Math.abs(lx - px) * 3 + (i === ap.lane ? 30 : 0);
  });
  let bestLane = ap.allowed.includes(ap.lane) ? ap.lane : ap.allowed[0];
  for (let i = 0; i < 4; i++) if (scores[i] > scores[bestLane]) bestLane = i;
  ap.lane = bestLane;
  let tx = LANES[bestLane];

  // NEAR MISS arayışı: komşu şeritte yanından geçeceğimiz araca yaklaş (yakın geçiş penceresi ~2.0–3.5 m yanal)
  if (ap.nearMissSeek && st.speedKmh > 115 && Math.abs(px - tx) < 0.9) {
    let pull = 0;
    let bestDz = 1e9;
    for (const [x, z, , hl, hw, , s] of traffic) {
      if (s !== 'D') continue;
      const dz = pz - z;
      const dx = x - tx;
      if (Math.abs(dx) < 3.0 || Math.abs(dx) > 4.4) continue;
      if (dz < -hl || dz > 40) continue;
      if (dz < bestDz) { bestDz = dz; pull = Math.sign(dx) * Math.max(0, Math.min(1.0, Math.abs(dx) - (hw + P_HALF_W + 0.8))); }
    }
    if (pull !== 0 && laneAhead(tx + pull, pz, traffic, 60) > 45 && !corridorBlocked(px, tx + pull, pz, traffic)) tx += pull;
  }
  ap.targetX = Math.max(-7.6, Math.min(7.6, tx));

  // Emniyet freni: kendi hattımızda yakın engel varsa
  const own = laneAhead(px, pz, traffic, 100);
  const closing = st.speedKmh / 3.6 - 30;
  if (own < Math.max(14, closing * 0.9)) ap.brake = true;
}

async function steer(page, st) {
  const x = st.position.x;
  const vx = (x - ap.prevX) * FPS;
  ap.prevX = x;
  const err = ap.targetX - x;
  const vDes = Math.max(-5.5, Math.min(5.5, err * 2.4));
  const u = (vDes - vx) * 0.5; // >0 => sağa (D)
  // PWM: |u| oranında tuşa bas
  ap.pwmAcc += Math.min(1, Math.abs(u));
  let wantL = false;
  let wantR = false;
  if (Math.abs(u) > 0.06 && ap.pwmAcc >= 1) {
    ap.pwmAcc -= 1;
    if (u > 0) wantR = true; else wantL = true;
  }
  if (Math.abs(u) <= 0.06) ap.pwmAcc = 0;
  if (wantL !== ap.keyL) { ap.keyL = wantL; await (wantL ? kd('KeyA') : ku('KeyA')); }
  if (wantR !== ap.keyR) { ap.keyR = wantR; await (wantR ? kd('KeyD') : ku('KeyD')); }
  if (ap.brake !== ap.braking && !ap.kamikaze) {
    ap.braking = ap.brake;
    if (ap.brake) { ku('KeyW'); kd('KeyS'); } else { ku('KeyS'); kd('KeyW'); }
  }
}

// ---------------- Ana akış ----------------
async function main() {
  const port = 4191;
  const server = await serve(DIST_DIR, port);
  const chromeExe = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const launch = {
    headless: true,
    args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist',
      '--disable-frame-rate-limit', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  };
  if (fs.existsSync(chromeExe)) launch.executablePath = chromeExe;
  const browser = await chromium.launch(launch);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: DPR });
  await context.addInitScript({ content: HARNESS });
  await context.addInitScript({
    content: `try{localStorage.setItem('nightshift_settings_v1', JSON.stringify({preset:${JSON.stringify(QUALITY)},drs:false,vol:0.9,telemetry:false}));}catch(e){}`,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__NIGHTSHIFT_DEBUG__?.getState().state === 'MENU', null, { timeout: 30000 });
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const d = gl?.getExtension('WEBGL_debug_renderer_info');
    return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  const initState = await page.evaluate(() => window.__NIGHTSHIFT_DEBUG__.getState());
  console.log('GPU:', gpu, '| quality:', initState.quality, '| drs:', initState.drsScale);
  if (initState.quality !== QUALITY) console.log('UYARI: kalite ayarı uygulanmadı, depolama anahtarı farklı olabilir');

  // Sayfa yüklenip ısınsın (gerçek zaman), sonra sanal zamana geç
  await page.waitForTimeout(1500);
  await page.evaluate((seed) => { window.__VT__.seed(seed); window.__VT__.audioEnabled = true; window.__VT__.hookTraffic(); window.__VT__.enable(); }, SEED);

  const cdp = await context.newCDPSession(page);
  let ff = null;
  if (!DRY) {
    ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
      ...(DPR !== 1 ? ['-vf', 'scale=1920:1080:flags=lanczos'] : []),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '10', '-pix_fmt', 'yuv420p', '-r', String(FPS), `${OUT}.mp4`],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  }
  const log = [];
  let captured = 0;
  const t0 = Date.now();

  async function frame(extra) {
    const keys = keyQueue.splice(0);
    const r = await page.evaluate(async (keys) => {
      const vt = window.__VT__;
      // Tuş olayları adımla aynı çağrıda, adımdan hemen önce (deterministik giriş)
      for (const [type, code] of keys) window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
      const f = await vt.step();
      const s = window.__NIGHTSHIFT_DEBUG__.getState();
      return { f, s, tr: vt.trafficSnap() };
    }, keys);
    if (ff) {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
      const buf = Buffer.from(shot.data, 'base64');
      if (!ff.stdin.write(buf)) await new Promise((res) => ff.stdin.once('drain', res));
    }
    const s = r.s;
    log.push({ i: captured, f: r.f, st: s.state, x: s.position.x, z: s.position.z, v: s.speedKmh, nm: s.nearMisses,
      hp: s.integrity, n: s.nitro, cam: s.cameraMode, tun: s.inTunnel, sc: s.score, tx: +ap.targetX.toFixed(2), near: (r.tr || []).filter((v) => Math.abs(v[1] - s.position.z) < 40).map((v) => [v[0], +(s.position.z - v[1]).toFixed(1), v[5][0], v[6]]), ...(extra || {}) });
    captured++;
    if (captured % 300 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(`kare ${captured} (${(captured / FPS).toFixed(1)} sn) ${s.state} z=${s.position.z} v=${s.speedKmh} nm=${s.nearMisses} hp=${s.integrity} n=${s.nitro} tun=${s.inTunnel} | ${el.toFixed(0)} sn gerçek`);
    }
    return { s, tr: r.tr || [] };
  }
  const mark = (name) => { log.push({ i: captured, mark: name }); console.log(`>> ${name} @kare ${captured} (${(captured / FPS).toFixed(2)} sn)`); };
  const dbg = (expr) => page.evaluate(expr);

  // 1) Ana menü vitrini
  mark('MENU');
  let cur;
  for (let i = 0; i < Math.round(MENU_SEC * FPS); i++) cur = await frame();
  const hasTraffic = await page.evaluate(() => !!window.__VT__.traffic);
  console.log('trafik havuzu yakalandı:', hasTraffic);

  // 2) PLAY
  await page.evaluate((seed) => { window.__VT__.seed(seed + 7); document.querySelector('#btn-play').click(); window.__VT__.sweepAnims(0); }, SEED);
  mark('PLAY');
  await kd('KeyW');
  const playFrame = captured;
  const T = () => (captured - playFrame) / FPS;

  let phase = 'DRIVE';
  let nitroOn = false;
  let tunnelSeen = false;
  let tunnelExitT = null;
  let eventAT = null;
  let eventBT = null;
  let crashT = null;
  let gameoverT = null;
  let actionCamT = null;

  while (true) {
    cur = await frame();
    const s = cur.s;
    const t = T();
    if (s.state === 'PLAYING') {
      chooseLane(s, cur.tr);
      await steer(page, s);
    }

    // Nitro + ACTION CAM
    if (phase === 'DRIVE' && t >= Number(opt('nitroAt', '6.0')) && !nitroOn && s.state === 'PLAYING') {
      await kp('KeyC');
      await kd('ShiftLeft');
      nitroOn = true; actionCamT = t; mark('NITRO_ACTIONCAM');
      phase = 'NITRO';
    }
    if (phase === 'NITRO' && nitroOn && (t - actionCamT > Number(opt('nitroLen', '3.2')) || s.nitro <= 1)) {
      await ku('ShiftLeft');
      nitroOn = false; mark('NITRO_OFF');
      // ACTION -> HOOD -> CHASE (iki kare arayla)
      await kp('KeyC');
      cur = await frame();
      await kp('KeyC');
      mark('CHASE_CAM');
      phase = 'TO_TUNNEL';
    }
    if (s.inTunnel && !tunnelSeen) { tunnelSeen = true; mark('TUNNEL_IN'); }
    if (tunnelSeen && !s.inTunnel && tunnelExitT === null) { tunnelExitT = t; mark('TUNNEL_OUT'); }

    if (phase === 'TO_TUNNEL' && ((tunnelExitT !== null && t - tunnelExitT > Number(opt('aDelay', '1.0'))) || t > Number(opt('aLatest', '20')))) {
      const ok = await dbg(() => window.__NIGHTSHIFT_DEBUG__.triggerEvent('CHAIN_REACTION'));
      if (ok) {
        // kaçış tarafı: oyuncu x>0 ise SOL (şerit 0,1), değilse SAĞ (2,3)
        ap.allowed = s.position.x > 0 ? [0, 1] : [2, 3];
        ap.nearMissSeek = false;
        eventAT = t; mark(`EVENT_A escape=${s.position.x > 0 ? 'LEFT' : 'RIGHT'}`);
        phase = 'EVENT_A';
      }
    }
    if (phase === 'EVENT_A' && t - eventAT > Number(opt('aLen', '6.5'))) {
      ap.allowed = [0, 1, 2, 3];
      ap.nearMissSeek = false;
      // Event B kapısı: oyuncu iç şeritlerden birinde (1/2) ve karşı iç şeride geçiş koridoru boş olmalı
      const x = s.position.x;
      const inner = Math.abs(x) < 2.6;
      const escLane = x >= 0 ? 1 : 2;
      const free = inner && !corridorBlocked(x, LANES[escLane], s.position.z, cur.tr) && laneAhead(LANES[escLane], s.position.z, cur.tr, 120) > 70;
      if (!inner) ap.allowed = x >= 0 ? [2] : [1]; // iç şeride çek
      if (free || t - eventAT > Number(opt('aLen', '6.5')) + 5) {
        const ok = await dbg(() => window.__NIGHTSHIFT_DEBUG__.triggerEvent('LAST_SECOND_ESCAPE'));
        if (ok) {
          ap.allowed = x >= 0 ? [0, 1] : [2, 3];
          ap.lane = escLane;
          eventBT = t; mark(`EVENT_B escape=${x >= 0 ? 'LEFT' : 'RIGHT'} gate=${free}`);
          phase = 'EVENT_B';
        }
      }
    }
    if (phase === 'EVENT_B' && t - eventBT > Number(opt('bFree', '3.9')) && ap.allowed.length < 4) {
      ap.allowed = [0, 1, 2, 3];
      ap.nearMissSeek = true;
    }
    if (phase === 'EVENT_B' && t - eventBT > Number(opt('bLen', '5.5'))) {
      ap.allowed = [0, 1, 2, 3];
      ap.kamikaze = true;
      ap.nearMissSeek = false;
      ap.brake = false; ap.braking = false;
      ku('KeyS'); kd('KeyW'); kd('ShiftLeft');
      mark('KAMIKAZE');
      phase = 'KAMIKAZE';
    }
    if (phase === 'KAMIKAZE' && t - eventBT > Number(opt('bLen', '5.5')) + Number(opt('kamikazeMax', '7')) && s.state === 'PLAYING') {
      await dbg(() => window.__NIGHTSHIFT_DEBUG__.forceCrash());
      mark('FORCE_CRASH_FALLBACK');
    }
    if ((s.state === 'CRASHING' || s.state === 'GAMEOVER') && crashT === null) {
      crashT = t; mark(`CRASH phase=${phase}`);
      await ku('ShiftLeft'); await ku('KeyW');
      if (ap.keyL) { await ku('KeyA'); ap.keyL = false; }
      if (ap.keyR) { await ku('KeyD'); ap.keyR = false; }
    }
    if (s.state === 'GAMEOVER' && gameoverT === null) { gameoverT = t; mark('GAMEOVER'); }
    if (gameoverT !== null && t - gameoverT > Number(opt('goHold', '4.5'))) break;
    if (t > MAX_DRIVE_SEC) { mark('MAX_TIME'); break; }
  }
  mark('END');

  // Ses
  const ainfo = await page.evaluate(() => window.__VT__.finishAudio());
  console.log('ses:', ainfo);
  if (ainfo && !DRY) {
    const total = ainfo.samples * 2;
    const chunks = [];
    for (let off = 0; off < total; off += 1 << 20) {
      const b64 = await page.evaluate(([o, c]) => window.__VT__.pcmChunk(o, c), [off, 1 << 20]);
      chunks.push(Buffer.from(b64, 'base64'));
    }
    const pcm = Buffer.concat(chunks);
    const hdr = Buffer.alloc(44);
    hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12);
    hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22); hdr.writeUInt32LE(ainfo.sampleRate, 24);
    hdr.writeUInt32LE(ainfo.sampleRate * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36);
    hdr.writeUInt32LE(pcm.length, 40);
    fs.writeFileSync(`${OUT}.wav`, Buffer.concat([hdr, pcm]));
  }
  // ses örneği 0, sanal adım `startFrame`'in karesidir; yakalanan kare i, adım f'dir -> ofset
  const firstStep = log.find((e) => e.f !== undefined)?.f ?? 1;
  const audioOffsetSec = ainfo ? (ainfo.startFrame - firstStep) / FPS : null;

  if (ff) { ff.stdin.end(); await new Promise((res) => ff.on('close', res)); }
  const meta = { quality: QUALITY, dpr: DPR, seed: SEED, fps: FPS, frames: captured, gpu, audio: ainfo, audioOffsetSec,
    marks: log.filter((e) => e.mark), errors, wallSec: (Date.now() - t0) / 1000 };
  fs.writeFileSync(`${OUT}${DRY ? '_dry' : ''}.json`, JSON.stringify({ meta, log }, null, 0));
  console.log(JSON.stringify(meta, null, 1));
  await browser.close();
  server.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
