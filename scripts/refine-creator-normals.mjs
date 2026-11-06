/** Isolated normal-corrective experiment. Never overwrites its input asset.
 * node scripts/refine-creator-normals.mjs input.glb output.glb report.json
 * Preserves all POSITION/index/UV/material/image accessors; only rewrites Skin
 * target NORMALs and appends explicit zero-POSITION normal-corrective targets.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const inputPath = process.argv[2] ?? "public/models/creator/structural-cat.glb";
const outputPath = process.argv[3];
const reportPath = process.argv[4] ?? (outputPath ? `${outputPath}.json` : "");
if (!outputPath || path.resolve(inputPath) === path.resolve(outputPath))
  throw new Error(
    "Specify a distinct output GLB; this experiment cannot overwrite its input.",
  );

function unpack(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error("Expected a GLB");
  if (bytes.length < 28 || bytes.readUInt32LE(8) !== bytes.length)
    throw new Error("GLB is incomplete or still being exported; re-read the same file after the exporter finishes");
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const binOffset = 20 + jsonLength;
  if (bytes.readUInt32LE(binOffset + 4) !== 0x004e4942)
    throw new Error("Expected BIN chunk");
  return {
    json,
    bin: bytes.subarray(
      binOffset + 8,
      binOffset + 8 + bytes.readUInt32LE(binOffset),
    ),
  };
}
function pack(json, bin) {
  const text = Buffer.from(JSON.stringify(json));
  const encoded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20);
  text.copy(encoded);
  const padded = Buffer.alloc(Math.ceil(bin.length / 4) * 4);
  bin.copy(padded);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + encoded.length + padded.length, 8);
  header.writeUInt32LE(encoded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(padded.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, encoded, binHeader, padded]);
}
function withoutImages(json) {
  const result = JSON.parse(JSON.stringify(json));
  for (const material of result.materials ?? []) {
    for (const object of [
      material,
      material.pbrMetallicRoughness,
      ...Object.values(material.extensions ?? {}),
    ]) {
      if (!object) continue;
      for (const key of Object.keys(object))
        if (key.endsWith("Texture")) delete object[key];
    }
  }
  delete result.images;
  delete result.textures;
  delete result.samplers;
  return result;
}
async function loadGeometry(json, bin) {
  const buffer = pack(withoutImages(json), bin);
  return new GLTFLoader().parseAsync(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ),
    "",
  );
}
const source = await fs.readFile(inputPath);
const sourceHash = createHash("sha256").update(source).digest("hex");
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(
  path.join(path.dirname(outputPath), `input-${sourceHash.slice(0, 12)}.glb`),
  source,
);
const { json, bin } = unpack(source);
const materialsBefore = JSON.stringify(json.materials ?? []);
const imageHashesBefore = (json.images ?? []).map((image) => {
  if (image.bufferView === undefined) return image.uri;
  const view = json.bufferViews[image.bufferView];
  return createHash("sha256")
    .update(
      bin.subarray(
        view.byteOffset ?? 0,
        (view.byteOffset ?? 0) + view.byteLength,
      ),
    )
    .digest("hex");
});
const gltf = await loadGeometry(json, bin);
gltf.scene.updateMatrixWorld(true);
const mesh = gltf.scene.getObjectByName("Skin_Head");
if (!mesh?.isMesh) throw new Error("No Skin_Head mesh");
const association = gltf.parser.associations.get(mesh);
if (!Number.isInteger(association?.meshes))
  throw new Error("Missing glTF mesh association");
const meshDefinition = json.meshes[association.meshes];
if (meshDefinition.primitives.length !== 1)
  throw new Error("This experiment expects one Skin primitive");
const primitive = meshDefinition.primitives[0];
const geometry = mesh.geometry;
const position = geometry.getAttribute("position"),
  normal = geometry.getAttribute("normal");
const count = position.count;
const readAttribute = (attribute) => {
  const array = new Float64Array(attribute.count * 3);
  for (let i = 0; i < attribute.count; i++) {
    array[i * 3] = attribute.getX(i);
    array[i * 3 + 1] = attribute.getY(i);
    array[i * 3 + 2] = attribute.getZ(i);
  }
  return array;
};
const base = readAttribute(position),
  importedNormals = readAttribute(normal);
const dictionary = { ...mesh.morphTargetDictionary };
const names = Object.keys(dictionary).sort(
  (a, b) => dictionary[a] - dictionary[b],
);
const fields = Object.fromEntries(
  names.map((name) => [
    name,
    readAttribute(geometry.morphAttributes.position[dictionary[name]]),
  ]),
);
const oldNormals = Object.fromEntries(
  names.map((name) => [
    name,
    readAttribute(geometry.morphAttributes.normal[dictionary[name]]),
  ]),
);
const indices = geometry.index
  ? Array.from(geometry.index.array)
  : Array.from({ length: count }, (_, i) => i);
const representatives = new Uint32Array(count),
  positionMap = new Map();
for (let i = 0; i < count; i++) {
  const key = [0, 1, 2]
    .map((axis) => Math.round(base[i * 3 + axis] * 1e7))
    .join(",");
  if (!positionMap.has(key)) positionMap.set(key, i);
  representatives[i] = positionMap.get(key);
}

const newCombo = "Combo_Shape_headWidth_low__Shape_earTilt_low";
const combos = [...names.filter((name) => name.startsWith("Combo_"))];
if (!combos.includes(newCombo)) combos.push(newCombo);
const terms = (name) => name.slice("Combo_".length).split("__");
const cageEnabled = process.argv[5] === "cage";
if (cageEnabled) {
  // Four independently blended ear-affecting edits need normal inclusion-
  // exclusion even when their position fields are additive. This complete low
  // corner cage is an experiment, not a change to appearance controls.
  const cage = [
    "Shape_headWidth_low",
    "Shape_headDepth_low",
    "Shape_earSize_low",
    "Shape_earTilt_low",
  ];
  for (let mask = 1; mask < 1 << cage.length; mask++) {
    const selected = cage.filter((_, index) => mask & (1 << index));
    if (selected.length < 2) continue;
    const name = `Combo_${selected.join("__")}`;
    if (!combos.includes(name)) combos.push(name);
  }
}
combos.sort((a, b) => terms(a).length - terms(b).length);
const properSubsets = (name) => {
  const members = terms(name);
  return combos.filter(
    (candidate) =>
      terms(candidate).length < members.length &&
      terms(candidate).every((part) => members.includes(part)),
  );
};
function driven(weights) {
  const result = { ...weights };
  for (const name of combos)
    result[name] = terms(name).reduce(
      (value, part) => value * (result[part] ?? 0),
      1,
    );
  for (const name of combos)
    result[`Blink_${name}`] = (result.Blink ?? 0) * result[name];
  return result;
}
function positions(weights, expand = true) {
  const result = Float64Array.from(base);
  for (const [name, value] of Object.entries(
    expand ? driven(weights) : weights,
  )) {
    if (!value || !fields[name]) continue;
    for (let i = 0; i < result.length; i++)
      result[i] += value * fields[name][i];
  }
  return result;
}
function weldedNormals(points) {
  const accumulated = new Float64Array(points.length);
  for (let offset = 0; offset < indices.length; offset += 3) {
    const ia = indices[offset],
      ib = indices[offset + 1],
      ic = indices[offset + 2];
    const a = ia * 3,
      b = ib * 3,
      c = ic * 3;
    const ax = points[b] - points[a],
      ay = points[b + 1] - points[a + 1],
      az = points[b + 2] - points[a + 2];
    const bx = points[c] - points[a],
      by = points[c + 1] - points[a + 1],
      bz = points[c + 2] - points[a + 2];
    const nx = ay * bz - az * by,
      ny = az * bx - ax * bz,
      nz = ax * by - ay * bx;
    for (const id of [ia, ib, ic]) {
      const at = representatives[id] * 3;
      accumulated[at] += nx;
      accumulated[at + 1] += ny;
      accumulated[at + 2] += nz;
    }
  }
  const result = new Float64Array(points.length);
  for (let i = 0; i < count; i++) {
    const at = representatives[i] * 3;
    const length = Math.hypot(
      accumulated[at],
      accumulated[at + 1],
      accumulated[at + 2],
    );
    for (let axis = 0; axis < 3; axis++)
      result[i * 3 + axis] =
        length > 1e-15
          ? accumulated[at + axis] / length
          : importedNormals[i * 3 + axis];
  }
  return result;
}
const neutralComputed = weldedNormals(base);
const reference = new THREE.Vector3(),
  deformed = new THREE.Vector3(),
  sourceNormal = new THREE.Vector3(),
  rotation = new THREE.Quaternion();
function goalNormals(weights, expand = true) {
  const computed = weldedNormals(positions(weights, expand));
  const result = new Float64Array(computed.length);
  for (let i = 0; i < count; i++) {
    reference.fromArray(neutralComputed, i * 3);
    deformed.fromArray(computed, i * 3);
    sourceNormal.fromArray(importedNormals, i * 3);
    rotation.setFromUnitVectors(reference, deformed);
    sourceNormal
      .applyQuaternion(rotation)
      .normalize()
      .toArray(result, i * 3);
  }
  return result;
}
const subtract = (a, b) => Float64Array.from(a, (value, i) => value - b[i]);
const normals = {};
const mainNames = names.filter(
  (name) =>
    name !== "Blink" &&
    !name.startsWith("Blink_") &&
    !name.startsWith("Combo_"),
);
for (const name of mainNames)
  normals[name] = subtract(goalNormals({ [name]: 1 }), importedNormals);
normals.Blink = subtract(goalNormals({ Blink: 1 }), importedNormals);
for (const name of combos) {
  const members = terms(name);
  const joint = goalNormals(
    Object.fromEntries(members.map((part) => [part, 1])),
  );
  const delta = subtract(joint, importedNormals);
  for (const part of members)
    for (let i = 0; i < delta.length; i++) delta[i] -= normals[part][i];
  for (const subset of properSubsets(name))
    for (let i = 0; i < delta.length; i++) delta[i] -= normals[subset][i];
  normals[name] = delta;
}
for (const name of mainNames) {
  const delta = subtract(goalNormals({ [name]: 1, Blink: 1 }), importedNormals);
  for (let i = 0; i < delta.length; i++)
    delta[i] -= normals[name][i] + normals.Blink[i];
  normals[`Blink_${name}`] = delta;
}
for (const name of combos) {
  const members = terms(name);
  const joint = goalNormals({
    ...Object.fromEntries(members.map((part) => [part, 1])),
    Blink: 1,
  });
  const delta = subtract(joint, importedNormals);
  for (let i = 0; i < delta.length; i++) {
    delta[i] -= normals.Blink[i] + normals[name][i];
    for (const part of members)
      delta[i] -= normals[part][i] + normals[`Blink_${part}`][i];
    for (const subset of properSubsets(name))
      delta[i] -= normals[subset][i] + normals[`Blink_${subset}`][i];
  }
  normals[`Blink_${name}`] = delta;
}

const rms = (a, b) =>
  Math.sqrt(
    a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0) / a.length,
  );
const semantics = combos
  .filter((name) => oldNormals[name])
  .map((name) => ({
    name,
    originalVsShapeOnlyComputedRms: rms(
      oldNormals[name],
      subtract(goalNormals({ [name]: 1 }, false), importedNormals),
    ),
    originalVsCorrectJointRms: rms(oldNormals[name], normals[name]),
  }));
function shaderNormals(weights, targets) {
  const result = Float64Array.from(importedNormals);
  for (const [name, value] of Object.entries(driven(weights))) {
    if (!value || !targets[name]) continue;
    for (let i = 0; i < result.length; i++)
      result[i] += value * targets[name][i];
  }
  return result;
}
function opposed(points, shading) {
  let auditCount = 0,
    normalizedVertexCount = 0;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const ids = [indices[offset], indices[offset + 1], indices[offset + 2]];
    const [a, b, c] = ids.map((id) => id * 3);
    const ax = points[b] - points[a],
      ay = points[b + 1] - points[a + 1],
      az = points[b + 2] - points[a + 2];
    const bx = points[c] - points[a],
      by = points[c + 1] - points[a + 1],
      bz = points[c + 2] - points[a + 2];
    const face = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
    const normal = [0, 0, 0],
      normalized = [0, 0, 0];
    for (const id of ids) {
      const at = id * 3,
        length = Math.hypot(shading[at], shading[at + 1], shading[at + 2]);
      for (let axis = 0; axis < 3; axis++) {
        normal[axis] += shading[at + axis];
        normalized[axis] += shading[at + axis] / Math.max(length, 1e-15);
      }
    }
    const cosine = (n) =>
      (face[0] * n[0] + face[1] * n[1] + face[2] * n[2]) /
      Math.max(1e-25, Math.hypot(...face) * Math.hypot(...n));
    if (cosine(normal) < -0.05) auditCount++;
    if (cosine(normalized) < -0.05) normalizedVertexCount++;
  }
  return { auditCount, normalizedVertexCount };
}
const shapeKeys = [
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
const cases = [
  { name: "neutral", weights: {} },
  {
    name: "headWidth-low-earTilt-low",
    weights: { Shape_headWidth_low: 1, Shape_earTilt_low: 1 },
  },
  {
    name: "all-low",
    weights: Object.fromEntries(
      shapeKeys.map((key) => [`Shape_${key}_low`, 1]),
    ),
  },
  {
    name: "all-high",
    weights: Object.fromEntries(
      shapeKeys.map((key) => [`Shape_${key}_high`, 1]),
    ),
  },
];
for (const a of ["low", "high"])
  for (const b of ["low", "high"])
    cases.push({
      name: `earSize-${a}-earTilt-${b}`,
      weights: { [`Shape_earSize_${a}`]: 1, [`Shape_earTilt_${b}`]: 1 },
    });
const measurements = cases.map(({ name, weights }) => ({
  pose: name,
  original: opposed(positions(weights), shaderNormals(weights, oldNormals)),
  corrected: opposed(positions(weights), shaderNormals(weights, normals)),
  freshlyRecomputedGoal: opposed(positions(weights), goalNormals(weights)),
}));

const append = [];
let offset = bin.length;
json.bufferViews ??= [];
json.accessors ??= [];
let zeroPositionAccessor = null;
function appendView(bytes) {
  const padding = (4 - (offset % 4)) % 4;
  if (padding) {
    append.push(Buffer.alloc(padding));
    offset += padding;
  }
  const view = json.bufferViews.length;
  json.bufferViews.push({
    buffer: 0,
    byteOffset: offset,
    byteLength: bytes.length,
  });
  offset += bytes.length;
  append.push(bytes);
  return view;
}
function accessor(array, positionAttribute = false) {
  const active = [];
  for (let i = 0; i < count; i++)
    if ([0, 1, 2].some((axis) => Math.abs(array[i * 3 + axis]) >= 1e-7))
      active.push(i);
  if (!active.length) {
    if (zeroPositionAccessor === null) {
      zeroPositionAccessor = json.accessors.length;
      json.accessors.push({
        componentType: 5126,
        count,
        type: "VEC3",
        min: [0, 0, 0],
        max: [0, 0, 0],
      });
    }
    return zeroPositionAccessor;
  }
  const typed = Float32Array.from(array);
  const index = json.accessors.length;
  const definition = {
    componentType: 5126,
    count,
    type: "VEC3",
  };
  if (active.length < count * 0.75) {
    const indices =
      count <= 65535 ? Uint16Array.from(active) : Uint32Array.from(active);
    const values = Float32Array.from(
      active.flatMap((id) => [
        typed[id * 3],
        typed[id * 3 + 1],
        typed[id * 3 + 2],
      ]),
    );
    definition.sparse = {
      count: active.length,
      indices: {
        bufferView: appendView(Buffer.from(indices.buffer)),
        componentType: count <= 65535 ? 5123 : 5125,
      },
      values: { bufferView: appendView(Buffer.from(values.buffer)) },
    };
  } else definition.bufferView = appendView(Buffer.from(typed.buffer));
  if (positionAttribute) {
    definition.min = [0, 1, 2].map((axis) =>
      Math.min(...typed.filter((_, i) => i % 3 === axis)),
    );
    definition.max = [0, 1, 2].map((axis) =>
      Math.max(...typed.filter((_, i) => i % 3 === axis)),
    );
  }
  json.accessors.push(definition);
  return index;
}
meshDefinition.extras ??= {};
meshDefinition.extras.targetNames = [...names];
for (const [name, normalDelta] of Object.entries(normals)) {
  let index = names.indexOf(name);
  if (index < 0) {
    index = names.length;
    names.push(name);
    meshDefinition.extras.targetNames.push(name);
    // Explicit zero POSITION avoids the installed GLTFLoader's base-POSITION
    // fallback when any other target in this primitive has POSITION data.
    primitive.targets.push({
      POSITION: accessor(new Float32Array(base.length), true),
    });
  }
  primitive.targets[index].NORMAL = accessor(normalDelta);
}
meshDefinition.weights = Array(names.length).fill(0);
for (const node of json.nodes ?? [])
  if (node.mesh === association.meshes && node.weights)
    node.weights = Array(names.length).fill(0);
let updatedBin = Buffer.concat([bin, ...append]);
json.buffers[0].byteLength = updatedBin.length;
function compactBuffers() {
  if (
    (json.extensionsUsed ?? []).some((name) =>
      /meshopt|draco|structural_metadata/i.test(name),
    )
  )
    throw new Error(
      "Compaction needs explicit handling for this geometry compression/metadata extension",
    );
  const used = new Set();
  for (const mesh of json.meshes ?? [])
    for (const primitive of mesh.primitives) {
      if (primitive.indices !== undefined) used.add(primitive.indices);
      Object.values(primitive.attributes).forEach((index) => used.add(index));
      for (const target of primitive.targets ?? [])
        Object.values(target).forEach((index) => used.add(index));
    }
  for (const skin of json.skins ?? [])
    if (skin.inverseBindMatrices !== undefined)
      used.add(skin.inverseBindMatrices);
  for (const animation of json.animations ?? [])
    for (const sampler of animation.samplers) {
      used.add(sampler.input);
      used.add(sampler.output);
    }
  for (const node of json.nodes ?? [])
    Object.values(
      node.extensions?.EXT_mesh_gpu_instancing?.attributes ?? {},
    ).forEach((index) => used.add(index));
  const ordered = [...used].sort((a, b) => a - b);
  const mapping = new Map(ordered.map((old, index) => [old, index]));
  for (const mesh of json.meshes ?? [])
    for (const primitive of mesh.primitives) {
      if (primitive.indices !== undefined)
        primitive.indices = mapping.get(primitive.indices);
      for (const key of Object.keys(primitive.attributes))
        primitive.attributes[key] = mapping.get(primitive.attributes[key]);
      for (const target of primitive.targets ?? [])
        for (const key of Object.keys(target))
          target[key] = mapping.get(target[key]);
    }
  for (const skin of json.skins ?? [])
    if (skin.inverseBindMatrices !== undefined)
      skin.inverseBindMatrices = mapping.get(skin.inverseBindMatrices);
  for (const animation of json.animations ?? [])
    for (const sampler of animation.samplers) {
      sampler.input = mapping.get(sampler.input);
      sampler.output = mapping.get(sampler.output);
    }
  for (const node of json.nodes ?? []) {
    const attributes =
      node.extensions?.EXT_mesh_gpu_instancing?.attributes ?? {};
    for (const key of Object.keys(attributes))
      attributes[key] = mapping.get(attributes[key]);
  }
  json.accessors = ordered.map((index) => json.accessors[index]);
  const views = new Set();
  for (const accessor of json.accessors) {
    if (accessor.bufferView !== undefined) views.add(accessor.bufferView);
    if (accessor.sparse) {
      views.add(accessor.sparse.indices.bufferView);
      views.add(accessor.sparse.values.bufferView);
    }
  }
  for (const image of json.images ?? [])
    if (image.bufferView !== undefined) views.add(image.bufferView);
  const order = [...views].sort((a, b) => a - b),
    viewMap = new Map(order.map((old, index) => [old, index]));
  const packed = [];
  let offset = 0;
  const nextViews = order.map((index) => {
    const original = json.bufferViews[index];
    const padding = (4 - (offset % 4)) % 4;
    if (padding) {
      packed.push(Buffer.alloc(padding));
      offset += padding;
    }
    const view = { ...original, buffer: 0, byteOffset: offset };
    packed.push(
      updatedBin.subarray(
        original.byteOffset ?? 0,
        (original.byteOffset ?? 0) + original.byteLength,
      ),
    );
    offset += original.byteLength;
    return view;
  });
  for (const accessor of json.accessors) {
    if (accessor.bufferView !== undefined)
      accessor.bufferView = viewMap.get(accessor.bufferView);
    if (accessor.sparse) {
      accessor.sparse.indices.bufferView = viewMap.get(
        accessor.sparse.indices.bufferView,
      );
      accessor.sparse.values.bufferView = viewMap.get(
        accessor.sparse.values.bufferView,
      );
    }
  }
  for (const image of json.images ?? [])
    if (image.bufferView !== undefined)
      image.bufferView = viewMap.get(image.bufferView);
  json.bufferViews = nextViews;
  updatedBin = Buffer.concat(packed);
  json.buffers[0].byteLength = updatedBin.length;
}
compactBuffers();
const output = pack(json, updatedBin);
await fs.writeFile(outputPath, output);

const verified = await loadGeometry(json, updatedBin);
const verifiedMesh = verified.scene.getObjectByName("Skin_Head");
let maximumPositionDifference = 0,
  newComboMaximumPosition = 0;
for (const name of Object.keys(dictionary)) {
  const before = fields[name];
  const after = readAttribute(
    verifiedMesh.geometry.morphAttributes.position[
      verifiedMesh.morphTargetDictionary[name]
    ],
  );
  for (let i = 0; i < before.length; i++)
    maximumPositionDifference = Math.max(
      maximumPositionDifference,
      Math.abs(before[i] - after[i]),
    );
}
for (const name of names.filter((name) => dictionary[name] === undefined)) {
  const after = readAttribute(
    verifiedMesh.geometry.morphAttributes.position[
      verifiedMesh.morphTargetDictionary[name]
    ],
  );
  for (const value of after)
    newComboMaximumPosition = Math.max(
      newComboMaximumPosition,
      Math.abs(value),
    );
}
const afterBase = readAttribute(verifiedMesh.geometry.getAttribute("position"));
for (let i = 0; i < base.length; i++)
  maximumPositionDifference = Math.max(
    maximumPositionDifference,
    Math.abs(base[i] - afterBase[i]),
  );
let verifiedPositionMeshes = 0;
gltf.scene.traverse((originalMesh) => {
  if (!originalMesh.isMesh) return;
  const next = verified.scene.getObjectByName(originalMesh.name);
  if (!next?.isMesh)
    throw new Error(`Output lost source mesh ${originalMesh.name}`);
  const pairs = [
    [
      originalMesh.geometry.getAttribute("position"),
      next.geometry.getAttribute("position"),
    ],
  ];
  for (const [name, index] of Object.entries(
    originalMesh.morphTargetDictionary ?? {},
  )) {
    const first = originalMesh.geometry.morphAttributes.position?.[index];
    const second =
      next.geometry.morphAttributes.position?.[
        next.morphTargetDictionary[name]
      ];
    if (first || second) pairs.push([first, second]);
  }
  for (const [first, second] of pairs) {
    if (!first || !second || first.count !== second.count)
      throw new Error(
        `Output changed source position layout for ${originalMesh.name}`,
      );
    for (let i = 0; i < first.count; i++)
      maximumPositionDifference = Math.max(
        maximumPositionDifference,
        Math.abs(first.getX(i) - second.getX(i)),
        Math.abs(first.getY(i) - second.getY(i)),
        Math.abs(first.getZ(i) - second.getZ(i)),
      );
  }
  verifiedPositionMeshes++;
});
const imageHashesAfter = (json.images ?? []).map((image) => {
  if (image.bufferView === undefined) return image.uri;
  const view = json.bufferViews[image.bufferView];
  return createHash("sha256")
    .update(
      updatedBin.subarray(
        view.byteOffset ?? 0,
        (view.byteOffset ?? 0) + view.byteLength,
      ),
    )
    .digest("hex");
});
const report = {
  input: inputPath,
  sourceSha256: sourceHash,
  output: outputPath,
  outputSha256: createHash("sha256").update(output).digest("hex"),
  inputBytes: source.length,
  outputBytes: output.length,
  scope:
    "Isolated Skin_Head normal-only experiment; all source positions/material/image buffers preserved. Normal smoothing welds identical rest positions and parallel-transports imported neutral normals to retain neutral appearance.",
  processedMesh: mesh.name,
  normalCageEnabled: cageEnabled,
  sourceTargetCount: Object.keys(dictionary).length,
  outputTargetCount: names.length,
  weldedDuplicateVertices: count - positionMap.size,
  semantics,
  measurements,
  verification: {
    maximumPositionDifference,
    verifiedPositionMeshes,
    newComboMaximumPosition,
    importedNeutralNormalChanged: false,
    targetArrayLengthsMatch:
      primitive.targets.length === meshDefinition.extras.targetNames.length &&
      meshDefinition.weights.length === primitive.targets.length &&
      (json.nodes ?? [])
        .filter((node) => node.mesh === association.meshes && node.weights)
        .every((node) => node.weights.length === primitive.targets.length),
    imageHashesBefore,
    imageHashesAfter,
    originalMaterialsAndImagesRetained:
      materialsBefore === JSON.stringify(json.materials ?? []) &&
      JSON.stringify(imageHashesBefore) === JSON.stringify(imageHashesAfter),
  },
};
await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
