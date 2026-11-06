/** Read-only structural audit of the generated GLB. Does not modify the asset.
 * node scripts/audit-creator-geometry.mjs [asset.glb] [report.json]
 * Triangle/normal metrics are diagnostic evidence, not an anatomical quality certificate.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const assetPath = process.argv[2] ?? "public/models/creator/structural-cat.glb";
const reportPath =
  process.argv[3] ?? "artifacts/creator-refinement/geometry-audit.json";

// Geometry auditing runs without a DOM. Remove image references from an in-memory
// copy only; all accessor buffer views and the original BIN chunk stay unchanged.
function geometryOnlyGlb(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67)
    throw new Error("Expected a binary glTF");
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString());
  const binChunk = bytes.subarray(20 + length);
  for (const material of json.materials ?? []) {
    for (const key of Object.keys(material))
      if (key.endsWith("Texture")) delete material[key];
    for (const key of Object.keys(material.pbrMetallicRoughness ?? {}))
      if (key.endsWith("Texture")) delete material.pbrMetallicRoughness[key];
    for (const extension of Object.values(material.extensions ?? {}))
      for (const key of Object.keys(extension))
        if (key.endsWith("Texture")) delete extension[key];
  }
  delete json.images;
  delete json.textures;
  delete json.samplers;
  const encoded = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20);
  encoded.copy(padded);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length + binChunk.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const result = Buffer.concat([header, padded, binChunk]);
  return result.buffer.slice(
    result.byteOffset,
    result.byteOffset + result.byteLength,
  );
}

const source = await fs.readFile(assetPath);
const sourceSha256 = createHash("sha256").update(source).digest("hex");
// The optical globe has its front cap removed. Its bounding-box Z midpoint is
// therefore behind the real sphere center and cannot measure lid clearance.
let sphereManifest = null;
for (const filename of ["manifest.json", "asset-manifest.json"]) {
  const manifestPath = path.join(path.dirname(assetPath), filename);
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    const centers = manifest.eyeCenters;
    if (
      !Array.isArray(centers) ||
      centers.length !== 2 ||
      !centers.every(
        (center) =>
          Array.isArray(center) &&
          center.length === 3 &&
          center.every(Number.isFinite),
      ) ||
      !Number.isFinite(manifest.eyeRadius) ||
      manifest.eyeRadius <= 0 ||
      (manifest.outputSha256 && manifest.outputSha256 !== sourceSha256)
    )
      continue;
    sphereManifest = {
      path: manifestPath,
      centers,
      radius: manifest.eyeRadius,
    };
    break;
  } catch {
    // Frozen/isolated GLBs need not have a companion manifest; infer from the
    // intact rear hemisphere below, rather than the removed front cap.
  }
}
const gltf = await new GLTFLoader().parseAsync(geometryOnlyGlb(source), "");
gltf.scene.updateMatrixWorld(true);
const meshes = [];
gltf.scene.traverse((mesh) => {
  if (mesh.isMesh) meshes.push(mesh);
});

function expandWeights(mesh, weights) {
  const expanded = { ...weights };
  for (const target of Object.keys(mesh.morphTargetDictionary ?? {})) {
    if (!target.startsWith("Combo_")) continue;
    expanded[target] = target
      .slice("Combo_".length)
      .split("__")
      .reduce((value, part) => value * (expanded[part] ?? 0), 1);
  }
  for (const target of Object.keys(mesh.morphTargetDictionary ?? {})) {
    if (target.startsWith("Blink_Combo_"))
      expanded[target] =
        (expanded.Blink ?? 0) * (expanded[target.slice("Blink_".length)] ?? 0);
  }
  return expanded;
}

function attributesAt(mesh, name, weights) {
  const geometry = mesh.geometry;
  const base = geometry.getAttribute(name);
  if (!base) return null;
  const points = new Float64Array(base.count * 3);
  for (let i = 0; i < base.count; i++) {
    points[i * 3] = base.getX(i);
    points[i * 3 + 1] = base.getY(i);
    points[i * 3 + 2] = base.getZ(i);
  }
  for (const [targetName, value] of Object.entries(
    expandWeights(mesh, weights),
  )) {
    if (!value) continue;
    const index = mesh.morphTargetDictionary?.[targetName];
    const attribute = geometry.morphAttributes[name]?.[index];
    if (!attribute) continue;
    for (let i = 0; i < base.count; i++) {
      points[i * 3] +=
        value *
        (attribute.getX(i) -
          (geometry.morphTargetsRelative ? 0 : base.getX(i)));
      points[i * 3 + 1] +=
        value *
        (attribute.getY(i) -
          (geometry.morphTargetsRelative ? 0 : base.getY(i)));
      points[i * 3 + 2] +=
        value *
        (attribute.getZ(i) -
          (geometry.morphTargetsRelative ? 0 : base.getZ(i)));
    }
  }
  return points;
}

const positionsAt = (mesh, weights) => attributesAt(mesh, "position", weights);

function surfaceMetrics(mesh, weights = {}, inspectImportedNormals = false) {
  const points = positionsAt(mesh, weights);
  const neutralPoints = Object.keys(weights).length
    ? positionsAt(mesh, {})
    : null;
  const geometry = mesh.geometry;
  const index = geometry.index;
  const normal = attributesAt(mesh, "normal", weights);
  let degenerateTriangles = 0,
    skinnyTriangles = 0,
    minimumArea = Infinity;
  let normalOpposedTriangles = 0,
    minimumNormalCosine = 1;
  let reversedAgainstNeutral = 0,
    minimumNeutralFaceCosine = 1;
  const normalOpposedLocations = [];
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const ab = new THREE.Vector3(),
    ac = new THREE.Vector3(),
    cross = new THREE.Vector3();
  const average = new THREE.Vector3(),
    n = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const count = index?.count ?? points.length / 3;
  for (let offset = 0; offset < count; offset += 3) {
    const ia = index ? index.getX(offset) : offset;
    const ib = index ? index.getX(offset + 1) : offset + 1;
    const ic = index ? index.getX(offset + 2) : offset + 2;
    a.fromArray(points, ia * 3).applyMatrix4(mesh.matrixWorld);
    b.fromArray(points, ib * 3).applyMatrix4(mesh.matrixWorld);
    c.fromArray(points, ic * 3).applyMatrix4(mesh.matrixWorld);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    cross.crossVectors(ab, ac);
    const twiceArea = cross.length();
    minimumArea = Math.min(minimumArea, twiceArea / 2);
    if (twiceArea < 2e-12) {
      degenerateTriangles++;
      continue;
    }
    const longestSquared = Math.max(
      ab.lengthSq(),
      ac.lengthSq(),
      b.distanceToSquared(c),
    );
    if (twiceArea / longestSquared < 0.01) skinnyTriangles++;
    if (neutralPoints) {
      const na = new THREE.Vector3()
        .fromArray(neutralPoints, ia * 3)
        .applyMatrix4(mesh.matrixWorld);
      const nb = new THREE.Vector3()
        .fromArray(neutralPoints, ib * 3)
        .applyMatrix4(mesh.matrixWorld);
      const nc = new THREE.Vector3()
        .fromArray(neutralPoints, ic * 3)
        .applyMatrix4(mesh.matrixWorld);
      const baseline = nb.sub(na).cross(nc.sub(na));
      if (baseline.lengthSq() > 1e-24) {
        const cosine = cross.clone().normalize().dot(baseline.normalize());
        minimumNeutralFaceCosine = Math.min(minimumNeutralFaceCosine, cosine);
        if (cosine < -0.05) reversedAgainstNeutral++;
      }
    }
    if (inspectImportedNormals && normal) {
      average.set(0, 0, 0);
      for (const id of [ia, ib, ic])
        average.add(n.fromArray(normal, id * 3).applyMatrix3(normalMatrix));
      const cosine = cross.normalize().dot(average.normalize());
      minimumNormalCosine = Math.min(minimumNormalCosine, cosine);
      if (cosine < -0.05) {
        normalOpposedTriangles++;
        if (normalOpposedLocations.length < 24)
          normalOpposedLocations.push({
            triangle: offset / 3,
            centroid: a
              .clone()
              .add(b)
              .add(c)
              .multiplyScalar(1 / 3)
              .toArray(),
            cosine,
          });
      }
    }
  }
  return {
    vertices: points.length / 3,
    triangles: count / 3,
    allCoordinatesFinite: points.every(Number.isFinite),
    allNormalsFinite: normal?.every(Number.isFinite) ?? false,
    degenerateTriangles,
    skinnyTriangles,
    minimumArea,
    ...(neutralPoints
      ? { reversedAgainstNeutral, minimumNeutralFaceCosine }
      : {}),
    ...(inspectImportedNormals
      ? { normalOpposedTriangles, minimumNormalCosine, normalOpposedLocations }
      : {}),
  };
}

const controls = [
  "headWidth",
  "headDepth",
  "cheeks",
  "jaw",
  "muzzle",
  "muzzleWidth",
  "noseBridge",
  "eyeSize",
  "eyeSpacing",
  "eyeTilt",
  "earSize",
  "earTilt",
];
const states = [
  { label: "natural-open", weights: {} },
  { label: "natural-closed", weights: { Blink: 1 } },
  { label: "round-open", weights: { Head_round: 1 } },
  {
    label: "round-closed",
    weights: { Head_round: 1, Blink: 1, Blink_Head_round: 1 },
  },
  { label: "wedge-open", weights: { Head_wedge: 1 } },
  {
    label: "wedge-closed",
    weights: { Head_wedge: 1, Blink: 1, Blink_Head_wedge: 1 },
  },
];
for (const key of controls)
  for (const end of ["low", "high"]) {
    const name = `Shape_${key}_${end}`;
    states.push({ label: `${key}-${end}-open`, weights: { [name]: 1 } });
    if (key.startsWith("eye"))
      states.push({
        label: `${key}-${end}-closed`,
        weights: { [name]: 1, Blink: 1, [`Blink_${name}`]: 1 },
      });
  }
for (const end of ["low", "high"]) {
  const weights = Object.fromEntries(
    controls.map((key) => [`Shape_${key}_${end}`, 1]),
  );
  states.push({ label: `combined-${end}-open`, weights });
  states.push({
    label: `combined-${end}-closed`,
    weights: {
      ...weights,
      Blink: 1,
      ...Object.fromEntries(
        Object.keys(weights).map((name) => [`Blink_${name}`, 1]),
      ),
    },
  });
}

const neutral = meshes.map((mesh) => ({
  mesh: mesh.name,
  ...surfaceMetrics(mesh, {}, true),
}));
const poses = states.map(({ label, weights }) => ({
  state: label,
  drivenWeights: expandWeights(meshes[0], weights),
  meshes: meshes.map((mesh) => ({
    mesh: mesh.name,
    ...surfaceMetrics(mesh, weights, true),
  })),
}));

function lidProfile(mesh, weights) {
  const points = positionsAt(mesh, weights);
  const world = [];
  for (let i = 0; i < points.length; i += 3)
    world.push(
      new THREE.Vector3().fromArray(points, i).applyMatrix4(mesh.matrixWorld),
    );
  const suffix = mesh.name.endsWith("_L") ? "_L" : "_R";
  const globe = meshes.find((object) => object.name === `Eyeball${suffix}`);
  if (!globe) return null;
  const globePoints = positionsAt(globe, weights);
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (let i = 0; i < globePoints.length; i += 3)
    box.expandByPoint(
      point.fromArray(globePoints, i).applyMatrix4(globe.matrixWorld),
    );
  const radius = sphereManifest?.radius ?? (box.max.x - box.min.x) / 2;
  const manifestCenter = sphereManifest?.centers.find((point) =>
    suffix === "_L" ? point[0] < 0 : point[0] > 0,
  );
  const center = manifestCenter
    ? new THREE.Vector3().fromArray(manifestCenter)
    : new THREE.Vector3(
        (box.min.x + box.max.x) / 2,
        (box.min.y + box.max.y) / 2,
        box.min.z + radius,
      );
  const profile = world
    .filter((vertex) => Math.abs(vertex.x - center.x) < 0.018)
    .map((vertex) => ({
      y: vertex.y,
      z: vertex.z,
      clearanceFromGlobe: vertex.distanceTo(center) - radius,
    }))
    .sort((a, b) => a.y - b.y || a.z - b.z);
  const index = mesh.geometry.index;
  let projectedArea = 0;
  const triangleCount = (index?.count ?? world.length) / 3;
  for (let i = 0; i < triangleCount; i++) {
    const [a, b, c] = [0, 1, 2].map(
      (offset) => world[index ? index.getX(i * 3 + offset) : i * 3 + offset],
    );
    projectedArea +=
      Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
  }
  return {
    mesh: mesh.name,
    center: center.toArray(),
    radius,
    sphereSource: manifestCenter
      ? {
          kind: "companion-manifest",
          path: sphereManifest.path,
          fields: "eyeCenters / eyeRadius (authored world coordinates)",
        }
      : {
          kind: "inferred-retained-rear-sphere",
          method:
            "radius=(maxX-minX)/2; centerXY=XY bounding midpoint; centerZ=minZ+radius; assumes the authored unscaled, axis-aligned rear sphere is intact",
        },
    projectedArea,
    projectedAreaOverGlobeDisc: projectedArea / (Math.PI * radius ** 2),
    midlineSamples: profile,
  };
}

const lidProfiles = [
  { state: "natural-open", weights: {} },
  { state: "natural-closed", weights: { Blink: 1 } },
].map(({ state, weights }) => ({
  state,
  meshes: meshes
    .filter((mesh) => mesh.name.startsWith("Lid_"))
    .map((mesh) => lidProfile(mesh, weights)),
}));
const report = {
  asset: assetPath,
  bytes: source.byteLength,
  sha256: sourceSha256,
  scope:
    "Actual source GLB vertex/index/normal arrays. Natural-open/closed lid clearance uses the true sphere center/radius from the companion manifest, or an explicitly marked inference from the intact rear sphere; the capped-globe Z bounding midpoint is never treated as its center. No texture sampling, visual-quality claim or guarantee of all intermediate parameter combinations.",
  neutral,
  poses,
  lidProfiles,
};
await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      report: reportPath,
      meshes: meshes.length,
      testedPoses: poses.length,
      neutralNormalOpposed: neutral
        .filter((item) => item.normalOpposedTriangles)
        .map(({ mesh, normalOpposedTriangles, minimumNormalCosine }) => ({
          mesh,
          normalOpposedTriangles,
          minimumNormalCosine,
        })),
      degeneratePoses: poses.flatMap((pose) =>
        pose.meshes
          .filter(
            (mesh) => mesh.degenerateTriangles || !mesh.allCoordinatesFinite,
          )
          .map((mesh) => ({
            state: pose.state,
            mesh: mesh.mesh,
            degenerateTriangles: mesh.degenerateTriangles,
            finite: mesh.allCoordinatesFinite,
          })),
      ),
      orientationWarnings: poses.flatMap((pose) =>
        pose.meshes
          .filter((mesh) => mesh.reversedAgainstNeutral > 0)
          .map((mesh) => ({
            state: pose.state,
            mesh: mesh.mesh,
            reversedAgainstNeutral: mesh.reversedAgainstNeutral,
            minimumNeutralFaceCosine: mesh.minimumNeutralFaceCosine,
          })),
      ),
    },
    null,
    2,
  ),
);
