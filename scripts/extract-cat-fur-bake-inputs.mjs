import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadArchivedGroom } from "./cat-groom-audit-runtime.mjs";

const directory = "artifacts/fur-volume/bake-inputs";
const bundle = "artifacts/fur-filter/volume-round02/model-probe.js";
await fs.mkdir(directory, { recursive: true });
const runtime = await loadArchivedGroom(bundle, {
  transformBundle(source) {
    const needle =
      "    return {\n      meshes: regions.flatMap((region) => [region.mesh, region.finMesh]),";
    if (!source.includes(needle))
      throw Error("Archived volume return not found");
    return source.replace(
      needle,
      "    globalThis.__bakeVolumeState = {regions,input};\n" + needle,
    );
  },
});
const { api, model, fur, state } = runtime;
model.motion.setBreathing(false);
model.motion.setIdleBlink(false);
model.motion.setPose("stand", true);
model.motion.update(0, { reducedMotion: true });
const design = {
  ...api.defaultCreatorDesign,
  coatType: "long",
  shape: {
    ...api.defaultCreatorDesign.shape,
    ...api.getCatCoatProfile("long").defaults,
    headFurDensity: 100,
    ruffFurDensity: 100,
    bodyFurDensity: 100,
  },
};
api.applyCreatorDesign(model, design);
fur.setVolume(true);
fur.setDetail(1);
fur.refresh({ full: true });
const volume = globalThis.__bakeVolumeState.regions.find(
  (region) => region.name === "body",
);
const uv = volume.uv,
  P = volume.posedPositions,
  index = volume.indices,
  mask = volume.weights;

function auditUV(resolution) {
  const n = resolution * resolution;
  const owner = new Int32Array(n).fill(-1),
    activeOwner = new Int32Array(n).fill(-1);
  const xyz = new Float64Array(n * 3),
    activeXYZ = new Float64Array(n * 3);
  const overlap = new Uint8Array(n),
    activeOverlap = new Uint8Array(n);
  let covered = 0,
    activeCovered = 0,
    overlapPairs = 0,
    maxDistance = 0;
  let degenerateTriangles = 0,
    negativeSignedAreaTriangles = 0,
    positiveSignedAreaTriangles = 0;
  const examples = [];
  for (let face = 0; face < index.length / 3; face++) {
    const [a, b, c] = index.subarray(face * 3, face * 3 + 3);
    const ax = uv[a * 2],
      ay = uv[a * 2 + 1],
      bx = uv[b * 2],
      by = uv[b * 2 + 1],
      cx = uv[c * 2],
      cy = uv[c * 2 + 1];
    const determinant = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(determinant) < 1e-14) {
      degenerateTriangles++;
      continue;
    }
    if (determinant < 0) negativeSignedAreaTriangles++;
    else positiveSignedAreaTriangles++;
    const x0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) * resolution - 0.5));
    const x1 = Math.min(
      resolution - 1,
      Math.floor(Math.max(ax, bx, cx) * resolution - 0.5),
    );
    const y0 = Math.max(0, Math.ceil(Math.min(ay, by, cy) * resolution - 0.5));
    const y1 = Math.min(
      resolution - 1,
      Math.floor(Math.max(ay, by, cy) * resolution - 0.5),
    );
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const u = (x + 0.5) / resolution,
          v = (y + 0.5) / resolution;
        const wa = ((by - cy) * (u - cx) + (cx - bx) * (v - cy)) / determinant;
        const wb = ((cy - ay) * (u - cx) + (ax - cx) * (v - cy)) / determinant;
        const wc = 1 - wa - wb;
        if (Math.min(wa, wb, wc) < -1e-10) continue;
        const p = [0, 1, 2].map(
          (k) => P[a * 3 + k] * wa + P[b * 3 + k] * wb + P[c * 3 + k] * wc,
        );
        const pixel = y * resolution + x,
          offset = pixel * 3;
        if (owner[pixel] < 0) {
          owner[pixel] = face;
          xyz.set(p, offset);
          covered++;
        } else {
          const distance = Math.hypot(
            ...p.map((value, k) => value - xyz[offset + k]),
          );
          maxDistance = Math.max(maxDistance, distance);
          if (distance > 1e-5) {
            overlap[pixel] = 1;
            overlapPairs++;
            if (examples.length < 8)
              examples.push({ x, y, faces: [owner[pixel], face], distance });
          }
        }
        if (mask[a] * wa + mask[b] * wb + mask[c] * wc > 1e-5) {
          if (activeOwner[pixel] < 0) {
            activeOwner[pixel] = face;
            activeXYZ.set(p, offset);
            activeCovered++;
          } else if (
            Math.hypot(...p.map((value, k) => value - activeXYZ[offset + k])) >
            1e-5
          )
            activeOverlap[pixel] = 1;
        }
      }
  }
  const overlapPixels = overlap.reduce((a, b) => a + b, 0),
    activeOverlapPixels = activeOverlap.reduce((a, b) => a + b, 0);
  return {
    resolution,
    coveredPixels: covered,
    coverageFraction: covered / n,
    overlapPixels,
    overlapCoveredFraction: overlapPixels / Math.max(1, covered),
    overlapPairs,
    maxSkinDistance: maxDistance,
    activeCoveredPixels: activeCovered,
    activeOverlapPixels,
    activeOverlapCoveredFraction:
      activeOverlapPixels / Math.max(1, activeCovered),
    degenerateTriangles,
    negativeSignedAreaTriangles,
    positiveSignedAreaTriangles,
    examples,
    criterion:
      "Pixel-centre barycentric P distance >1e-5 scene units. Shared-edge duplicate hits with the same skin P are not overlap; active requires interpolated mask>1e-5.",
  };
}
const initialAudit = {
  capturedAt: new Date().toISOString(),
  bundle,
  bundleSHA: runtime.bundleSha256,
  assetSHA: runtime.glbSha256,
  vertices: P.length / 3,
  triangles: index.length / 3,
  uvRange: {
    u: [
      Math.min(...uv.filter((_, i) => i % 2 === 0)),
      Math.max(...uv.filter((_, i) => i % 2 === 0)),
    ],
    v: [
      Math.min(...uv.filter((_, i) => i % 2 === 1)),
      Math.max(...uv.filter((_, i) => i % 2 === 1)),
    ],
  },
  verticesOutsideUnitUV: Array.from(
    { length: uv.length / 2 },
    (_, i) => i,
  ).filter(
    (i) =>
      uv[i * 2] < 0 || uv[i * 2] > 1 || uv[i * 2 + 1] < 0 || uv[i * 2 + 1] > 1,
  ).length,
  orientationNote:
    "All 4464 triangles have the same negative signed UV area. This is a consistent UV orientation convention, not evidence of a localized inverted/folded chart.",
  limitation:
    "Pixel-centre sampling at the reported resolutions does not prove absence of every subpixel continuous UV overlap.",
  results: [128, 256, 512].map(auditUV),
};
await fs.writeFile(
  `${directory}/uv-audit.json`,
  JSON.stringify(initialAudit, null, 2),
);
console.log(
  JSON.stringify({
    uvAudit: `${directory}/uv-audit.json`,
    results: initialAudit.results.map(
      ({
        resolution,
        overlapCoveredFraction,
        activeOverlapCoveredFraction,
      }) => ({
        resolution,
        overlapCoveredFraction,
        activeOverlapCoveredFraction,
      }),
    ),
  }),
);

const arrays = {};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function store(name, array, itemSize) {
  const file = `${name}.bin`,
    bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  await fs.writeFile(`${directory}/${file}`, bytes);
  arrays[name] = {
    file,
    type: array.constructor.name,
    itemSize,
    count: array.length / itemSize,
    byteLength: bytes.byteLength,
    sha256: hash(bytes),
    endianness: "little",
  };
}
const shell = volume.mesh,
  geometry = shell.geometry;
const vertices = volume.vertices.length,
  layers = volume.layers;
if (layers !== 16) throw Error(`Expected 16 volume layers, got ${layers}`);
const layerSamples = [0, 8, 15],
  h = layerSamples.map((layer) => (layer + 0.5) / layers);
const coefficients64 = [
  new Float64Array(vertices * 3),
  new Float64Array(vertices * 3),
  new Float64Array(vertices * 3),
];
for (let vertex = 0; vertex < vertices; vertex++)
  for (let axis = 0; axis < 3; axis++) {
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3,
        k = (i + 2) % 3;
      const denominator = (h[i] - h[j]) * (h[i] - h[k]);
      const value = geometry.attributes.position.getComponent(
        layerSamples[i] * vertices + vertex,
        axis,
      );
      coefficients64[0][vertex * 3 + axis] +=
        (value * h[j] * h[k]) / denominator;
      coefficients64[1][vertex * 3 + axis] +=
        (value * (-h[j] - h[k])) / denominator;
      coefficients64[2][vertex * 3 + axis] += value / denominator;
    }
  }
const coefficients32 = coefficients64.map((a) => new Float32Array(a));
const residual = (coefficients) => {
  const values = [],
    perLayer = [];
  for (let layer = 0; layer < layers; layer++) {
    const t = (layer + 0.5) / layers;
    let max = 0;
    for (let vertex = 0; vertex < vertices; vertex++) {
      let squared = 0;
      for (let axis = 0; axis < 3; axis++) {
        const i = vertex * 3 + axis;
        const predicted =
          coefficients[0][i] +
          coefficients[1][i] * t +
          coefficients[2][i] * t * t;
        const error =
          predicted -
          geometry.attributes.position.getComponent(
            layer * vertices + vertex,
            axis,
          );
        squared += error * error;
      }
      const error = Math.sqrt(squared);
      values.push(error);
      max = Math.max(max, error);
    }
    perLayer.push({ layer, h: t, max });
  }
  values.sort((a, b) => a - b);
  return {
    count: values.length,
    median: values[Math.floor(values.length * 0.5)],
    p95: values[Math.floor(values.length * 0.95)],
    p99: values[Math.floor(values.length * 0.99)],
    max: values.at(-1),
    perLayer,
  };
};
const density = new Float32Array(
  geometry.attributes.furVolumeDensity.array.slice(0, vertices),
);
let densityMaskError = 0,
  baseFitError = 0;
for (let i = 0; i < vertices; i++) {
  densityMaskError = Math.max(densityMaskError, Math.abs(density[i] - mask[i]));
  baseFitError = Math.max(
    baseFitError,
    Math.hypot(
      ...[0, 1, 2].map((k) => coefficients32[0][i * 3 + k] - P[i * 3 + k]),
    ),
  );
}
await store("P", coefficients32[0], 3);
await store("R", coefficients32[1], 3);
await store("T", coefficients32[2], 3);
await store("uv", uv.slice(), 2);
await store("index", index.slice(), 1);
await store("mask", mask.slice(), 1);
await store("density", density, 1);
await store("sourceVertexIds", volume.vertices.slice(), 1);
await store("bindPosition", volume.canonical.slice(), 3);
const faceBySources = new Map();
for (let face = 0; face < index.length / 3; face++) {
  const key = Array.from(
    index.subarray(face * 3, face * 3 + 3),
    (i) => volume.vertices[i],
  )
    .sort((a, b) => a - b)
    .join(",");
  if (!faceBySources.has(key)) faceBySources.set(key, face);
}
const sourceRegion = state.regions.find((region) => region.name === "body");
const sourceRoots = sourceRegion.roots;
const rootIds = [];
for (let i = 0; i < sourceRoots.length; i++) {
  const root = sourceRoots[i];
  if (root.hairKind === "down" && root.kind === 0 && root.trunkWeight > 0)
    rootIds.push(i);
}
const count = rootIds.length,
  pointsPerStrand = sourceRegion.strandSegments + 1;
if (
  sourceRoots.length !== 70000 ||
  pointsPerStrand !== 9 ||
  sourceRegion.mesh.userData.strandCount !== 70000
)
  throw Error("Expected complete 70k body source with 9 points at density100");
const points = new Float32Array(count * pointsPerStrand * 3),
  colors = new Float32Array(count * 3);
const radii = new Float32Array(count).fill(8e-5),
  trunkWeights = new Float32Array(count),
  bulkFraction = new Float32Array(count),
  downDepth = new Float32Array(count);
const seedFaces = new Int32Array(count).fill(-1),
  rootBarycentric = new Float32Array(count * 3),
  sourceTriangles = new Uint32Array(count * 3);
const sourcePosition = sourceRegion.mesh.geometry.attributes.position;
let missingSeedFaces = 0,
  bulkZeroParents = 0;
for (let selected = 0; selected < count; selected++) {
  const original = rootIds[selected],
    root = sourceRoots[original];
  for (let sample = 0; sample < pointsPerStrand; sample++) {
    const a = original * sourceRegion.strandVertices + sample * 2;
    for (let axis = 0; axis < 3; axis++)
      points[(selected * pointsPerStrand + sample) * 3 + axis] =
        (sourcePosition.getComponent(a, axis) +
          sourcePosition.getComponent(a + 1, axis)) *
        0.5;
  }
  colors.set(root.color, selected * 3);
  trunkWeights[selected] = root.trunkWeight;
  downDepth[selected] = root.downDepth;
  const t = Math.max(0, Math.min(1, (root.downDepth - 0.72) / 0.22));
  bulkFraction[selected] = 1 - t * t * (3 - 2 * t);
  if (bulkFraction[selected] === 0) bulkZeroParents++;
  sourceTriangles.set([root.a, root.b, root.c], selected * 3);
  rootBarycentric.set([root.u, root.v, root.w], selected * 3);
  const seed = faceBySources.get(
    [root.a, root.b, root.c].sort((a, b) => a - b).join(","),
  );
  if (seed === undefined) missingSeedFaces++;
  else seedFaces[selected] = seed;
}
for (const [name, array, size] of [
  ["points", points, 3],
  ["colors", colors, 3],
  ["radii", radii, 1],
  ["trunkWeights", trunkWeights, 1],
  ["bulkFraction", bulkFraction, 1],
  ["downDepth", downDepth, 1],
  ["rootIds", new Uint32Array(rootIds), 1],
  ["seedFaces", seedFaces, 1],
  ["rootBarycentric", rootBarycentric, 3],
  ["sourceTriangles", sourceTriangles, 3],
])
  await store(name, array, size);
arrays.weights = {
  ...arrays.bulkFraction,
  aliasOf: "bulkFraction",
  meaning:
    "Bulk only: 1-smoothstep(.72,.94,downDepth). Do not multiply trunkWeight here and again in shader/domain mask.",
};
const manifest = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  source: {
    bundle,
    bundleSHA: runtime.bundleSha256,
    assetSHA: runtime.glbSha256,
    immutable: true,
  },
  configuration: {
    pose: "stand",
    coat: "long",
    volumeEnabled: true,
    detail: 1,
    densityPercent: 100,
    design,
  },
  mesh: {
    positions: "P",
    radial: "R",
    sweep: "T",
    uv: "uv",
    index: "index",
    mask: "mask",
    sourceVertexIds: "sourceVertexIds",
    vertices,
    triangles: index.length / 3,
    parameterization: "V(h)=P+R*h+T*h*h, h in [0,1]",
  },
  strands: {
    points: "points",
    count,
    pointsPerStrand,
    radii: "radii",
    colors: "colors",
    weights: "bulkFraction",
    trunkWeights: "trunkWeights",
    downDepth: "downDepth",
    seedFaces: "seedFaces",
    rootIds: "rootIds",
    rootBarycentric: "rootBarycentric",
    sourceTriangles: "sourceTriangles",
    scannedSourceCapacity: sourceRoots.length,
    selectedBy: "hairKind===down && kind===0 && trunkWeight>0",
    missingSeedFaces,
    bulkZeroParents,
  },
  arrays,
  fit: {
    layerSamples,
    h,
    float64: residual(coefficients64),
    storedFloat32: residual(coefficients32),
    storedBaseVsPrivatePosMax: baseFitError,
    densityMaskMaxError: densityMaskError,
  },
  notes: [
    "Radius 8e-5 scene units is an illustrative physical input, not a measured shaft radius from this cat.",
    "representedChildren is deliberately not embedded as a physical fact; CLI may calibrate a trial value such as64.",
    "Root colors are source linear RGB, not sRGB and not premultiplied.",
    "Shader regional density already includes the trunk domain mask. Baker weights are bulkFraction only; trunkWeights remain separate for audit.",
    "seedFaces index compact mesh triangles; -1 means the source root face is outside this compact volume mesh.",
    "This extract uses the immutable round02 bundle; later optional density-texture shader edits do not change the archived geometry.",
  ],
};
await fs.writeFile(
  `${directory}/manifest.json`,
  JSON.stringify(manifest, null, 2),
);
await fs.writeFile(
  `${directory}/summary.json`,
  JSON.stringify(
    {
      mesh: manifest.mesh,
      strands: manifest.strands,
      fit: manifest.fit,
      source: manifest.source,
      totalBinaryBytes: Object.values(arrays)
        .filter((a) => !a.aliasOf)
        .reduce((n, a) => n + a.byteLength, 0),
      notes: manifest.notes,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    manifest: `${directory}/manifest.json`,
    selectedParents: count,
    missingSeedFaces,
    fitFloat32Max: manifest.fit.storedFloat32.max,
  }),
);
model.dispose();
