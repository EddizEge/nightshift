import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIST_DIR = path.resolve('dist');
const SCREENSHOT_DIR = path.resolve('screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.hdr': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function startStaticServer(rootDir, port = 4178) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      let filePath = path.join(rootDir, urlPath === '/' ? 'index.html' : urlPath);
      if (!filePath.startsWith(rootDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(rootDir, 'index.html');
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function runVerification() {
  const port = 4178;
  const server = await startStaticServer(DIST_DIR, port);
  const baseUrl = `http://127.0.0.1:${port}/`;
  console.log(`Static production server listening at ${baseUrl}`);

  const chromeExe = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const launchOpts = {
    headless: true,
    args: [
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--disable-frame-rate-limit',
      '--autoplay-policy=no-user-gesture-required',
    ],
  };
  if (fs.existsSync(chromeExe)) {
    launchOpts.executablePath = chromeExe;
  }

  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const failedRequests = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(`[pageerror] ${err.message}`);
  });
  page.on('requestfailed', (req) => {
    failedRequests.push(`${req.url()} -> ${req.failure()?.errorText}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && !res.url().endsWith('favicon.ico')) {
      failedRequests.push(`${res.url()} -> HTTP ${res.status()}`);
    }
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });

  await page.waitForFunction(
    () => window.__NIGHTSHIFT_DEBUG__ && window.__NIGHTSHIFT_DEBUG__.getState().state === 'MENU',
    { timeout: 25000 },
  );

  const gpuInfo = await page.evaluate(() => {
    const c = document.getElementById('game-canvas');
    const gl = c.getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl?.getParameter(gl.VENDOR),
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER),
      version: gl?.getParameter(gl.VERSION),
    };
  });
  console.log('GPU Info:', gpuInfo);

  // 1. Main Menu Showcase
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_main_menu_showcase.png') });
  console.log('Captured 01_main_menu_showcase.png');

  // 2. Settings Modal -> Enable Telemetry & Test HIGH first, then ULTRA
  await page.click('#btn-settings');
  await page.waitForTimeout(300);
  await page.click('#btn-toggle-fps');
  await page.click('button[data-quality="HIGH"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02_settings_modal.png') });
  console.log('Captured 02_settings_modal.png');
  await page.click('#btn-save-settings');
  await page.waitForTimeout(200);

  // 3. Gameplay on HIGH preset: accelerate & weave cleanly between lanes to slice past traffic!
  await page.click('#btn-play');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(900);
  // Subtle left nudge to x ~ +0.95 so we thread razor-close past lane-1 Sedan & lane-3 Truck for Near-Misses!
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(65);
  await page.keyboard.up('KeyA');
  await page.waitForTimeout(1900);

  const highPresetState = await page.evaluate(() => window.__NIGHTSHIFT_DEBUG__.getState());
  console.log('Gameplay HIGH Preset State:', highPresetState);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03_gameplay_chase_wet_road.png') });
  console.log('Captured 03_gameplay_chase_wet_road.png');

  // Switch to ULTRA via Settings during Pause to benchmark ULTRA too!
  await page.keyboard.up('KeyW');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.click('#btn-pause-settings');
  await page.waitForTimeout(200);
  await page.click('button[data-quality="ULTRA"]');
  await page.click('#btn-save-settings');
  await page.waitForTimeout(200);
  await page.click('#btn-resume');

  // 4. Action Cam + Nitro Afterburner on ULTRA
  await page.keyboard.press('KeyC'); // ACTION CAM
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await page.waitForTimeout(1450);
  const ultraNitroState = await page.evaluate(() => window.__NIGHTSHIFT_DEBUG__.getState());
  console.log('Gameplay ULTRA + Nitro State:', ultraNitroState);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04_nitro_boost_action.png') });
  console.log('Captured 04_nitro_boost_action.png');
  await page.keyboard.up('ShiftLeft');

  // 5. Hood Cam check
  await page.keyboard.press('KeyC'); // HOOD CAM
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '09_hood_camera_view.png') });
  console.log('Captured 09_hood_camera_view.png');
  await page.keyboard.press('KeyC'); // Back to CHASE CAM

  // 6. Concrete Highway Tunnel Sector
  await page.evaluate(() => window.__NIGHTSHIFT_DEBUG__.teleportToTunnel());
  await page.waitForTimeout(750);
  const tunnelState = await page.evaluate(() => window.__NIGHTSHIFT_DEBUG__.getState());
  console.log('Tunnel Sector State:', tunnelState);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05_tunnel_sector.png') });
  console.log('Captured 05_tunnel_sector.png');

  // Drive out of tunnel (~3.1s) onto open wet viaduct & trigger Event A: HIGHWAY CHAIN REACTION!
  await page.waitForTimeout(3100);
  await page.evaluate(() => window.__NIGHTSHIFT_DEBUG__.triggerEvent('CHAIN_REACTION'));
  await page.waitForTimeout(1620);
  const eventAState = await page.evaluate(() => window.__NIGHTSHIFT_DEBUG__.getState());
  console.log('Event A State:', eventAState);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06_event_a_chain_reaction.png') });
  console.log('Captured 06_event_a_chain_reaction.png');

  // Thread escape lane past Event A
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(190);
  await page.keyboard.up('KeyA');
  await page.waitForTimeout(2600);

  // 7. Trigger Event B: THE LAST-SECOND ESCAPE!
  await page.evaluate(() => window.__NIGHTSHIFT_DEBUG__.triggerEvent('LAST_SECOND_ESCAPE'));
  await page.waitForTimeout(920);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '07_event_b_last_second_escape.png') });
  console.log('Captured 07_event_b_last_second_escape.png');

  await page.keyboard.up('KeyW');

  // 8. Fatal Crash -> Capture Mid-Crash Slow-Mo + Wait for Game Over Screen -> PLAY AGAIN
  await page.evaluate(() => window.__NIGHTSHIFT_DEBUG__.forceCrash());
  await page.waitForTimeout(420);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '08a_crash_slowmo.png') });
  console.log('Captured 08a_crash_slowmo.png');

  await page.waitForFunction(
    () => window.__NIGHTSHIFT_DEBUG__.getState().state === 'GAMEOVER',
    { timeout: 6000 },
  );
  await page.waitForTimeout(350);
  const gameOverState = await page.evaluate(() => window.__NIGHTSHIFT_DEBUG__.getState());
  console.log('Game Over Final State:', gameOverState);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '08_gameover_screen.png') });
  console.log('Captured 08_gameover_screen.png');

  // Verify localStorage high score persistence & instant restart
  const storedBest = await page.evaluate(() => localStorage.getItem('nightshift_best_score_v1'));
  console.log('localStorage Best Score:', storedBest);

  await page.click('#btn-play-again');
  await page.waitForTimeout(450);
  const restartedState = await page.evaluate(() => window.__NIGHTSHIFT_DEBUG__.getState());
  console.log('Restarted State:', restartedState);

  // Benchmark LOW and MEDIUM presets briefly as well
  for (const preset of ['LOW', 'MEDIUM']) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await page.click('#btn-pause-settings');
    await page.waitForTimeout(150);
    await page.click(`button[data-quality="${preset}"]`);
    await page.click('#btn-save-settings');
    await page.waitForTimeout(150);
    await page.click('#btn-resume');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(900);
    await page.keyboard.up('KeyW');
    const pState = await page.evaluate(() => window.__NIGHTSHIFT_DEBUG__.getState());
    console.log(`Preset ${preset} State:`, pState);
  }

  console.log('Console Errors/Warnings:', consoleErrors);
  console.log('Failed Requests:', failedRequests);

  await browser.close();
  server.close();

  if (consoleErrors.some((e) => e.startsWith('[pageerror]') || e.includes('THREE.WebGLProgram'))) {
    process.exitCode = 1;
  }
}

runVerification().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
