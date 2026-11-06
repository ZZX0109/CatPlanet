import * as THREE from "three";
import {
  createCatFurVolumeMaterial,
  configureCatFurVolumeMaterial,
} from "../../lib/cat-fur-volume-material";
import { createCatFurCompositor } from "../../lib/cat-fur-compositor";

// This fixture verifies a known participating medium, not a photograph or a
// reconstruction claim. No production renderer, geometry, or density is patched.
export function runFurVolumeAnalytic() {
  const size = 128;
  const width = 1.6;
  const density = 0.5;
  const colour = [0.6, 0.2, 0.1];
  const decodeScale = 200;
  const height = 0.1;
  const background = [0.02, 0.03, 0.04];
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (!context) throw new Error("WebGL2 is required by the volume fixture.");
  const renderer = new THREE.WebGLRenderer({ canvas, context });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.debug.checkShaderErrors = true;
  document.body.append(canvas);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
  camera.position.set(0, 0, 3);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(...background);
  scene.add(new THREE.AmbientLight(0xffffff, Math.PI));

  const sourceMap = new THREE.DataTexture(
    new Uint8Array([51, 153, 77, 255]),
    1,
    1,
    THREE.RGBAFormat,
  );
  sourceMap.colorSpace = THREE.NoColorSpace;
  sourceMap.needsUpdate = true;
  // A deliberately unrelated tint/map catches accidental double albedo products.
  const sourceMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.73, 0.51, 0.89),
    map: sourceMap,
    roughness: 1,
    metalness: 0,
  });
  const sourceGeometry = new THREE.PlaneGeometry(width, width);
  const borrowedDisposals = { geometry: 0, material: 0, map: 0, volume: 0 };
  sourceGeometry.addEventListener(
    "dispose",
    () => borrowedDisposals.geometry++,
  );
  sourceMaterial.addEventListener(
    "dispose",
    () => borrowedDisposals.material++,
  );
  sourceMap.addEventListener("dispose", () => borrowedDisposals.map++);

  const textureHalf = new Uint16Array(2 * 1 * 16 * 4);
  for (let z = 0; z < 16; z++) {
    const h = (z + 0.5) / 16;
    const kappa = (20 + 80 * h) / decodeScale;
    const offset = z * 2 * 4;
    for (let channel = 0; channel < 3; channel++)
      textureHalf[offset + channel] = THREE.DataUtils.toHalfFloat(
        colour[channel] * kappa,
      );
    textureHalf[offset + 3] = THREE.DataUtils.toHalfFloat(kappa);
    // The neighbouring column remains (0,0,0,0), not black opaque medium.
  }
  const densityTexture = new THREE.Data3DTexture(textureHalf, 2, 1, 16);
  densityTexture.type = THREE.HalfFloatType;
  densityTexture.format = THREE.RGBAFormat;
  densityTexture.colorSpace = THREE.NoColorSpace;
  densityTexture.minFilter = densityTexture.magFilter = THREE.LinearFilter;
  densityTexture.wrapS =
    densityTexture.wrapT =
    densityTexture.wrapR =
      THREE.ClampToEdgeWrapping;
  densityTexture.generateMipmaps = false;
  densityTexture.unpackAlignment = 1;
  densityTexture.needsUpdate = true;
  densityTexture.addEventListener("dispose", () => borrowedDisposals.volume++);

  const wallGeometry = new THREE.PlaneGeometry(width, width);
  const wallMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const wall = new THREE.Mesh(wallGeometry, wallMaterial);
  // Also stays behind the rotated/nonuniformly scaled analytic container.
  wall.position.z = -1;
  scene.add(wall);
  const frontGeometry = new THREE.PlaneGeometry(0.7, 0.7);
  const frontColour = [0.16, 0.08, 0.04];
  const frontMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(...frontColour),
  });
  const front = new THREE.Mesh(frontGeometry, frontMaterial);
  front.position.z = 0.25;
  front.visible = false;
  scene.add(front);

  const compositor = createCatFurCompositor(renderer);
  const ownedGeometries = [];
  const ownedMaterials = [];
  const ownedDisposals = { geometry: 0, material: 0 };
  let capturedTarget = null;
  let active = null;
  let cleaned = false;

  function geometryFor(layers, slope = 0) {
    const arrays = {
      position: [3, []],
      normal: [3, []],
      uv: [2, []],
      furBindPosition: [3, []],
      furVolumeDepth: [1, []],
      furVolumeThickness: [1, []],
      furVolumeTangent: [3, []],
      furVolumeDensity: [1, []],
      furVolumeEnvelope: [1, []],
      furVolumeStep: [3, []],
    };
    const indices = [];
    const corners = [
      [-width / 2, -width / 2, 0, 0],
      [width / 2, -width / 2, 1, 0],
      [-width / 2, width / 2, 0, 1],
      [width / 2, width / 2, 1, 1],
    ];
    for (let layer = 0; layer < layers; layer++) {
      const h = (layer + 0.5) / layers;
      for (const [x, y, u, v] of corners) {
        const localHeight = height + slope * x;
        arrays.position[1].push(x, y, localHeight * h);
        arrays.normal[1].push(0, 0, 1);
        arrays.uv[1].push(u, v);
        arrays.furBindPosition[1].push(x, y, 0);
        arrays.furVolumeDepth[1].push(h);
        arrays.furVolumeThickness[1].push(localHeight / layers);
        arrays.furVolumeTangent[1].push(0, 0, 1);
        arrays.furVolumeDensity[1].push(density);
        arrays.furVolumeEnvelope[1].push(localHeight);
        arrays.furVolumeStep[1].push(0, 0, localHeight / layers);
      }
      const i = layer * 4;
      indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
    const geometry = new THREE.BufferGeometry();
    for (const [name, [itemSize, values]] of Object.entries(arrays))
      geometry.setAttribute(
        name,
        new THREE.Float32BufferAttribute(values, itemSize),
      );
    geometry.setIndex(indices);
    geometry.addEventListener("dispose", () => ownedDisposals.geometry++);
    ownedGeometries.push(geometry);
    return geometry;
  }

  function makeVolume({
    layers,
    slope = 0,
    transformed = false,
    map = true,
    uvTransform,
  }) {
    if (active) scene.remove(active);
    const savedMap = sourceMaterial.map;
    sourceMaterial.map = map ? savedMap : null;
    const material = createCatFurVolumeMaterial(sourceMaterial);
    sourceMaterial.map = savedMap;
    material.addEventListener("dispose", () => ownedDisposals.material++);
    ownedMaterials.push(material);
    const originalBeforeRender = material.onBeforeRender;
    material.onBeforeRender = function (...args) {
      originalBeforeRender.apply(this, args);
      const target = args[0].getRenderTarget();
      if (target?.textures?.length === 2) capturedTarget = target;
    };
    const configuredTransform = uvTransform
      ? new THREE.Vector4(...uvTransform)
      : undefined;
    configureCatFurVolumeMaterial(material, {
      densityTexture,
      densityScale: decodeScale,
      ...(configuredTransform
        ? { densityUvTransform: configuredTransform }
        : {}),
    });
    // Mutation after configuration must not mutate the material's own uniform.
    configuredTransform?.set(0, 0, 0, 0);
    const mesh = new THREE.Mesh(geometryFor(layers, slope), material);
    mesh.frustumCulled = false;
    mesh.userData = { furVolumeRegion: "body", volumePreviewOnly: true };
    if (transformed) {
      mesh.rotation.y = 0.6;
      mesh.scale.set(1.35, 0.8, 1.7);
    }
    scene.add(mesh);
    mesh.updateMatrixWorld(true);
    active = mesh;
    return mesh;
  }

  function readAttachment(attachment, x, y) {
    if (!capturedTarget)
      throw new Error("The material never rendered into MRT.");
    const half = new Uint16Array(4);
    renderer.readRenderTargetPixels(
      capturedTarget,
      x,
      y,
      1,
      1,
      half,
      undefined,
      attachment,
    );
    return Array.from(half, THREE.DataUtils.fromHalfFloat);
  }

  function readCanvas(x, y) {
    const values = new Uint8Array(4);
    context.readPixels(x, y, 1, 1, context.RGBA, context.UNSIGNED_BYTE, values);
    return Array.from(values, (v) => v / 255);
  }

  const sampleXs = [26, 48, 64, 77, 84, 95];
  function frame(mesh, options = {}) {
    capturedTarget = null;
    compositor.render(scene, camera, [mesh]);
    const pixels = (options.xs ?? sampleXs).map((x) => {
      const y = 64;
      const accumulation = readAttachment(0, x, y);
      const opticalDepth = readAttachment(1, x, y)[0];
      return {
        x,
        y,
        worldX: ((x + 0.5) / size) * 2 - 1,
        worldY: ((y + 0.5) / size) * 2 - 1,
        accumulation,
        opticalDepth,
        coverage: 1 - Math.exp(-opticalDepth),
        canvas: readCanvas(x, y),
      };
    });
    return {
      pixels,
      background: readCanvas(3, 3),
      info: compositor.getInfo(),
      targetNames: capturedTarget.textures.map((t) => t.name),
      matrix: mesh.matrixWorld.toArray(),
      metadata: structuredClone(mesh.material.userData.catFurVolume),
      restoredRenderTarget: renderer.getRenderTarget() === null,
    };
  }

  // Independent opaque PBR reference separates texture filtering from the
  // standard dielectric energy split; it is not an override of the fur shader.
  const referenceScene = new THREE.Scene();
  referenceScene.add(new THREE.AmbientLight(0xffffff, Math.PI));
  const referenceMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(...colour),
    roughness: 1,
    metalness: 0,
  });
  const referenceMesh = new THREE.Mesh(sourceGeometry, referenceMaterial);
  referenceScene.add(referenceMesh);
  const referenceTarget = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.HalfFloatType,
    colorSpace: THREE.LinearSRGBColorSpace,
  });

  function cleanVolume() {
    if (cleaned) return;
    cleaned = true;
    if (active) scene.remove(active);
    compositor.dispose();
    ownedGeometries.forEach((g) => g.dispose());
    ownedMaterials.forEach((m) => m.dispose());
  }

  try {
    renderer.setRenderTarget(referenceTarget);
    renderer.setClearColor(0, 1);
    renderer.clear();
    renderer.render(referenceScene, camera);
    const referenceHalf = new Uint16Array(4);
    renderer.readRenderTargetPixels(
      referenceTarget,
      64,
      64,
      1,
      1,
      referenceHalf,
    );
    const referenceColour = Array.from(
      referenceHalf,
      THREE.DataUtils.fromHalfFloat,
    );
    renderer.setRenderTarget(null);

    const cases = [];
    for (const settings of [
      { name: "sixteen", layers: 16 },
      { name: "eight", layers: 8 },
      { name: "without-base-map", layers: 16, map: false },
      {
        name: "copied-uv-transform",
        layers: 8,
        uvTransform: [0.5, 1, 0.25, 0],
      },
      {
        name: "scaled-sloping-envelope",
        layers: 16,
        slope: 0.1,
        transformed: true,
      },
    ]) {
      const mesh = makeVolume(settings);
      cases.push({
        ...settings,
        ...frame(mesh, settings.transformed ? { xs: [26, 48, 64] } : {}),
      });
    }
    const plain = makeVolume({ layers: 16 });
    const beforeWall = frame(plain);
    front.visible = true;
    const blocked = frame(plain);
    front.visible = false;
    configureCatFurVolumeMaterial(plain.material, { densityTexture: null });
    const procedural = frame(plain);
    configureCatFurVolumeMaterial(plain.material, {
      densityTexture,
      densityScale: decodeScale,
    });
    const rebound = frame(plain);
    const diagnostics = {
      error: context.getError(),
      attributes: context.getContextAttributes(),
      programs: renderer.info.programs.map((p) => ({
        name: p.name,
        runnable: p.diagnostics?.runnable ?? true,
        programLog: p.diagnostics?.programLog ?? "",
      })),
    };
    cleanVolume();
    const afterVolumeCleanup = {
      borrowed: { ...borrowedDisposals },
      owned: { ...ownedDisposals },
      expectedOwned: {
        geometry: ownedGeometries.length,
        material: ownedMaterials.length,
      },
    };
    // Demonstrate the original geometry/material/map remain renderable after
    // cleanup, rather than checking only that no disposal event was observed.
    const sourceScene = new THREE.Scene();
    sourceScene.add(new THREE.AmbientLight(0xffffff, Math.PI));
    sourceScene.add(new THREE.Mesh(sourceGeometry, sourceMaterial));
    renderer.setRenderTarget(null);
    renderer.setClearColor(0, 1);
    renderer.render(sourceScene, camera);
    const sourceAfterCleanup = readCanvas(64, 64);
    return {
      size,
      width,
      height,
      density,
      colour,
      decodeScale,
      background,
      frontColour,
      texture: { dimensions: [2, 1, 16], half: Array.from(textureHalf) },
      referenceColour,
      cases,
      beforeWall,
      blocked,
      procedural,
      rebound,
      afterVolumeCleanup,
      sourceAfterCleanup,
      diagnostics,
      errorAfterCleanup: context.getError(),
    };
  } finally {
    cleanVolume();
    referenceTarget.dispose();
    referenceMaterial.dispose();
    wallGeometry.dispose();
    wallMaterial.dispose();
    frontGeometry.dispose();
    frontMaterial.dispose();
    sourceGeometry.dispose();
    sourceMaterial.dispose();
    sourceMap.dispose();
    densityTexture.dispose();
    renderer.dispose();
    canvas.remove();
  }
}
