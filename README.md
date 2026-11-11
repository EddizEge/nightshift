# NIGHTSHIFT: Survive the Midnight

> **Cinematic midnight rain highway racing in the browser (WebGL2)** — TypeScript, Three.js, Rapier3D WASM physics, planar wet-road reflections, custom PBR shaders and real-time Web Audio synthesis.

**▶ Play:** https://eddizege.github.io/nightshift/ — desktop + keyboard only (not playable on phones). On weaker GPUs, pick LOW or MEDIUM in Settings.

## How this was made

This whole game was written by **Gemini 4 Carbon (High)** running as an agent in **Google Antigravity**, from **one long prompt**, in **about 73 minutes** (plus about 55 minutes for the player car), with **no human-written code**. The agent chose the stack, wrote every system, pulled in the open-licensed assets, ran the build and tested the game in a real browser on its own.

- The player car was modelled from scratch by Gemini in a second prompt (about 55 minutes), in Blender with a Python script (`scripts/build_player_car.py`); before that the game used a ready-made CC BY model. Known flaw: the driver's door panel does not sit flush with the body.
- The trailer was captured frame by frame from the first build, before the custom car (no pre-rendered footage). The driving in the trailer is an autopilot script (`video/record.mjs`), and the two set-piece events were triggered with the game's debug hook; in normal play they also fire on their own.
- The same prompt was given to Claude Fable 5.2 for a side-by-side comparison: <https://lab.edizegemercan.com/posts/nightshift-gemini-4-carbon-vs-claude-fable-5-2/> (Fable's version: <https://github.com/EddizEge/nightshift-fable>).
- Added afterwards, not part of Gemini's output: the `video/` folder (trailer capture and editing tools, written by Claude), the GitHub Pages workflow (`.github/workflows/pages.yml`), the `LICENSE` file and this "How this was made" section.

**License:** Code: MIT (see `LICENSE`). Assets: see `ASSETS.md` (CC0). Everything else (game code, assets pipeline, tests, the rest of this README, `ASSETS.md`) is Gemini's work as delivered.

`NIGHTSHIFT` drops you behind the wheel of a twin-turbo midnight supercar tearing down a rain-drenched urban expressway. Slice past heavy traffic for Near-Miss multipliers, blast through Harbor Tunnel sectors, engage Nitro afterburners, and survive real-time multi-vehicle fuel tanker pileups and collapsing highway gantries.

---

## Key Technical Highlights

- **100% Original Hero Supercar (`player_car.glb` via `scripts/build_player_car.py`):** Custom-sculpted in headless Blender 4.3 with pure-quad Catmull-Clark Subdivision Surface (`SUBSURF`) multi-panel bodywork, recessed 3D shut-lines, clearcoat metallic flake paint (`KHR_materials_clearcoat`), procedural 2×2 twill carbon-fiber aero package, flush recessed cheekbone-DRL / bi-LED headlamps, continuous teardrop glass canopy, V12 showcase bay, swan-neck GT wing, curved 3D ruby taillight horizon & chevron blades, independent 4-wheel steering knuckles, stationary 6-piston crimson calipers, glowing hot slotted rotors, spinning 5-twin-Y-spoke forged center-lock rims, dual Xenon SpotLight beams, and twin high-mount shock-diamond Nitro plasma canons.
- **Wet Asphalt & Real-Time Planar Reflections (`WetRoadReflector` + `WetAsphaltMaterial`):**
  - Half-resolution HDR `HalfFloatType` planar reflection pass mirrored across the highway plane (`y = 0`) with oblique near-plane clipping.
  - Scanned Poly Haven PBR asphalt maps sampled seamlessly in world space (`uWorldZOffset` floating-origin support) with multi-octave FBM puddle masking, tire-rut wear tracks, concentric animated raindrop ripples, retro-reflective cat's-eye road studs, and roughness-driven anisotropic reflection streaking.
- **GPU Instanced Headlight-Lit Rain & Hydro-Spray (`RainAndSpraySystem`):**
  - Up to 13,000 velocity-streaked raindrops rendered in a single `InstancedBufferGeometry` draw call, dynamically illuminated in GLSL by the player's dual headlight cones, streetlamps, and active explosions — automatically occluded inside concrete highway tunnels.
  - Rear-tire hydro-spray mist plumes illuminated crimson by brake/tail lights, plus wet-asphalt-bouncing titanium collision sparks.
- **10-Layer Coordinated Explosion VFX & Dynamic Set-Piece Events (`ExplosionSystem` + `CinematicEventsDirector`):**
  1. Blinding core flash & post-process exposure spike
  2. Multi-lobe displaced 3D FBM Blackbody Fireball shader (`6500K` white-hot → orange → crimson → dark soot erosion)
  3. Ground Mach vapor ring & spherical pressure shockwave shell
  4. Multi-layer billowing smoke plume underlit from below by fireball bounce light
  5. Ballistic sparks skittering across wet asphalt
  6. Tumbling 3D metallic debris panels & burning chunks
  7. Flickering environmental `PointLight` reflected directly in wet highway puddles
  8. Lingering burning fuel patches & rising aftermath smoke columns
  9. Distance-attenuated trauma camera shake & FOV punch
  10. 4-layer synthesized sub-bass + transient crack + fireball roar audio
  - **Event A (`Highway Chain Reaction`):** Speeding traffic clips a heavy Fuel Tanker ahead, triggering a live jackknife across lanes and a dual-stage chain detonation.
  - **Event B (`The Last-Second Escape`):** High-voltage storm arc strikes an overhead gantry ahead, dropping flaming steel structure and sequential blasts across half the carriageway.
- **Simcade Driving Physics & Rapier3D Crash Dynamics (`PlayerVehicle` + `PhysicsWorld`):**
  - Responsive keyboard driving with 6-speed gearbox, speed-sensitive steering curve, counter-steer stability assist, controlled handbrake slides, and 4-corner pitch/roll/heave weight transfer.
  - Traffic vehicles transition seamlessly from lane-following AI (with advance amber turn-signal indicators and anti-impossible-wall spawn guarantees) into full Rapier3D dynamic tumbling rigid bodies on collision or shockwave impact.
- **HDR Post-Processing & Dynamic Quality Scaling (`PostProcessPipeline` + `QualityManager`):**
  - WebGL2 Hardware MSAA `HalfFloatType` render target + 3-stage Kawase/Tent Mipmap Bloom + peripheral high-speed radial streak + subtle screen-edge lens raindrops + ACES-inspired filmic tone mapping.
  - `LOW`, `MEDIUM`, `HIGH`, and `ULTRA` presets plus automatic **Dynamic Resolution Scaling (DRS)** to sustain 60 FPS.

---

## Controls

| Key | Action |
| :--- | :--- |
| `W` / `Up Arrow` | Accelerate |
| `S` / `Down Arrow` | Carbon-Ceramic Brake / Reverse |
| `A` `D` / `Left` `Right` | Precision Steering |
| `Shift` | Engage Nitrous Oxide Afterburner |
| `Space` | Handbrake / Drift Initiate |
| `C` | Cycle Camera (`CHASE CAM` / `ACTION CAM` / `HOOD CAM`) |
| `Esc` | Pause / Settings |
| `Enter` | Quick Start / Play Again |

---

## Local Setup & Commands

### Prerequisites
- **Node.js** `>= 18.0` and **npm** `>= 9.0`

### Install Dependencies
```bash
npm install
```

### Run Development Server
```bash
npm run dev
```
Opens at `http://127.0.0.1:5173/`.

### Build Production Bundle
```bash
npm run build
```
Outputs static production files to `dist/`.

### Preview Production Build Locally
```bash
npm run preview
```
Opens at `http://127.0.0.1:4173/`.

### Run Automated Real-Browser E2E & Visual Verification
```bash
npm run test:e2e
```
Launches Playwright Chromium/Chrome at `1920x1080` against `dist/`, verifies zero console/network errors, tests gameplay & cinematic events, records GPU/FPS telemetry, and saves screenshots to `screenshots/`.

---

## Deploying to Cloudflare Pages

`NIGHTSHIFT` is 100% static — it requires **no backend, no database, no accounts, and no API keys**. `public/_headers` is pre-configured with immutable cache headers and `application/wasm` MIME headers for Rapier3D.

### Option A: Direct CLI Upload (`Wrangler`)
```bash
npm run build
npx wrangler pages deploy dist --project-name=nightshift-racing
```

### Option B: Cloudflare Dashboard (Git Integration)
1. Push this repository to GitHub or GitLab.
2. In the **Cloudflare Dashboard**, navigate to **Workers & Pages → Create Application → Pages → Connect to Git**.
3. Configure the build settings:
   - **Framework preset:** `Vite`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Node.js version:** `20` (or `22`)
4. Click **Save and Deploy**.

---

## Verified Performance Benchmarks (`1920×1080`, Chromium WebGL2)

Measured on **Windows 11 • AMD Ryzen 7 5700X • NVIDIA GeForce RTX 4060 Ti (Direct3D11 ANGLE)** via `npm run test:e2e`:

| Quality Preset / Scenario | Resolution | Planar Reflection | MSAA + Bloom | Measured FPS | Avg Frame Time | Draw Calls |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **LOW** (Open Wet Highway) | `1920×1080` | Disabled (EnvMap fallback) | Off / Minimal | **~149–198 FPS** | `5.1–6.7 ms` | `~392–420` |
| **MEDIUM** (Open Wet Highway) | `1920×1080` | `0.35×` Half-Float HDR | `2×` MSAA + Bloom | **~117–144 FPS** | `7.0–8.5 ms` | `~869–871` |
| **HIGH** (Traffic + Rain + Puddles) | `1920×1080` | `0.50×` Half-Float HDR | `4×` MSAA + Bloom | **~100–106 FPS** | `9.4–10.0 ms` | `~824–828` |
| **ULTRA** (Nitro + Action Cam) | `1920×1080` | `0.65×` Half-Float HDR | `4×` MSAA + Bloom | **~113–122 FPS** | `8.2–8.9 ms` | `~701–755` |
| **ULTRA** (Harbor Tunnel Sector) | `1920×1080` | `0.65×` Half-Float HDR | `4×` MSAA + Bloom | **~174–189 FPS** | `5.3–5.7 ms` | `~373–375` |
| **ULTRA** (Event A Tanker Explosion) | `1920×1080` | `0.65×` Half-Float HDR | `4×` MSAA + Bloom | **~101–110 FPS** | `9.1–9.9 ms` | `~809–1,031` |

> **Dynamic Resolution Scaling (DRS):** Enabled by default (`Settings → Dynamic Resolution`), automatically scaling internal render resolution down toward `0.65×` on integrated/mobile GPUs if frame times exceed `18 ms`, and restoring `1.0×` native sharpness when headroom returns.

---

## Modular Architecture

```text
src/
├── audio/AudioEngine.ts             # Procedural Web Audio synthesizer (engine RPM, rain, tunnel IR reverb, 4-layer explosions)
├── camera/CinematicCamera.ts        # Chase, Action, Exterior Hood & Menu Showcase Orbit cameras + trauma shake
├── core/
│   ├── AssetLoader.ts               # Local GLB, RGBE HDRI PMREM & anisotropic PBR scan loader
│   ├── InputManager.ts              # Keyboard driving, Nitro, Handbrake, Camera & Pause input state
│   ├── NightshiftGame.ts            # Main simulation loop, state machine, floating-origin coordinator & QA bridge
│   └── QualityManager.ts            # LOW / MEDIUM / HIGH / ULTRA presets + live DRS governor
├── gameplay/
│   ├── CinematicEvents.ts           # Event A (Highway Chain Reaction) & Event B (The Last-Second Escape)
│   └── ScoreManager.ts              # Distance, speed, Near-Miss risk combos & localStorage Best Score
├── physics/PhysicsWorld.ts          # Rapier3D WASM rigid-body world for multi-vehicle crash dynamics
├── rendering/
│   ├── PostProcessPipeline.ts       # WebGL2 MSAA HalfFloat RT, 3-stage Kawase Bloom, speed streak, lens raindrops, ACES
│   ├── WetAsphaltMaterial.ts        # Custom PBR wet asphalt shader (puddle mask, ripples, road markings, planar blur)
│   └── WetRoadReflector.ts          # Oblique-clipped HalfFloat HDR planar mirror pass across y = 0
├── styles/ui.css                    # Grounded modern automotive HUD & glassmorphic menu styling
├── traffic/TrafficManager.ts        # 24-vehicle pool, lane AI, turn signals, anti-wall spawns & Near-Miss detector
├── ui/UIManager.ts                  # Loading, Main Menu, HUD, Pause, Settings, Controls & Game Over screens
├── vehicles/PlayerVehicle.ts        # Simcade 6-speed powertrain, suspension weight transfer, headlights & shock-diamond Nitro
├── vfx/
│   ├── ExplosionSystem.ts           # 10-layer coordinated blackbody fireball, smoke, sparks, 3D debris & ground fire
│   └── RainAndSpraySystem.ts        # GPU instanced headlight-lit rain, rear-tire hydro-spray & collision sparks
└── world/HighwayManager.ts          # Endless batched viaduct, sign gantries, overpasses, cable bridges, tunnel & skyline
```

---

## Asset Licensing

See [ASSETS.md](./ASSETS.md) for complete **CC0 1.0** asset documentation: both the hero supercar (`player_car.glb`, generated from scratch via `scripts/build_player_car.py`) and the 4-type highway traffic fleet (`scripts/build_assets.py`) are **100% original Blender-authored project models** with zero third-party vehicle meshes or brand trademarks, paired with **CC0** Poly Haven HDRI/PBR surface scans and real-time Web Audio synthesis.
