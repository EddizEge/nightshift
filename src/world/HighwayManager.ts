import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LoadedGameAssets } from '../core/AssetLoader';
import type { WetAsphaltUniforms } from '../rendering/WetAsphaltMaterial';

export type SegmentType = 'STANDARD' | 'GANTRY' | 'OVERPASS' | 'BRIDGE' | 'TUNNEL';

export const HIGHWAY_LANES = [-5.7, -1.9, 1.9, 5.7] as const;
export const HIGHWAY_HALF_WIDTH = 9.85;
export const SEGMENT_LENGTH = 80;
export const NUM_SEGMENTS = 11;

interface HighwaySegment {
  group: THREE.Group;
  roadMesh: THREE.Mesh;
  index: number;
  zCenter: number;
  type: SegmentType;
  decorGroup: THREE.Group;
}

export class HighwayManager {
  public readonly root = new THREE.Group();
  public readonly roadMeshes: THREE.Mesh[] = [];

  private segments: HighwaySegment[] = [];
  private readonly roadMat: THREE.MeshStandardMaterial;
  private readonly asphaltUniforms: WetAsphaltUniforms;

  private readonly concreteMat: THREE.MeshStandardMaterial;
  private readonly darkSteelMat: THREE.MeshStandardMaterial;
  private readonly lampBulbMat: THREE.MeshBasicMaterial;
  private readonly tunnelStripMat: THREE.MeshBasicMaterial;
  private readonly reflectorAmberMat: THREE.MeshBasicMaterial;
  private readonly beaconRedMat: THREE.MeshBasicMaterial;
  private readonly gantrySignMats: THREE.MeshStandardMaterial[] = [];

  // Pre-merged batched segment geometries (cuts draw calls by >85%!)
  private readonly roadGeo: THREE.PlaneGeometry;
  private readonly batchedBarriersGeo: THREE.BufferGeometry;
  private readonly batchedDelineatorsGeo: THREE.BufferGeometry;
  private readonly batchedLampSteelGeo: THREE.BufferGeometry;
  private readonly batchedLampBulbsGeo: THREE.BufferGeometry;
  private readonly batchedTunnelShellGeo: THREE.BufferGeometry;
  private readonly batchedTunnelRibsGeo: THREE.BufferGeometry;
  private readonly batchedTunnelStripsGeo: THREE.BufferGeometry;
  private readonly batchedBridgeSteelGeo: THREE.BufferGeometry;
  private readonly batchedBridgeConcreteGeo: THREE.BufferGeometry;

  private readonly activeLampLights: THREE.PointLight[] = [];
  private readonly horizonRig = new THREE.Group();
  private readonly windowBuildingMat: THREE.ShaderMaterial;

  private nextSegmentIndex = 0;
  private worldZOffset = 0;

  constructor(
    assets: LoadedGameAssets,
    roadMaterial: THREE.MeshStandardMaterial,
    asphaltUniforms: WetAsphaltUniforms,
  ) {
    this.roadMat = roadMaterial;
    this.asphaltUniforms = asphaltUniforms;

    this.roadGeo = new THREE.PlaneGeometry(20.6, SEGMENT_LENGTH, 20, 20);
    this.roadGeo.rotateX(-Math.PI / 2);
    this.roadGeo.computeTangents();

    // Properly proportioned concrete tiling along 80m longitudinal span (no horizontal smear!)
    assets.concreteDiff.repeat.set(12, 2);
    assets.concreteNor.repeat.set(12, 2);
    assets.concreteArm.repeat.set(12, 2);

    this.concreteMat = new THREE.MeshStandardMaterial({
      map: assets.concreteDiff,
      normalMap: assets.concreteNor,
      roughnessMap: assets.concreteArm,
      aoMap: assets.concreteArm,
      color: new THREE.Color(0x525760),
      roughness: 0.86,
      metalness: 0.04,
      envMapIntensity: 0.55,
    });
    this.concreteMat.normalScale.set(0.85, 0.85);

    this.darkSteelMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x1b2028),
      roughness: 0.36,
      metalness: 0.84,
      envMapIntensity: 0.9,
    });

    this.lampBulbMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(4.2, 2.55, 1.05),
    });

    this.tunnelStripMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(3.6, 2.55, 1.35),
    });

    this.reflectorAmberMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.6, 1.25, 0.18),
    });

    this.beaconRedMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(4.2, 0.22, 0.18),
    });

    // Build pre-merged batched geometries once
    this.batchedBarriersGeo = this.buildBatchedBarriers();
    this.batchedDelineatorsGeo = this.buildBatchedDelineators();
    const lamps = this.buildBatchedStreetLamps();
    this.batchedLampSteelGeo = lamps.steel;
    this.batchedLampBulbsGeo = lamps.bulbs;

    const tun = this.buildBatchedTunnelParts();
    this.batchedTunnelShellGeo = tun.shell;
    this.batchedTunnelRibsGeo = tun.ribs;
    this.batchedTunnelStripsGeo = tun.strips;

    const brg = this.buildBatchedCableBridge();
    this.batchedBridgeConcreteGeo = brg.concrete;
    this.batchedBridgeSteelGeo = brg.steel;

    this.gantrySignMats = [
      this.createHighwaySignMaterial('INTERSTATE 90 NORTH', 'HARBOR EXPRESSWAY  //  DOWNTOWN 6 KM', '#0b4f35'),
      this.createHighwaySignMaterial('MIDNIGHT TUNNEL AHEAD', 'REDUCE SPEED  //  WET ROAD HAZARD', '#103b66'),
      this.createHighwaySignMaterial('INDUSTRIAL PORT EXIT 14', 'THRU TRAFFIC KEEP CENTER LANES', '#0b4f35'),
    ];

    this.windowBuildingMat = this.createCityBuildingShader();

    this.buildPooledStreetLights();
    this.buildDistantMetropolisAndPort();
    this.initSegments();
  }

  private buildBatchedBarriers(): THREE.BufferGeometry {
    // Clean world-scaled UV box stack for New Jersey concrete barriers + viaduct side deck edge
    const parts: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      const base = new THREE.BoxGeometry(0.76, 0.36, SEGMENT_LENGTH);
      base.translate(sx * 10.22, 0.18, 0);
      const upper = new THREE.BoxGeometry(0.38, 0.74, SEGMENT_LENGTH);
      upper.translate(sx * 10.22, 0.73, 0);
      const fascia = new THREE.BoxGeometry(0.85, 2.2, SEGMENT_LENGTH);
      fascia.translate(sx * 10.52, -1.1, 0);
      parts.push(base, upper, fascia);
    }
    return mergeGeometries(parts, false)!;
  }

  private buildBatchedDelineators(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      for (const dz of [-30, -10, 10, 30]) {
        const g = new THREE.BoxGeometry(0.05, 0.11, 0.24);
        g.translate(sx * 10.01, 0.78, dz);
        parts.push(g);
      }
    }
    return mergeGeometries(parts, false)!;
  }

  private buildBatchedStreetLamps(): { steel: THREE.BufferGeometry; bulbs: THREE.BufferGeometry } {
    const steelParts: THREE.BufferGeometry[] = [];
    const bulbParts: THREE.BufferGeometry[] = [];

    for (const lz of [-20, 20]) {
      for (const sx of [-1, 1]) {
        const pole = new THREE.CylinderGeometry(0.10, 0.15, 10.5, 8);
        pole.translate(sx * 10.62, 5.25, lz);
        const arm = new THREE.BoxGeometry(2.8, 0.13, 0.13);
        arm.translate(sx * 9.32, 10.35, lz);
        const head = new THREE.BoxGeometry(0.84, 0.12, 0.34);
        head.translate(sx * 8.12, 10.28, lz);
        steelParts.push(pole, arm, head);

        const bulb = new THREE.BoxGeometry(0.74, 0.05, 0.26);
        bulb.translate(sx * 8.12, 10.20, lz);
        bulbParts.push(bulb);
      }
    }

    return {
      steel: mergeGeometries(steelParts, false)!,
      bulbs: mergeGeometries(bulbParts, false)!,
    };
  }

  private buildBatchedTunnelParts(): {
    shell: THREE.BufferGeometry;
    ribs: THREE.BufferGeometry;
    strips: THREE.BufferGeometry;
  } {
    const shellParts: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      const wall = new THREE.BoxGeometry(1.6, 8.6, SEGMENT_LENGTH + 0.2);
      wall.translate(sx * 11.1, 4.3, 0);
      shellParts.push(wall);
    }
    const ceiling = new THREE.BoxGeometry(24.2, 1.8, SEGMENT_LENGTH + 0.2);
    ceiling.translate(0, 8.9, 0);
    shellParts.push(ceiling);

    const ribParts: THREE.BufferGeometry[] = [];
    const stripParts: THREE.BufferGeometry[] = [];
    for (const rz of [-32, -16, 0, 16, 32]) {
      const topRib = new THREE.BoxGeometry(22.4, 0.42, 0.62);
      topRib.translate(0, 7.9, rz);
      ribParts.push(topRib);

      for (const sx of [-1, 1]) {
        const pilaster = new THREE.BoxGeometry(0.28, 7.9, 0.62);
        pilaster.translate(sx * 10.22, 3.95, rz);
        ribParts.push(pilaster);
      }

      for (const lx of [-4.4, 4.4]) {
        const strip = new THREE.BoxGeometry(0.42, 0.10, 6.2);
        strip.translate(lx, 7.82, rz);
        stripParts.push(strip);
      }
    }

    return {
      shell: mergeGeometries(shellParts, false)!,
      ribs: mergeGeometries(ribParts, false)!,
      strips: mergeGeometries(stripParts, false)!,
    };
  }

  private buildBatchedCableBridge(): { concrete: THREE.BufferGeometry; steel: THREE.BufferGeometry } {
    const conc: THREE.BufferGeometry[] = [];
    const stl: THREE.BufferGeometry[] = [];

    for (const sx of [-1, 1]) {
      const leg = new THREE.BoxGeometry(1.85, 36.0, 2.4);
      leg.rotateZ(sx * 0.045);
      leg.translate(sx * 11.4, 18.0, 0);
      conc.push(leg);

      for (const cz of [-34, -22, -11, 11, 22, 34]) {
        const dy = -29.0;
        const len = Math.hypot(dy, cz);
        const cable = new THREE.CylinderGeometry(0.055, 0.055, len, 6);
        cable.rotateX(Math.atan2(cz, -dy));
        cable.translate(sx * 10.75, 31.5 + dy * 0.5, cz * 0.5);
        stl.push(cable);
      }
    }

    const cross1 = new THREE.BoxGeometry(23.5, 2.2, 2.4);
    cross1.translate(0, 26.5, 0);
    const cross2 = new THREE.BoxGeometry(24.2, 1.4, 2.0);
    cross2.translate(0, 12.2, 0);
    conc.push(cross1, cross2);

    return {
      concrete: mergeGeometries(conc, false)!,
      steel: mergeGeometries(stl, false)!,
    };
  }

  private createHighwaySignMaterial(topLine: string, subLine: string, bgHex: string): THREE.MeshStandardMaterial {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = bgHex;
    ctx.fillRect(0, 0, 1024, 256);

    ctx.strokeStyle = '#e5edf5';
    ctx.lineWidth = 10;
    ctx.strokeRect(16, 16, 992, 224);

    ctx.fillStyle = '#f5f9ff';
    ctx.font = 'bold 54px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(topLine, 512, 112);

    ctx.fillStyle = '#ffd175';
    ctx.font = 'bold 33px "Consolas", monospace';
    ctx.fillText(subLine, 512, 184);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.55,
      roughness: 0.3,
      metalness: 0.2,
    });
  }

  private createCityBuildingShader(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uTime: { value: 0 } },
      ]),
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        varying vec3 vWorldPos;
        varying vec3 vNormalW;
        void main() {
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        uniform float uTime;
        varying vec3 vWorldPos;
        varying vec3 vNormalW;

        float hash21(vec2 p) {
          p = fract(p * vec2(127.1, 311.7));
          p += dot(p, p + 34.5);
          return fract(p.x * p.y);
        }

        void main() {
          // Dark rainy glass/concrete skyscraper silhouette
          vec3 facadeBase = vec3(0.010, 0.014, 0.022);
          float sideMask = 1.0 - abs(vNormalW.y);

          // Realistic high-rise architectural scale: ~1.8m window bays x 3.4m floor height
          float horizCoord = abs(vNormalW.x) > 0.5 ? vWorldPos.z : vWorldPos.x;
          vec2 bayUv = vec2(horizCoord * 0.55, vWorldPos.y * 0.295);
          vec2 cell = floor(bayUv);
          vec2 gv = fract(bayUv);

          // Crisp curtain-wall mullion frame + concrete spandrel slab between floors
          float mullion = step(0.14, gv.x) * step(gv.x, 0.86) * step(0.28, gv.y) * step(gv.y, 0.84);

          // Group adjacent bays into whole lit office suites so skyline looks genuinely architectural!
          vec2 suiteCell = floor(vec2(cell.x * 0.35, cell.y));
          float suiteLit = step(0.68, hash21(suiteCell));
          float roomVar = 0.45 + 0.55 * hash21(cell + 4.1);
          float mechanicalFloor = step(0.12, fract(cell.y * 0.077)); // Dark mechanical floors every ~13 stories
          float abovePodium = smoothstep(-2.0, 5.0, vWorldPos.y);

          float litMask = suiteLit * mullion * sideMask * mechanicalFloor * abovePodium;

          vec3 warmOffice = vec3(1.18, 0.86, 0.48);
          vec3 coolFluorescent = vec3(0.55, 0.84, 1.15);
          vec3 neutralWhite = vec3(0.95, 0.96, 0.98);
          float palettePick = hash21(suiteCell + 13.7);
          vec3 winCol = palettePick < 0.48 ? warmOffice : (palettePick < 0.82 ? coolFluorescent : neutralWhite);

          // Subtle vertical interior ceiling falloff inside each window
          float interiorGrad = 0.55 + 0.45 * gv.y;
          vec3 col = facadeBase + winCol * litMask * roomVar * interiorGrad * 0.72;

          // Subtle urban street-glow bounce near lower levels
          col += vec3(0.028, 0.022, 0.016) * exp(-max(0.0, vWorldPos.y + 8.0) * 0.045);

          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }
      `,
    });
  }

  private buildPooledStreetLights(): void {
    for (let i = 0; i < 6; i++) {
      const pl = new THREE.PointLight(0xffa952, 24, 46, 1.65);
      pl.castShadow = false;
      this.root.add(pl);
      this.activeLampLights.push(pl);
    }
  }

  private buildDistantMetropolisAndPort(): void {
    // Dark wet urban ground / harbor plane at y = -18m so zero horizon gap ever appears!
    const groundSkirt = new THREE.Mesh(
      new THREE.PlaneGeometry(1400, 1400),
      new THREE.MeshBasicMaterial({ color: 0x04070c }),
    );
    groundSkirt.rotation.x = -Math.PI * 0.5;
    groundSkirt.position.set(0, -18.0, -250);
    this.horizonRig.add(groundSkirt);

    const count = 140;
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    boxGeo.translate(0, 0.5, 0);
    const towers = new THREE.InstancedMesh(boxGeo, this.windowBuildingMat, count);
    towers.frustumCulled = false;

    const beaconGeo = new THREE.SphereGeometry(0.55, 6, 6);
    const beacons = new THREE.InstancedMesh(beaconGeo, this.beaconRedMat, 48);
    beacons.frustumCulled = false;

    const dummy = new THREE.Object3D();
    let bIdx = 0;
    let s = 4219;
    const rand = () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };

    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      // Set back 88m..380m from viaduct edge and rooted deep at y = -65m (zero floating bases!)
      const lateral = 88 + Math.pow(rand(), 0.82) * 295;
      const z = 160 - (i / count) * 980 + (rand() - 0.5) * 28;
      const w = 18 + rand() * 32;
      const d = 18 + rand() * 32;
      const topY = lateral > 140 ? 42 + Math.pow(rand(), 1.35) * 155 : 18 + rand() * 52;
      const baseY = -65.0;
      const totalH = topY - baseY;

      dummy.position.set(side * lateral, baseY, z);
      dummy.scale.set(w, totalH, d);
      dummy.rotation.set(0, (rand() - 0.5) * 0.18, 0);
      dummy.updateMatrix();
      towers.setMatrixAt(i, dummy.matrix);

      if (topY > 82 && bIdx < 48) {
        dummy.position.set(side * lateral, topY + 0.6, z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        beacons.setMatrixAt(bIdx++, dummy.matrix);
      }
    }

    // Industrial Refinery Silos rooted deep at y = -65m on right industrial harbor sector
    const siloGeo = new THREE.CylinderGeometry(8.0, 11.5, 96, 14);
    siloGeo.translate(0, 48, 0);
    for (let k = 0; k < 4; k++) {
      const silo = new THREE.Mesh(siloGeo, this.concreteMat);
      silo.position.set(105 + k * 28, -65, -240 - k * 145);
      this.horizonRig.add(silo);

      const flare = new THREE.Mesh(beaconGeo, this.reflectorAmberMat);
      flare.scale.setScalar(1.35);
      flare.position.set(105 + k * 28, 31.6, -240 - k * 145);
      this.horizonRig.add(flare);
    }

    this.horizonRig.add(towers);
    this.horizonRig.add(beacons);
    this.root.add(this.horizonRig);
  }

  private getSegmentTypeForIndex(idx: number): SegmentType {
    const m = ((idx % 16) + 16) % 16;
    if (m >= 7 && m <= 10) return 'TUNNEL';
    if (m === 4 || m === 5) return 'BRIDGE';
    if (m === 3 || m === 13) return 'GANTRY';
    if (m === 6 || m === 14) return 'OVERPASS';
    return 'STANDARD';
  }

  private initSegments(): void {
    for (let i = 0; i < NUM_SEGMENTS; i++) {
      const segIdx = i - 1;
      const seg = this.createSegmentShell();
      this.configureSegment(seg, segIdx);
      this.segments.push(seg);
      this.root.add(seg.group);
    }
    this.nextSegmentIndex = NUM_SEGMENTS - 1;
    this.updateTunnelUniforms();
  }

  private createSegmentShell(): HighwaySegment {
    const group = new THREE.Group();

    const roadMesh = new THREE.Mesh(this.roadGeo, this.roadMat);
    roadMesh.receiveShadow = true;
    group.add(roadMesh);
    this.roadMeshes.push(roadMesh);

    const barriers = new THREE.Mesh(this.batchedBarriersGeo, this.concreteMat);
    barriers.castShadow = false;
    barriers.receiveShadow = true;
    group.add(barriers);

    const delineators = new THREE.Mesh(this.batchedDelineatorsGeo, this.reflectorAmberMat);
    group.add(delineators);

    const decorGroup = new THREE.Group();
    group.add(decorGroup);

    return {
      group,
      roadMesh,
      index: 0,
      zCenter: 0,
      type: 'STANDARD',
      decorGroup,
    };
  }

  private configureSegment(seg: HighwaySegment, segIndex: number): void {
    seg.index = segIndex;
    seg.zCenter = -segIndex * SEGMENT_LENGTH - this.worldZOffset;
    seg.group.position.z = seg.zCenter;

    while (seg.decorGroup.children.length > 0) {
      seg.decorGroup.remove(seg.decorGroup.children[0]);
    }

    const type = segIndex <= 0 ? 'STANDARD' : this.getSegmentTypeForIndex(segIndex);
    seg.type = type;

    if (type === 'TUNNEL') {
      this.populateTunnelSegment(seg, segIndex);
    } else {
      seg.decorGroup.add(new THREE.Mesh(this.batchedLampSteelGeo, this.darkSteelMat));
      seg.decorGroup.add(new THREE.Mesh(this.batchedLampBulbsGeo, this.lampBulbMat));

      if (type === 'GANTRY') {
        this.populateSignGantry(seg, segIndex);
      } else if (type === 'OVERPASS') {
        this.populateOverpassBridge(seg);
      } else if (type === 'BRIDGE') {
        seg.decorGroup.add(new THREE.Mesh(this.batchedBridgeConcreteGeo, this.concreteMat));
        seg.decorGroup.add(new THREE.Mesh(this.batchedBridgeSteelGeo, this.darkSteelMat));
      }
    }
  }

  private populateSignGantry(seg: HighwaySegment, segIndex: number): void {
    const colGeo = new THREE.CylinderGeometry(0.24, 0.28, 9.2, 8);
    const leftCol = colGeo.clone().translate(-10.8, 4.6, 0);
    const rightCol = colGeo.clone().translate(10.8, 4.6, 0);
    const truss = new THREE.BoxGeometry(22.2, 0.85, 0.85).translate(0, 8.75, 0);
    const mergedTruss = mergeGeometries([leftCol, rightCol, truss], false)!;
    seg.decorGroup.add(new THREE.Mesh(mergedTruss, this.darkSteelMat));

    const signMat = this.gantrySignMats[Math.abs(segIndex) % this.gantrySignMats.length];
    const signBoard = new THREE.Mesh(new THREE.BoxGeometry(14.8, 2.85, 0.22), signMat);
    signBoard.position.set(0, 8.45, 0.48);
    seg.decorGroup.add(signBoard);
  }

  private populateOverpassBridge(seg: HighwaySegment): void {
    const deck = new THREE.BoxGeometry(36.0, 1.85, 14.0).translate(0, 9.4, 0);
    const pierL = new THREE.BoxGeometry(2.4, 9.4, 12.5).translate(-11.6, 4.7, 0);
    const pierR = new THREE.BoxGeometry(2.4, 9.4, 12.5).translate(11.6, 4.7, 0);
    seg.decorGroup.add(new THREE.Mesh(mergeGeometries([deck, pierL, pierR], false)!, this.concreteMat));

    const lampL = new THREE.BoxGeometry(0.6, 0.1, 2.2).translate(-5.2, 8.42, 0);
    const lampR = new THREE.BoxGeometry(0.6, 0.1, 2.2).translate(5.2, 8.42, 0);
    seg.decorGroup.add(new THREE.Mesh(mergeGeometries([lampL, lampR], false)!, this.lampBulbMat));
  }

  private populateTunnelSegment(seg: HighwaySegment, segIndex: number): void {
    seg.decorGroup.add(new THREE.Mesh(this.batchedTunnelShellGeo, this.concreteMat));
    seg.decorGroup.add(new THREE.Mesh(this.batchedTunnelRibsGeo, this.darkSteelMat));
    seg.decorGroup.add(new THREE.Mesh(this.batchedTunnelStripsGeo, this.tunnelStripMat));

    const m = ((segIndex % 16) + 16) % 16;
    if (m === 7 || m === 10) {
      const portalZ = m === 7 ? SEGMENT_LENGTH * 0.5 - 1.2 : -SEGMENT_LENGTH * 0.5 + 1.2;
      const brow = new THREE.Mesh(new THREE.BoxGeometry(25.2, 4.2, 2.6), this.concreteMat);
      brow.position.set(0, 10.4, portalZ);
      seg.decorGroup.add(brow);
    }
  }

  private updateTunnelUniforms(): void {
    let minZ = 99999;
    let maxZ = -99999;
    let found = false;
    for (const seg of this.segments) {
      if (seg.type === 'TUNNEL') {
        found = true;
        minZ = Math.min(minZ, seg.zCenter - SEGMENT_LENGTH * 0.5);
        maxZ = Math.max(maxZ, seg.zCenter + SEGMENT_LENGTH * 0.5);
      }
    }
    if (found) {
      this.asphaltUniforms.uTunnelRange.value.set(minZ, maxZ);
    } else {
      this.asphaltUniforms.uTunnelRange.value.set(99999, 99999);
    }
  }

  public isInsideTunnel(z: number): boolean {
    const r = this.asphaltUniforms.uTunnelRange.value;
    if (r.x > 50000) return false;
    return z >= r.x && z <= r.y;
  }

  public getTunnelBounds(): THREE.Vector2 {
    return this.asphaltUniforms.uTunnelRange.value;
  }

  public applyOriginRebase(deltaZ: number): void {
    this.worldZOffset -= deltaZ;
    this.asphaltUniforms.uWorldZOffset.value = this.worldZOffset;
    for (const seg of this.segments) {
      seg.zCenter += deltaZ;
      seg.group.position.z = seg.zCenter;
    }
    this.updateTunnelUniforms();
  }

  public update(playerZ: number, time: number): void {
    this.windowBuildingMat.uniforms.uTime.value = time;
    this.asphaltUniforms.uTime.value = time;

    let recycled = false;
    for (const seg of this.segments) {
      if (seg.zCenter - playerZ > 135) {
        this.configureSegment(seg, this.nextSegmentIndex++);
        recycled = true;
      }
    }
    if (recycled) {
      this.updateTunnelUniforms();
    }

    this.horizonRig.position.z = playerZ;

    const baseLampZ = Math.round(playerZ / 40) * 40;
    for (let i = 0; i < this.activeLampLights.length; i++) {
      const offsetIdx = i - 1;
      const lz = baseLampZ - offsetIdx * 40;
      const side = i % 2 === 0 ? -7.8 : 7.8;
      const inTun = this.isInsideTunnel(lz);
      this.activeLampLights[i].position.set(side * (inTun ? 0.55 : 1.0), inTun ? 7.4 : 9.8, lz);
      this.activeLampLights[i].intensity = inTun ? 18 : 24;
    }
  }

  public reset(): void {
    this.worldZOffset = 0;
    this.asphaltUniforms.uWorldZOffset.value = 0;
    for (let i = 0; i < this.segments.length; i++) {
      this.configureSegment(this.segments[i], i - 1);
    }
    this.nextSegmentIndex = NUM_SEGMENTS - 1;
    this.updateTunnelUniforms();
    this.horizonRig.position.z = 0;
  }
}
