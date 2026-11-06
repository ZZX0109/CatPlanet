/** CPU contract checks for the render-only shell resource; no browser/GPU. */
import fs from "node:fs/promises";
import { build } from "esbuild";
import vm from "node:vm";

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "ts",
    contents:
      "import * as THREE from 'three';import {createCatFurVolume} from './lib/cat-fur-volume';globalThis.__volumeContract={THREE,createCatFurVolume};",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "iife",
});
vm.runInThisContext(bundle.outputFiles[0].text);
const { THREE, createCatFurVolume } = globalThis.__volumeContract;
const checks = [];
function check(name, pass, details) {
  checks.push({ name, pass: Boolean(pass), details });
  if (!pass) throw Error(name);
}
const positions = new Float32Array([
  0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 10, 1, 0, 10, 0, 1, 10, 0, 2, 0, 1, 2, 0, 0,
  3, 0,
]);
const normals = new Float32Array(positions.length),
  directions = new Float32Array(positions.length);
for (let i = 0; i < positions.length; i += 3) {
  normals[i + 2] = 1;
  directions[i] = 1;
}
const uv = new THREE.BufferAttribute(new Float32Array(18), 2);
const body = new Float32Array([1, 1, 1, 0, 0, 0, 0, 0, 0]),
  ruff = new Float32Array([0, 0, 0, 0, 0, 0, 1, 1, 1]);
const envelope = {
  body: new Float32Array(9).fill(2),
  ruff: new Float32Array(9).fill(3),
};
const sweep = {
  body: new Float32Array(9).fill(1),
  ruff: new Float32Array(9).fill(0.5),
};
const texture = new THREE.DataTexture(
  new Uint8Array([255, 255, 255, 255]),
  1,
  1,
);
const base = new THREE.MeshStandardMaterial({ map: texture });
let baseDisposals = 0,
  textureDisposals = 0;
base.addEventListener("dispose", () => baseDisposals++);
texture.addEventListener("dispose", () => textureDisposals++);
const resource = createCatFurVolume({
  positions,
  normals,
  uv,
  index: new THREE.BufferAttribute(
    new Uint16Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
    1,
  ),
  regionWeights: { body, ruff },
  directions,
  envelope,
  sweep,
  baseMaterial: base,
});
const group = new THREE.Group();
group.add(...resource.meshes);
const bodyMesh = resource.meshes.find(
    (m) => m.userData.furVolumeRegion === "body",
  ),
  ruffMesh = resource.meshes.find((m) => m.userData.furVolumeRegion === "ruff");
const settings = {
  positions,
  normals,
  directions,
  lengths: { body: 0.1, ruff: 0.2 },
  densities: { body: 0.5, ruff: 0.4 },
  coatType: "long",
};
resource.update(settings);
const finMesh = resource.meshes.find((m) => m.name === "FurVolumeFin_body");
check(
  "fins reuse exactly the three source boundary edges",
  finMesh.userData.volumeSourceEdges === 3 &&
    finMesh.userData.volumeFinSegments === 6,
);
check(
  "fins have one winding and an independent DoubleSide material",
  finMesh.material.side === THREE.DoubleSide &&
    finMesh.geometry.index.count === 3 * 6 * 6,
);
check(
  "fin standard normals remain skin normals with separate plane normals",
  finMesh.geometry.attributes.normal.getZ(0) === 1 &&
    Math.abs(finMesh.geometry.attributes.furVolumeViewNormal.getY(0)) === 1,
);
check(
  "fins use physical transverse cell thickness instead of height/layers",
  Math.abs(finMesh.geometry.attributes.furVolumeThickness.getX(0) - 0.5) < 1e-7,
);
check(
  "fin endpoints follow the same complete N/T extrusion",
  Math.abs(finMesh.geometry.attributes.position.getX(12) - 0.1) < 1e-7 &&
    Math.abs(finMesh.geometry.attributes.position.getZ(12) - 0.2) < 1e-7,
);
check(
  "fin marker and existing-shadow receive flags are set",
  finMesh.geometry.attributes.furVolumeFin.getX(0) === 1 &&
    resource.meshes.every((m) => m.receiveShadow && !m.castShadow),
);
check("only body enabled by default", bodyMesh.visible && !ruffMesh.visible);
check(
  "source triangles preserved without linking the unrelated head sheet",
  bodyMesh.userData.volumeSourceTriangles === 1 &&
    bodyMesh.userData.volumeSourceVertices === 3,
);
check(
  "six agreed attributes exist",
  [
    "furBindPosition",
    "furVolumeDepth",
    "furVolumeThickness",
    "furVolumeTangent",
    "furVolumeDensity",
    "furVolumeEnvelope",
  ].every((k) => bodyMesh.geometry.getAttribute(k)),
);
check(
  "16 shell midpoints",
  bodyMesh.geometry.attributes.position.count === 48 &&
    bodyMesh.userData.volumeLayerCount === 16,
);
const canonical = bodyMesh.geometry.attributes.furBindPosition.array.slice();
const thicknessSum = (mesh) => {
  const a = mesh.geometry.attributes.furVolumeThickness,
    n = mesh.userData.volumeSourceVertices;
  let sum = 0;
  for (let layer = 0; layer < mesh.userData.volumeLayerCount; layer++)
    sum += a.getX(layer * n);
  return sum;
};
check(
  "16 layers integrate the physical envelope",
  Math.abs(thicknessSum(bodyMesh) - 0.2) < 1e-7,
);
check(
  "density is the root control, not divided by16",
  bodyMesh.geometry.attributes.furVolumeDensity.getX(0) === 0.5,
);
const originalAttributes = resource.meshes.map((mesh) =>
  Object.fromEntries(
    Object.entries(mesh.geometry.attributes).map(([name, attr]) => [
      name,
      attr.array.slice(),
    ]),
  ),
);
const scaledGeometry = bodyMesh.geometry;
resource.setGeometryScales({ envelopeScale: 1.4, sweepScale: 0 });
check(
  "geometry-scale setter updates the cached pose immediately without reallocating",
  bodyMesh.geometry === scaledGeometry &&
    Math.abs(bodyMesh.geometry.attributes.position.getX(0)) < 1e-8 &&
    Math.abs(
      bodyMesh.geometry.attributes.position.getZ(0) - (0.28 * 0.5) / 16,
    ) < 1e-7,
);
check(
  "container step is physical while optical fibre direction stays unchanged",
  Math.abs(bodyMesh.geometry.attributes.furVolumeStep.getX(0)) < 1e-8 &&
    Math.abs(bodyMesh.geometry.attributes.furVolumeStep.getZ(0) - 0.28 / 16) <
      1e-7 &&
    [bodyMesh, finMesh].every((mesh) => {
      const i = resource.meshes.indexOf(mesh),
        attr = mesh.geometry.attributes.furVolumeTangent.array;
      return attr.every(
        (value, j) => value === originalAttributes[i].furVolumeTangent[j],
      );
    }),
);
check(
  "scaled container integrates scaled thickness and moves fin endpoints consistently",
  Math.abs(thicknessSum(bodyMesh) - 0.28) < 1e-7 &&
    Math.abs(finMesh.geometry.attributes.position.getX(12)) < 1e-8 &&
    Math.abs(finMesh.geometry.attributes.position.getZ(12) - 0.28) < 1e-7,
);
check(
  "container metadata reports both scales",
  resource
    .getInfo()
    .every(
      (info) =>
        info.geometryScales.envelopeScale === 1.4 &&
        info.geometryScales.sweepScale === 0,
    ) &&
    resource.meshes.every(
      (mesh) => mesh.userData.volumeGeometryScales.envelopeScale === 1.4,
    ),
);
resource.setGeometryScales();
check(
  "resetting scale1/1 restores every generated attribute byte-for-byte",
  resource.meshes.every((mesh, i) =>
    Object.entries(mesh.geometry.attributes).every(([name, attr]) =>
      attr.array.every((value, j) => value === originalAttributes[i][name][j]),
    ),
  ),
);
const old = bodyMesh.geometry;
const oldFin = finMesh.geometry;
let oldFinDisposed = 0;
oldFin.addEventListener("dispose", () => oldFinDisposed++);
let oldDisposed = 0;
old.addEventListener("dispose", () => oldDisposed++);
resource.update({ ...settings, layerCount: 8 });
check(
  "lowLOD fins switch to4 segments and release the old buffer once",
  finMesh.userData.volumeFinSegments === 4 &&
    oldFinDisposed === 1 &&
    finMesh.geometry !== oldFin,
);
check(
  "fin cell thickness is independent of shell and fin subdivision",
  Math.abs(finMesh.geometry.attributes.furVolumeThickness.getX(0) - 0.5) < 1e-7,
);
check(
  "switching layer count disposes only the old owned geometry once",
  oldDisposed === 1 &&
    bodyMesh.geometry !== old &&
    bodyMesh.geometry.attributes.position.count === 24,
);
check(
  "8 layers preserve the integrated thickness and density",
  Math.abs(thicknessSum(bodyMesh) - 0.2) < 1e-7 &&
    bodyMesh.geometry.attributes.furVolumeDensity.getX(0) === 0.5,
);
const posed = positions.slice(),
  posedDirections = directions.slice();
for (let i = 0; i < posed.length; i += 3) {
  posed[i] = -positions[i + 1] + 2;
  posed[i + 1] = positions[i] + 3;
  posedDirections[i] = 0;
  posedDirections[i + 1] = 1;
}
resource.update({
  ...settings,
  positions: posed,
  directions: posedDirections,
  layerCount: 8,
});
const a = bodyMesh.geometry.attributes.position,
  h = 0.5 / 8;
check(
  "positions transport with the supplied posed skin and tangent",
  Math.abs(a.getX(0) - 2) < 1e-7 &&
    Math.abs(a.getY(0) - (3 + 0.1 * h * h)) < 1e-6 &&
    Math.abs(a.getZ(0) - 0.2 * h) < 1e-7,
);
check(
  "canonical density seeds do not swim with pose",
  bodyMesh.geometry.attributes.furBindPosition.getX(0) === canonical[0] &&
    bodyMesh.geometry.attributes.furBindPosition.getY(0) === canonical[1],
);
check(
  "all generated geometry remains finite",
  resource.meshes.every((m) =>
    Object.values(m.geometry.attributes).every((a) =>
      Array.from(a.array).every(Number.isFinite),
    ),
  ),
);
resource.update({
  ...settings,
  enabledRegions: { body: false, ruff: true },
  layerCount: 8,
});
check(
  "regional enable flags are independent",
  !bodyMesh.visible &&
    ruffMesh.visible &&
    ruffMesh.userData.volumeSourceTriangles === 1,
);
resource.update({ ...settings, coatType: "short" });
check(
  "short coat hides all volume without exporting a surrogate",
  resource.meshes.every((m) => !m.visible) &&
    resource.snapshotMeshes().length === 0,
);
resource.update({ ...settings, densities: { body: 0, ruff: 0 } });
check(
  "zero density hides all regions",
  resource.meshes.every((m) => !m.visible),
);
check(
  "preview metadata never imitates strand stats",
  resource.meshes.every(
    (m) =>
      m.userData.volumePreviewOnly &&
      m.userData.norwegianFur &&
      !("furRegion" in m.userData),
  ),
);
const ownMaterials = new Map(resource.meshes.map((m) => [m.material, 0]));
const ownGeometries = new Map(resource.meshes.map((m) => [m.geometry, 0]));
for (const m of ownMaterials.keys())
  m.addEventListener("dispose", () =>
    ownMaterials.set(m, ownMaterials.get(m) + 1),
  );
for (const g of ownGeometries.keys())
  g.addEventListener("dispose", () =>
    ownGeometries.set(g, ownGeometries.get(g) + 1),
  );
resource.dispose();
resource.dispose();
check(
  "owned current geometries/materials dispose exactly once",
  [...ownMaterials.values(), ...ownGeometries.values()].every((n) => n === 1),
);
check(
  "source material and shared base texture are not disposed",
  baseDisposals === 0 && textureDisposals === 0,
);
check(
  "disposed preview meshes detach",
  resource.meshes.every((m) => m.parent === null),
);
check(
  "updates after disposal remain a no-op",
  (() => {
    resource.update(settings);
    return resource.meshes.every((m) => m.parent === null);
  })(),
);
await fs.mkdir("artifacts/fur-volume", { recursive: true });
const report = {
  capturedAt: new Date().toISOString(),
  scope:
    "Small CPU contract fixture only; not actual cat/WebGL/visual/performance acceptance.",
  checks,
  pass: checks.every((c) => c.pass),
};
await fs.writeFile(
  "artifacts/fur-volume/geometry-contract.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
base.dispose();
texture.dispose();
