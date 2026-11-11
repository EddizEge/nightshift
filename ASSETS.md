# NIGHTSHIFT — Asset Sources, Licenses & Attribution

All 3D models, HDRI lighting environments, PBR surface textures, shaders, and audio synthesis in **NIGHTSHIFT: Survive the Midnight** are hosted locally inside `public/assets/` (bundled into `dist/assets/` on build) with **zero runtime third-party CDN dependencies** and **full commercial & redistribution rights**.

---

## 1. 3D Vehicle Models (`public/assets/models/`)

### `player_car.glb` — Original Hero Supercar (*NIGHTSHIFT V12 GT*)
- **Author:** 100% original procedural Catmull-Clark Subdivision Surface (`SUBSURF`) & PBR Clearcoat 3D model (`89,900` triangles, `46,917` vertices, `2.48 MB` `.glb`) generated from scratch for **NIGHTSHIFT** via `scripts/build_player_car.py` (Blender 4.3 headless Python pipeline).
- **Geometry & Features:** Multi-panel Class-A exterior body with recessed 3D shut-lines (separate front bumper fascia with tucked carbon radiator splitters, sculpted vented bonnet, radial-lofted flared front fenders, widebody rear haunches with scooped mid-engine intakes, separate left/right aerodynamic doors, gloss-black A-pillar mirror gussets, twin-stalk wing mirrors, continuous teardrop tinted glass canopy, double-bubble 2×2 twill carbon roof, painted engine decklid shoulders + smoked-glass V12 spine window with plenum & crimson strut X-brace, top-mounted swan-neck GT rear wing, 6-strake carbon Venturi diffuser, high-mount dual-wall hollow burnt-titanium exhaust canons), flush recessed cheekbone-DRL / bi-LED headlamps, curved 3D ruby horizon & chevron LED taillight blades, cockpit interior with live-turning flat-bottom steering wheel, and staggered 20"/21" 5-twin-Y-spoke forged gunmetal center-lock wheels (`WheelFrontL/R`, `WheelRearL/R`) with grooved UHP tires, slotted carbon-ceramic rotors, and stationary 6-piston crimson calipers.
- **License:** **CC0 1.0 Universal (Public Domain Dedication)** — 100% original project-authored geometry, UVs, and procedural micro-detail textures; zero third-party meshes or trademarks; unrestricted commercial use and redistribution.

### `traffic_sedan.glb`, `traffic_suv.glb`, `traffic_truck.glb`, `traffic_tanker.glb` — Highway Traffic Fleet
- **Author:** Original procedural Catmull-Clark Subdivision Surface & PBR Clearcoat 3D assets generated specifically for **NIGHTSHIFT** via `scripts/build_assets.py` (Blender 4.3 headless Python pipeline).
- **License:** **CC0 1.0 Universal (Public Domain Dedication)** — 100% original project-authored geometry and materials; unrestricted commercial use and redistribution.

---

## 2. HDRI Lighting & Scanned PBR Surface Textures (`public/assets/hdri/`, `public/assets/textures/`)

All environment lighting and surface scan textures are sourced from **Poly Haven** (`https://polyhaven.com`), licensed under **CC0 1.0 Universal (Public Domain)** (`https://polyhaven.com/license`).

| Local Path | Poly Haven Asset ID | Channels Used | License |
| :--- | :--- | :--- | :--- |
| `public/assets/hdri/night_bridge_1k.hdr` | `night_bridge` | 32-bit Radiance HDRI (`1K`) | **CC0 1.0** |
| `public/assets/textures/asphalt/asphalt_diff.jpg` | `asphalt_02` | Diffuse / Albedo (`1K`) | **CC0 1.0** |
| `public/assets/textures/asphalt/asphalt_nor.jpg` | `asphalt_02` | OpenGL Tangent-Space Normal (`1K`) | **CC0 1.0** |
| `public/assets/textures/asphalt/asphalt_arm.jpg` | `asphalt_02` | Packed AO / Roughness / Metallic (`1K`) | **CC0 1.0** |
| `public/assets/textures/concrete/concrete_diff.jpg` | `concrete_layers_02` | Diffuse / Albedo (`1K`) | **CC0 1.0** |
| `public/assets/textures/concrete/concrete_nor.jpg` | `concrete_layers_02` | OpenGL Tangent-Space Normal (`1K`) | **CC0 1.0** |
| `public/assets/textures/concrete/concrete_arm.jpg` | `concrete_layers_02` | Packed AO / Roughness / Metallic (`1K`) | **CC0 1.0** |

---

## 3. Shaders, VFX Textures & Audio (`src/rendering/`, `src/vfx/`, `src/audio/`)

- **Custom Shaders & Procedural Textures:** Wet asphalt puddle/ripple shader, volumetric FBM blackbody explosion shader, GPU instanced headlight-illuminated rain shader, highway gantry signage, contact AO shadows, and lens rain post-processing are **100% original code** authored for this project.
- **Audio Synthesis (`src/audio/AudioEngine.ts`):** Engine harmonics, gearshift turbo flutter, midnight rain ambience, wet-tire hydro-spray, tunnel convolution impulse response, tire screech, Nitro turbine roar, Doppler near-miss whooshes, collisions, and 4-layer explosions are synthesized in real time using the browser's native **Web Audio API** — requiring zero external audio files and carrying zero third-party copyright claims.

---

## 4. Open-Source Runtime Libraries (`package.json`)

- **`three`** (`https://threejs.org/`) — **MIT License**
- **`@dimforge/rapier3d-compat`** (`https://rapier.rs/`) — **Apache-2.0 License**
