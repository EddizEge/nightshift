import * as THREE from 'three';

export interface WetAsphaltUniforms {
  uTime: { value: number };
  uWorldZOffset: { value: number };
  uReflectionMap: { value: THREE.Texture };
  uTextureMatrix: { value: THREE.Matrix4 };
  uReflectionStrength: { value: number };
  uTunnelRange: { value: THREE.Vector2 }; // x = minZ, y = maxZ in current world space (dry inside tunnel)
}

export function createWetAsphaltMaterial(
  asphaltDiff: THREE.Texture,
  asphaltNor: THREE.Texture,
  asphaltArm: THREE.Texture,
  reflectionTex: THREE.Texture,
  textureMatrix: THREE.Matrix4,
): { material: THREE.MeshStandardMaterial; uniforms: WetAsphaltUniforms } {
  const uniforms: WetAsphaltUniforms = {
    uTime: { value: 0 },
    uWorldZOffset: { value: 0 },
    uReflectionMap: { value: reflectionTex },
    uTextureMatrix: { value: textureMatrix },
    uReflectionStrength: { value: 1.0 },
    uTunnelRange: { value: new THREE.Vector2(99999, 99999) },
  };

  const material = new THREE.MeshStandardMaterial({
    map: asphaltDiff,
    normalMap: asphaltNor,
    roughnessMap: asphaltArm,
    aoMap: asphaltArm,
    metalness: 0.05,
    roughness: 0.85,
    envMapIntensity: 1.25,
  });

  material.normalScale.set(1.15, 1.15);

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWorldZOffset = uniforms.uWorldZOffset;
    shader.uniforms.uReflectionMap = uniforms.uReflectionMap;
    shader.uniforms.uTextureMatrix = uniforms.uTextureMatrix;
    shader.uniforms.uReflectionStrength = uniforms.uReflectionStrength;
    shader.uniforms.uTunnelRange = uniforms.uTunnelRange;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform mat4 uTextureMatrix;
        varying vec3 vRoadWorldPos;
        varying vec4 vReflectCoord;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 roadWp = modelMatrix * vec4(transformed, 1.0);
        vRoadWorldPos = roadWp.xyz;
        vReflectCoord = uTextureMatrix * roadWp;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uWorldZOffset;
        uniform sampler2D uReflectionMap;
        uniform float uReflectionStrength;
        uniform vec2 uTunnelRange;
        varying vec3 vRoadWorldPos;
        varying vec4 vReflectCoord;

        float nsHash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float nsNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = nsHash21(i);
          float b = nsHash21(i + vec2(1.0, 0.0));
          float c = nsHash21(i + vec2(0.0, 1.0));
          float d = nsHash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        float nsFbm(vec2 p) {
          float v = 0.0;
          float amp = 0.5;
          for (int i = 0; i < 4; i++) {
            v += amp * nsNoise(p);
            p = p * 2.03 + vec2(17.1, 31.7);
            amp *= 0.5;
          }
          return v;
        }

        // Expanding concentric raindrop ripples inside puddles
        vec2 nsRainRipples(vec2 wp, float t) {
          vec2 sum = vec2(0.0);
          for (int layer = 0; layer < 2; layer++) {
            vec2 uv = wp * (layer == 0 ? 1.85 : 2.65) + float(layer) * 19.3;
            vec2 cell = floor(uv);
            vec2 f = fract(uv) - 0.5;
            float h = nsHash21(cell);
            float phase = fract(h + t * (layer == 0 ? 1.35 : 1.75));
            float radius = phase * 0.46;
            float dist = length(f + (vec2(nsHash21(cell + 3.1), nsHash21(cell + 7.7)) - 0.5) * 0.28);
            float ring = sin((dist - radius) * 46.0) * exp(-abs(dist - radius) * 26.0) * (1.0 - phase);
            vec2 dir = dist > 0.001 ? f / dist : vec2(0.0);
            sum += dir * ring;
          }
          return sum;
        }
        `,
      )
      // Seamless world-space UV for scanned asphalt + painted lane markings
      .replace(
        '#include <map_fragment>',
        `
        vec2 worldXZ = vec2(vRoadWorldPos.x, vRoadWorldPos.z + uWorldZOffset);
        vec2 roadUv = worldXZ * 0.28;
        vec2 macroUv = worldXZ * 0.045;

        // Dual-scale scanned asphalt sampling to eliminate visible tiling
        vec4 texFine = texture2D(map, roadUv);
        vec4 texMacro = texture2D(map, macroUv);
        vec3 asphaltCol = mix(texFine.rgb, texMacro.rgb, 0.28) * 0.56;

        // Tunnel wetness shelter factor (1.0 = open storm, 0.12 = sheltered inside concrete tunnel)
        // Note: tunnel range is [minZ, maxZ] in current scene Z
        float inTunnel = smoothstep(uTunnelRange.x - 18.0, uTunnelRange.x + 12.0, vRoadWorldPos.z)
                       * (1.0 - smoothstep(uTunnelRange.y - 12.0, uTunnelRange.y + 18.0, vRoadWorldPos.z));
        float stormExposure = mix(1.0, 0.14, inTunnel);

        // Tire-track subtle wear polishing in all 4 lanes (-5.7, -1.9, +1.9, +5.7)
        float laneMod = abs(mod(vRoadWorldPos.x + 7.6, 3.8) - 1.9);
        float wheelRut = exp(-pow((laneMod - 0.85) * 2.6, 2.0));
        asphaltCol *= mix(1.0, 0.86, wheelRut * 0.65);

        // Puddle field: organic FBM + pooling in wheel ruts & outer drainage shoulders
        float shoulderPool = smoothstep(6.8, 9.2, abs(vRoadWorldPos.x)) * 0.34;
        float puddleNoise = nsFbm(worldXZ * vec2(0.11, 0.055));
        float rawPuddle = puddleNoise + wheelRut * 0.18 + shoulderPool;
        float puddleMask = smoothstep(0.54, 0.74, rawPuddle) * stormExposure;
        float dampMask = clamp((smoothstep(0.22, 0.62, rawPuddle) * 0.8 + 0.25) * stormExposure, 0.08, 1.0);

        // Physical porous darkening of wet asphalt
        asphaltCol *= mix(1.0, 0.44, dampMask);
        asphaltCol = mix(asphaltCol, asphaltCol * 0.72 + vec3(0.006, 0.009, 0.014), puddleMask);

        // Highway lane markings (4 lanes: width 15.2m -> x in [-7.6, +7.6], shoulders out to +-10m)
        float absX = abs(vRoadWorldPos.x);
        // Solid outer shoulder lines at +-7.60m (amber on left -7.6m, crisp white on right +7.6m)
        float edgeLine = 1.0 - smoothstep(0.065, 0.095, abs(absX - 7.60));
        vec3 edgeColor = vRoadWorldPos.x < 0.0 ? vec3(0.92, 0.62, 0.14) : vec3(0.84, 0.87, 0.90);

        // Dashed lane dividers at x = -3.8, 0.0, +3.8 (4.2m dash every 14.0m)
        float divDist = min(abs(vRoadWorldPos.x), abs(absX - 3.80));
        float zCycle = mod(worldXZ.y, 14.0);
        float dashMask = (1.0 - smoothstep(0.055, 0.082, divDist)) * step(zCycle, 4.2);

        // Wear/weathering on road paint so markings look grounded, not vector-plastic
        float paintWear = smoothstep(0.22, 0.72, nsNoise(worldXZ * 2.4));
        float paintAlpha = clamp(edgeLine + dashMask, 0.0, 1.0) * mix(0.68, 0.96, paintWear);
        vec3 paintCol = mix(vec3(0.82, 0.85, 0.88), edgeColor, edgeLine);
        paintCol *= mix(1.0, 0.72, puddleMask);

        // Rumble strip indentations along +-8.15m shoulder
        float rumbleZone = (1.0 - smoothstep(0.18, 0.24, abs(absX - 8.15))) * step(0.5, fract(worldXZ.y * 1.6));
        asphaltCol = mix(asphaltCol, asphaltCol * 0.65, rumbleZone * 0.6);

        diffuseColor.rgb = mix(asphaltCol, paintCol, paintAlpha);
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `
        float roughnessFactor = roughness;
        vec3 armSample = texture2D(roughnessMap, roadUv).rgb;
        float dryRough = clamp(armSample.g * 0.95 + 0.15, 0.35, 0.95);
        // Damp road drops roughness to ~0.20..0.34; standing water puddles drop to mirror ~0.03!
        float wetRough = mix(dryRough, 0.24 - wheelRut * 0.06, dampMask);
        roughnessFactor = mix(wetRough, 0.028, puddleMask);
        roughnessFactor = mix(roughnessFactor, 0.32, paintAlpha * (1.0 - puddleMask * 0.8));
        `,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `
        vec3 mapN = texture2D(normalMap, roadUv).xyz * 2.0 - 1.0;
        // Standing water submerges micro stone bumps while adding concentric raindrop rings
        float bumpFlatten = mix(1.0, 0.08, puddleMask);
        vec2 rippleN = nsRainRipples(worldXZ, uTime) * (0.20 * puddleMask + 0.035 * dampMask);
        mapN.xy = mapN.xy * normalScale * bumpFlatten + rippleN;
        mapN = normalize(mapN);
        normal = normalize(tbn * mapN);
        `,
      )
      .replace(
        '#include <dithering_fragment>',
        `
        // Retro-reflective highway cat's-eye studs every 14m between dashes
        float studZ = abs(zCycle - 9.1);
        float studMask = (1.0 - smoothstep(0.035, 0.06, divDist)) * (1.0 - smoothstep(0.05, 0.09, studZ));
        float headDist = clamp(1.0 - abs(vRoadWorldPos.z - cameraPosition.z) / 140.0, 0.0, 1.0);
        gl_FragColor.rgb += vec3(0.95, 0.78, 0.38) * studMask * headDist * 0.85;

        // Real-Time Planar Reflection Composite with Anisotropic Wet-Asphalt Streak Blur
        if (uReflectionStrength > 0.01 && vReflectCoord.w > 0.0) {
          vec2 projUv = vReflectCoord.xy / vReflectCoord.w;
          // Perturb reflection UV by tangent-space road micro-normals + raindrop ripples (stronger longitudinal elongation!)
          vec2 nPerturb = vec2(mapN.x * 0.045, mapN.y * 0.095);
          vec2 baseRefUv = clamp(projUv + nPerturb * mix(1.0, 0.25, puddleMask), vec2(0.003), vec2(0.997));

          // Anisotropic 5-tap vertical blur proportional to surface roughness (mirror crisp in puddles, stretched glow on damp stone)
          float blurSpan = roughnessFactor * 0.052;
          vec3 refCol = texture2D(uReflectionMap, baseRefUv).rgb * 0.32;
          refCol += texture2D(uReflectionMap, clamp(baseRefUv + vec2(0.0, blurSpan * 0.45), vec2(0.003), vec2(0.997))).rgb * 0.22;
          refCol += texture2D(uReflectionMap, clamp(baseRefUv - vec2(0.0, blurSpan * 0.45), vec2(0.003), vec2(0.997))).rgb * 0.22;
          refCol += texture2D(uReflectionMap, clamp(baseRefUv + vec2(blurSpan * 0.12, blurSpan), vec2(0.003), vec2(0.997))).rgb * 0.12;
          refCol += texture2D(uReflectionMap, clamp(baseRefUv - vec2(blurSpan * 0.12, blurSpan), vec2(0.003), vec2(0.997))).rgb * 0.12;

          vec3 worldSurfN = normalize(vec3(mapN.x * 0.35, 1.0, mapN.y * 0.35));
          vec3 viewDirW = normalize(cameraPosition - vRoadWorldPos);
          float cosTheta = clamp(dot(worldSurfN, viewDirW), 0.0, 1.0);
          float fresnel = 0.03 + 0.97 * pow(1.0 - cosTheta, 4.2);

          float reflectWeight = mix(fresnel * 0.58 * dampMask, mix(0.45, 0.94, fresnel), puddleMask) * uReflectionStrength;
          // Attenuate planar reflection smoothly into atmospheric distance fog
          float fogDist = length(vRoadWorldPos - cameraPosition);
          float fogFade = exp(-pow(fogDist * 0.0034, 2.0));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * (1.0 - reflectWeight * 0.55) + refCol * reflectWeight, fogFade);
        }
        #include <dithering_fragment>
        `,
      );
  };

  material.customProgramCacheKey = () => 'nightshift-wet-asphalt-v1';
  return { material, uniforms };
}
