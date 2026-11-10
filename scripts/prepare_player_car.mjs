import fs from 'node:fs';
import path from 'node:path';

/**
 * Surgically prepares public/assets/models/player_car.glb from Khronos CarConcept_raw.glb (CC BY 4.0):
 * 1. Preserves 100% of Khronos PBR extensions (KHR_materials_clearcoat, KHR_materials_transmission,
 *    KHR_materials_emissive_strength, KHR_materials_iridescence, metallic flake nearest-mip samplers).
 * 2. Resets the 4 wheel assembly nodes (80, 85, 90, 95) from their 30-deg showcase pose to straight-ahead
 *    translation pivots so steering (rotation.z) and wheel spin (rim/disc/tire rotation.x) are exact.
 * 3. Removes sample Khronos decal/license textures on "License" and "Panel Sides" for a 100% clean,
 *    unbranded midnight supercar look.
 */
const rawPath = path.resolve('raw_cache/CarConcept_raw.glb');
const outPath = path.resolve('public/assets/models/player_car.glb');

const buf = fs.readFileSync(rawPath);
const jsonChunkLen = buf.readUInt32LE(12);
const jsonStr = buf.subarray(20, 20 + jsonChunkLen).toString('utf8');
const gltf = JSON.parse(jsonStr);

const binChunkOffset = 20 + jsonChunkLen;
const binChunkLen = buf.readUInt32LE(binChunkOffset);
const binData = buf.subarray(binChunkOffset + 8, binChunkOffset + 8 + binChunkLen);

// 1. Straighten WheelFrontL (80), WheelFrontR (85), WheelRearL (90), WheelRearR (95)
for (const idx of [80, 85, 90, 95]) {
  const node = gltf.nodes[idx];
  if (node && node.matrix) {
    const tx = node.matrix[12];
    const ty = node.matrix[13];
    const tz = node.matrix[14];
    delete node.matrix;
    node.translation = [tx, ty, tz];
    node.rotation = [0, 0, 0, 1];
    console.log(`Straightened ${node.name}: translation=[${tx.toFixed(3)}, ${ty.toFixed(3)}, ${tz.toFixed(3)}]`);
  }
}

// Give unnamed tire nodes clean names so runtime wheel animation can address them explicitly
const tireNames = { 84: 'WheelFrontLTire', 89: 'WheelFrontRTire', 94: 'WheelRearLTire', 99: 'WheelRearRTire' };
for (const [idxStr, name] of Object.entries(tireNames)) {
  const n = gltf.nodes[Number(idxStr)];
  if (n) n.name = name;
}

// 2. Unbrand License & Panel Sides materials
for (const mat of gltf.materials) {
  if (mat.name === 'License') {
    mat.pbrMetallicRoughness = {
      baseColorFactor: [0.025, 0.028, 0.035, 1.0],
      metallicFactor: 0.7,
      roughnessFactor: 0.25,
    };
  }
  if (mat.name === 'Panel Sides') {
    delete mat.normalTexture;
    mat.pbrMetallicRoughness = {
      baseColorFactor: [0.015, 0.017, 0.022, 1.0],
      metallicFactor: 0.65,
      roughnessFactor: 0.28,
    };
  }
}

// Re-pack valid 4-byte aligned GLB
let outJsonBuf = Buffer.from(JSON.stringify(gltf), 'utf8');
const jsonPad = (4 - (outJsonBuf.length % 4)) % 4;
if (jsonPad > 0) {
  outJsonBuf = Buffer.concat([outJsonBuf, Buffer.alloc(jsonPad, 0x20)]);
}

const binPad = (4 - (binData.length % 4)) % 4;
const outBinBuf = binPad > 0 ? Buffer.concat([binData, Buffer.alloc(binPad, 0x00)]) : binData;

const totalLen = 12 + 8 + outJsonBuf.length + 8 + outBinBuf.length;
const header = Buffer.alloc(12);
header.write('glTF', 0, 4, 'ascii');
header.writeUInt32LE(2, 4);
header.writeUInt32LE(totalLen, 8);

const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(outJsonBuf.length, 0);
jsonHeader.write('JSON', 4, 4, 'ascii');

const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(outBinBuf.length, 0);
binHeader.write('BIN\0', 4, 4, 'ascii');

fs.writeFileSync(outPath, Buffer.concat([header, jsonHeader, outJsonBuf, binHeader, outBinBuf]));
console.log(`Wrote ${outPath} (${(totalLen / 1024 / 1024).toFixed(2)} MB)`);
