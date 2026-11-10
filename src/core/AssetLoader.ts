import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

export interface LoadedGameAssets {
  envMap: THREE.Texture;
  skyEquirect: THREE.DataTexture;
  playerCarGltf: GLTF;
  sedanGltf: GLTF;
  suvGltf: GLTF;
  truckGltf: GLTF;
  tankerGltf: GLTF;
  asphaltDiff: THREE.Texture;
  asphaltNor: THREE.Texture;
  asphaltArm: THREE.Texture;
  concreteDiff: THREE.Texture;
  concreteNor: THREE.Texture;
  concreteArm: THREE.Texture;
}

export class AssetLoader {
  public static async loadAll(
    renderer: THREE.WebGLRenderer,
    anisotropy: number,
    onProgress: (pct: number, status: string) => void,
  ): Promise<LoadedGameAssets> {
    const gltfLoader = new GLTFLoader();
    const rgbeLoader = new RGBELoader();
    const texLoader = new THREE.TextureLoader();

    const totalSteps = 12;
    let completed = 0;
    const step = (msg: string) => {
      completed++;
      onProgress(Math.round((completed / totalSteps) * 100), msg);
    };

    onProgress(5, 'Loading Night Bridge HDRI Environment...');
    const skyEquirect = await rgbeLoader.loadAsync('./assets/hdri/night_bridge_1k.hdr');
    skyEquirect.mapping = THREE.EquirectangularReflectionMapping;

    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envMap = pmrem.fromEquirectangular(skyEquirect).texture;
    pmrem.dispose();
    step('Compiled PBR Specular Environment Map...');

    const prepTex = async (url: string, isSRGB: boolean, label: string): Promise<THREE.Texture> => {
      const t = await texLoader.loadAsync(url);
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = isSRGB ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = anisotropy;
      step(label);
      return t;
    };

    const [
      asphaltDiff,
      asphaltNor,
      asphaltArm,
      concreteDiff,
      concreteNor,
      concreteArm,
      playerCarGltf,
      sedanGltf,
      suvGltf,
      truckGltf,
      tankerGltf,
    ] = await Promise.all([
      prepTex('./assets/textures/asphalt/asphalt_diff.jpg', true, 'Loaded Scanned Asphalt Albedo...'),
      prepTex('./assets/textures/asphalt/asphalt_nor.jpg', false, 'Loaded Scanned Asphalt Micro-Normals...'),
      prepTex('./assets/textures/asphalt/asphalt_arm.jpg', false, 'Loaded Asphalt Roughness & AO...'),
      prepTex('./assets/textures/concrete/concrete_diff.jpg', true, 'Loaded Highway Concrete Albedo...'),
      prepTex('./assets/textures/concrete/concrete_nor.jpg', false, 'Loaded Highway Concrete Normals...'),
      prepTex('./assets/textures/concrete/concrete_arm.jpg', false, 'Loaded Highway Concrete ARM...'),
      gltfLoader.loadAsync('./assets/models/player_car.glb').then((g) => {
        step('Loaded Hero Supercar PBR Mesh...');
        return g;
      }),
      gltfLoader.loadAsync('./assets/models/traffic_sedan.glb').then((g) => {
        step('Loaded Executive Sedan Traffic Model...');
        return g;
      }),
      gltfLoader.loadAsync('./assets/models/traffic_suv.glb').then((g) => {
        step('Loaded Luxury SUV Traffic Model...');
        return g;
      }),
      gltfLoader.loadAsync('./assets/models/traffic_truck.glb').then((g) => {
        step('Loaded Heavy Semi-Truck Model...');
        return g;
      }),
      gltfLoader.loadAsync('./assets/models/traffic_tanker.glb').then((g) => {
        step('Loaded Hazard Fuel Tanker Model...');
        return g;
      }),
    ]);

    return {
      envMap,
      skyEquirect,
      playerCarGltf,
      sedanGltf,
      suvGltf,
      truckGltf,
      tankerGltf,
      asphaltDiff,
      asphaltNor,
      asphaltArm,
      concreteDiff,
      concreteNor,
      concreteArm,
    };
  }
}
