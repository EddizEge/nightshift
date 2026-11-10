import * as THREE from 'three';
import type { QualitySpec } from '../core/QualityManager';

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const PREFILTER_FRAG = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uTexelSize;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;

vec3 sampleBox(vec2 uv) {
  vec3 c = texture2D(tInput, uv).rgb * 0.25;
  c += texture2D(tInput, uv + uTexelSize * vec2( 1.0,  1.0)).rgb * 0.1875;
  c += texture2D(tInput, uv + uTexelSize * vec2(-1.0,  1.0)).rgb * 0.1875;
  c += texture2D(tInput, uv + uTexelSize * vec2( 1.0, -1.0)).rgb * 0.1875;
  c += texture2D(tInput, uv + uTexelSize * vec2(-1.0, -1.0)).rgb * 0.1875;
  return min(c, vec3(28.0));
}

void main() {
  vec3 col = sampleBox(vUv);
  float br = max(col.r, max(col.g, col.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = (soft * soft) / (4.0 * uKnee + 0.0001);
  float contrib = max(soft, br - uThreshold) / max(br, 0.0001);
  gl_FragColor = vec4(col * max(contrib, 0.0), 1.0);
}
`;

const BLUR_FRAG = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uTexelSize;
uniform float uRadius;
varying vec2 vUv;

void main() {
  vec2 d = uTexelSize * uRadius;
  vec3 s = texture2D(tInput, vUv).rgb * 0.25;
  s += texture2D(tInput, vUv + vec2( d.x,  d.y)).rgb * 0.125;
  s += texture2D(tInput, vUv + vec2(-d.x,  d.y)).rgb * 0.125;
  s += texture2D(tInput, vUv + vec2( d.x, -d.y)).rgb * 0.125;
  s += texture2D(tInput, vUv + vec2(-d.x, -d.y)).rgb * 0.125;
  s += texture2D(tInput, vUv + vec2( d.x,  0.0)).rgb * 0.0625;
  s += texture2D(tInput, vUv + vec2(-d.x,  0.0)).rgb * 0.0625;
  s += texture2D(tInput, vUv + vec2( 0.0,  d.y)).rgb * 0.0625;
  s += texture2D(tInput, vUv + vec2( 0.0, -d.y)).rgb * 0.0625;
  gl_FragColor = vec4(s, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom0;
uniform sampler2D tBloom1;
uniform sampler2D tBloom2;
uniform float uBloomStrength;
uniform float uTime;
uniform float uSpeedNorm;       // 0..1+ (speed / 280 km/h)
uniform float uNitroFactor;     // 0..1
uniform float uMotionStrength;  // quality setting
uniform float uLensRain;        // quality * storm exposure
uniform float uFlashPulse;      // explosion exposure pulse
uniform vec2 uAspect;
varying vec2 vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

// Subtle procedural lens raindrop normal at screen periphery
vec3 lensDropletLayer(vec2 uv, float t, float scale) {
  vec2 st = uv * uAspect * scale;
  st.y += t * 0.18;
  vec2 id = floor(st);
  vec2 gv = fract(st) - 0.5;
  float n = hash21(id);
  float slide = sin(t * (0.9 + n * 1.4) + n * 6.2831) * 0.16;
  vec2 dropPos = vec2((n - 0.5) * 0.52, slide);
  vec2 delta = (gv - dropPos) * vec2(1.0, 0.78);
  float d = length(delta);
  float mask = smoothstep(0.16, 0.03, d) * step(0.58, n);
  return vec3(delta * 5.0 * mask, mask);
}

// Filmic ACES-inspired curve with clean highlight desaturation (no ugly hue clip)
vec3 filmicToneMap(vec3 x) {
  float lum = dot(x, vec3(0.2126, 0.7152, 0.0722));
  vec3 desat = mix(x, vec3(lum), clamp((lum - 1.4) * 0.22, 0.0, 0.55));
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((desat * (a * desat + b)) / (desat * (c * desat + d) + e), 0.0, 1.0);
}

void main() {
  vec2 centered = vUv - vec2(0.5, 0.48);
  float edgeDist = length(centered * vec2(1.0, 1.15));

  // 1. Subtle peripheral lens raindrops (zero in center driving cone!)
  vec2 uvSample = vUv;
  float dropSpec = 0.0;
  if (uLensRain > 0.02) {
    float edgeMask = smoothstep(0.28, 0.68, edgeDist) * uLensRain;
    if (edgeMask > 0.005) {
      vec3 d1 = lensDropletLayer(vUv, uTime, 9.0);
      vec3 d2 = lensDropletLayer(vUv + vec2(0.37, 0.19), uTime * 1.25, 15.0);
      vec2 refractOffset = (d1.xy + d2.xy * 0.65) * 0.011 * edgeMask;
      uvSample = clamp(vUv + refractOffset, vec2(0.002), vec2(0.998));
      dropSpec = (d1.z + d2.z * 0.6) * edgeMask * 0.08;
    }
  }

  // 2. Peripheral radial speed blur (keeps center razor sharp, streaks outer edges at high speed / nitro)
  float radialAmt = smoothstep(0.26, 0.72, edgeDist)
                  * (max(0.0, uSpeedNorm - 0.42) * 0.018 + uNitroFactor * 0.016)
                  * uMotionStrength;

  vec3 hdr = texture2D(tScene, uvSample).rgb;
  if (radialAmt > 0.0005) {
    vec2 dir = normalize(centered + vec2(0.0001));
    vec3 acc = hdr * 0.36;
    acc += texture2D(tScene, clamp(uvSample - dir * radialAmt * 0.35, vec2(0.002), vec2(0.998))).rgb * 0.26;
    acc += texture2D(tScene, clamp(uvSample - dir * radialAmt * 0.70, vec2(0.002), vec2(0.998))).rgb * 0.22;
    acc += texture2D(tScene, clamp(uvSample - dir * radialAmt * 1.05, vec2(0.002), vec2(0.998))).rgb * 0.16;
    hdr = acc;
  }

  // 3. Multi-scale soft photographic HDR Bloom
  vec3 bloom = texture2D(tBloom0, uvSample).rgb * 0.50
             + texture2D(tBloom1, uvSample).rgb * 0.34
             + texture2D(tBloom2, uvSample).rgb * 0.26;
  hdr += bloom * uBloomStrength;
  hdr += vec3(0.75, 0.85, 1.0) * dropSpec;

  // 4. Explosion exposure flash & subtle Nitro cool edge tint
  float exposure = 1.12 + uFlashPulse * 0.55;
  hdr *= exposure;
  hdr += vec3(1.0, 0.72, 0.42) * (uFlashPulse * 0.09);

  // 5. Tone mapping & subtle grounded midnight cinema color balance
  vec3 ldr = filmicToneMap(hdr);

  // Crisp contrast curve + subtle cool-shadow / warm-highlight balance
  float luma = dot(ldr, vec3(0.2126, 0.7152, 0.0722));
  vec3 shadowTint = vec3(0.95, 0.98, 1.04);
  vec3 highlightTint = vec3(1.02, 1.00, 0.97);
  ldr *= mix(shadowTint, highlightTint, smoothstep(0.08, 0.65, luma));

  // Subtle natural optical vignette (never heavy or obscuring)
  float vig = 1.0 - smoothstep(0.45, 0.98, edgeDist) * 0.26;
  ldr *= vig;

  // Output sRGB
  gl_FragColor = vec4(pow(max(ldr, vec3(0.0)), vec3(1.0 / 2.2)), 1.0);
}
`;

export class PostProcessPipeline {
  private sceneRT: THREE.WebGLRenderTarget;
  private bloomRTs: THREE.WebGLRenderTarget[] = [];

  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quadMesh: THREE.Mesh;

  private readonly prefilterMat: THREE.ShaderMaterial;
  private readonly blurMat: THREE.ShaderMaterial;
  private readonly compositeMat: THREE.ShaderMaterial;

  private width = 1280;
  private height = 720;
  private msaaSamples = 4;

  constructor(width: number, height: number, spec: QualitySpec) {
    this.width = Math.max(64, width);
    this.height = Math.max(64, height);
    this.msaaSamples = spec.msaaSamples;

    this.sceneRT = this.createSceneRT(this.width, this.height, this.msaaSamples);
    this.createBloomChain(this.width, this.height);

    this.prefilterMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: PREFILTER_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tInput: { value: null },
        uTexelSize: { value: new THREE.Vector2(1 / this.width, 1 / this.height) },
        uThreshold: { value: 1.08 },
        uKnee: { value: 0.55 },
      },
    });

    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tInput: { value: null },
        uTexelSize: { value: new THREE.Vector2() },
        uRadius: { value: 1.25 },
      },
    });

    this.compositeMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: this.sceneRT.texture },
        tBloom0: { value: this.bloomRTs[0].texture },
        tBloom1: { value: this.bloomRTs[1].texture },
        tBloom2: { value: this.bloomRTs[2].texture },
        uBloomStrength: { value: spec.bloomStrength },
        uTime: { value: 0 },
        uSpeedNorm: { value: 0 },
        uNitroFactor: { value: 0 },
        uMotionStrength: { value: spec.motionBlurStrength },
        uLensRain: { value: spec.lensRainStrength },
        uFlashPulse: { value: 0 },
        uAspect: { value: new THREE.Vector2(this.width / this.height, 1.0) },
      },
    });

    const geo = new THREE.PlaneGeometry(2, 2);
    this.quadMesh = new THREE.Mesh(geo, this.compositeMat);
    this.quadMesh.frustumCulled = false;
    this.quadScene.add(this.quadMesh);
  }

  private createSceneRT(w: number, h: number, samples: number): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      samples,
    });
  }

  private createBloomChain(w: number, h: number): void {
    for (const rt of this.bloomRTs) rt.dispose();
    this.bloomRTs = [];
    const scales = [0.5, 0.25, 0.125];
    for (const s of scales) {
      this.bloomRTs.push(
        new THREE.WebGLRenderTarget(Math.max(16, Math.floor(w * s)), Math.max(16, Math.floor(h * s)), {
          type: THREE.HalfFloatType,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          depthBuffer: false,
          stencilBuffer: false,
        }),
      );
    }
  }

  public applyQuality(spec: QualitySpec, width: number, height: number): void {
    this.width = Math.max(64, width);
    this.height = Math.max(64, height);

    if (this.msaaSamples !== spec.msaaSamples) {
      this.msaaSamples = spec.msaaSamples;
      this.sceneRT.dispose();
      this.sceneRT = this.createSceneRT(this.width, this.height, this.msaaSamples);
      this.compositeMat.uniforms.tScene.value = this.sceneRT.texture;
    } else {
      this.sceneRT.setSize(this.width, this.height);
    }

    this.createBloomChain(this.width, this.height);
    this.compositeMat.uniforms.tBloom0.value = this.bloomRTs[0].texture;
    this.compositeMat.uniforms.tBloom1.value = this.bloomRTs[1].texture;
    this.compositeMat.uniforms.tBloom2.value = this.bloomRTs[2].texture;

    this.compositeMat.uniforms.uBloomStrength.value = spec.bloomStrength;
    this.compositeMat.uniforms.uMotionStrength.value = spec.motionBlurStrength;
    this.compositeMat.uniforms.uLensRain.value = spec.lensRainStrength;
    this.compositeMat.uniforms.uAspect.value.set(this.width / Math.max(1, this.height), 1.0);
  }

  public render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    params: {
      time: number;
      speedKmh: number;
      nitroFactor: number;
      stormExposure: number;
      flashPulse: number;
      spec: QualitySpec;
    },
  ): void {
    // 1. Render main 3D HDR scene into MSAA HalfFloat RT
    renderer.setRenderTarget(this.sceneRT);
    renderer.clear();
    renderer.render(scene, camera);

    // 2. Bloom prefilter -> Level 0 (1/2 res)
    this.quadMesh.material = this.prefilterMat;
    this.prefilterMat.uniforms.tInput.value = this.sceneRT.texture;
    this.prefilterMat.uniforms.uTexelSize.value.set(1 / this.width, 1 / this.height);
    renderer.setRenderTarget(this.bloomRTs[0]);
    renderer.render(this.quadScene, this.quadCam);

    // 3. Downsample & Kawase blur -> Level 1 (1/4 res) & Level 2 (1/8 res)
    this.quadMesh.material = this.blurMat;
    for (let i = 1; i < this.bloomRTs.length; i++) {
      const prev = this.bloomRTs[i - 1];
      this.blurMat.uniforms.tInput.value = prev.texture;
      this.blurMat.uniforms.uTexelSize.value.set(1 / prev.width, 1 / prev.height);
      this.blurMat.uniforms.uRadius.value = 1.35 + i * 0.45;
      renderer.setRenderTarget(this.bloomRTs[i]);
      renderer.render(this.quadScene, this.quadCam);
    }

    // 4. Final single-pass HDR composite to canvas
    this.quadMesh.material = this.compositeMat;
    this.compositeMat.uniforms.uTime.value = params.time;
    this.compositeMat.uniforms.uSpeedNorm.value = params.speedKmh / 270.0;
    this.compositeMat.uniforms.uNitroFactor.value = params.nitroFactor;
    this.compositeMat.uniforms.uLensRain.value = params.spec.lensRainStrength * params.stormExposure;
    this.compositeMat.uniforms.uFlashPulse.value = params.flashPulse;

    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCam);
  }

  public dispose(): void {
    this.sceneRT.dispose();
    for (const rt of this.bloomRTs) rt.dispose();
    this.prefilterMat.dispose();
    this.blurMat.dispose();
    this.compositeMat.dispose();
  }
}
