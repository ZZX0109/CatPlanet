// Offline sampled extinction from actual surface-bound groom curves.
// node scripts/bake-cat-fur-volume.mjs [--resolution=256x256x16] [--children=64]
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { DataUtils } from "three";

const option = (key, fallback) =>
  process.argv.find((s) => s.startsWith(`--${key}=`))?.slice(key.length + 3) ??
  fallback;
const inputs = path.resolve(
  option("inputs", "artifacts/fur-volume/bake-inputs"),
);
const output = path.resolve(
  option("output", "artifacts/fur-volume/baked-body"),
);
const resolution = option("resolution", "256x256x16").split("x").map(Number);
const children = Number(option("children", "64"));
const parentLimit = Number(option("parents", "0"));
const envelopeScale = Number(option("radial-scale", "1"));
const sweepScale = Number(option("sweep-scale", "1"));
if (
  resolution.length !== 3 ||
  !resolution.every((v) => Number.isInteger(v) && v > 0 && v <= 2048) ||
  !Number.isFinite(children) ||
  children < 0
)
  throw Error("Invalid bake options");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const manifestBytes = await fs.readFile(path.join(inputs, "manifest.json"));
const manifest = JSON.parse(manifestBytes);
const arrays = {};
for (const [name, descriptor] of Object.entries(manifest.arrays)) {
  const bytes = await fs.readFile(path.join(inputs, descriptor.file));
  if (
    bytes.byteLength !== descriptor.byteLength ||
    sha(bytes) !== descriptor.sha256
  )
    throw Error(`Input checksum mismatch: ${name}`);
  const Constructors = { Float32Array, Float64Array, Uint32Array, Int32Array };
  const Type = Constructors[descriptor.type];
  if (!Type) throw Error(`Unsupported input type: ${descriptor.type}`);
  arrays[name] = new Type(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
}
await fs.mkdir(output, { recursive: true });
const runtimePath = path.join(output, "bake-runtime.mjs");
const compiled = await build({
  entryPoints: ["lib/cat-fur-volume-bake.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
await fs.writeFile(runtimePath, compiled.outputFiles[0].contents);
const { bakeCatFurVolume } = await import(
  pathToFileURL(runtimePath).href + `?v=${Date.now()}`
);
const bounds = [Infinity, Infinity, -Infinity, -Infinity];
for (let i = 0; i < arrays.uv.length; i += 2) {
  bounds[0] = Math.min(bounds[0], arrays.uv[i]);
  bounds[1] = Math.min(bounds[1], arrays.uv[i + 1]);
  bounds[2] = Math.max(bounds[2], arrays.uv[i]);
  bounds[3] = Math.max(bounds[3], arrays.uv[i + 1]);
}
const uvTransform = [
  1 / (bounds[2] - bounds[0]),
  1 / (bounds[3] - bounds[1]),
  -bounds[0] / (bounds[2] - bounds[0]),
  -bounds[1] / (bounds[3] - bounds[1]),
];
const croppedUv = arrays.uv.slice();
for (let i = 0; i < croppedUv.length; i += 2) {
  croppedUv[i] = croppedUv[i] * uvTransform[0] + uvTransform[2];
  croppedUv[i + 1] = croppedUv[i + 1] * uvTransform[1] + uvTransform[3];
}
const allParents = manifest.strands.count;
const count = parentLimit > 0 ? Math.min(allParents, parentLimit) : allParents;
const subset = (source, stride) => {
  if (count === allParents) return source;
  const result = new source.constructor(count * stride);
  for (let i = 0; i < count; i++) {
    const parent = Math.floor((i * allParents) / count);
    result.set(
      source.subarray(parent * stride, (parent + 1) * stride),
      i * stride,
    );
  }
  return result;
};
const started = performance.now();
if (!(
  Number.isFinite(envelopeScale) &&
  envelopeScale > 0 &&
  Number.isFinite(sweepScale) &&
  sweepScale >= 0
))
  throw Error("Invalid geometry scales");
const radial = arrays.R.map((v) => v * envelopeScale);
const sweep = arrays.T.map((v) => v * sweepScale);
const result = bakeCatFurVolume({
  mesh: {
    positions: arrays.P,
    radial,
    sweep,
    uv: croppedUv,
    index: arrays.index,
    mask: arrays.mask,
    sourceVertexIds: arrays.sourceVertexIds,
  },
  strands: {
    points: subset(arrays.points, 27),
    count,
    pointsPerStrand: 9,
    radii: subset(arrays.radii, 1),
    colors: subset(arrays.colors, 3),
    weights: subset(arrays.bulkFraction, 1),
    seedFaces: subset(arrays.seedFaces, 1),
    representedChildren: (children * allParents) / count,
  },
  resolution,
});
const bakeMs = performance.now() - started;
let maximum = 0,
  occupied = 0;
for (let i = 3; i < result.rgba.length; i += 4) {
  if (!Number.isFinite(result.rgba[i]) || result.rgba[i] < 0)
    throw Error("Invalid extinction");
  maximum = Math.max(maximum, result.rgba[i]);
  if (result.rgba[i] > 0) occupied++;
}
if (!(maximum > 0 && maximum <= 1_000_000))
  throw Error(`Extinction scale unsupported: ${maximum}`);
const half = new Uint16Array(result.rgba.length);
let originalMass = 0,
  decodedMass = 0,
  absoluteMassError = 0,
  colourErrorMass = 0,
  colourMass = 0;
for (let voxel = 0; voxel < result.voxelVolumes.length; voxel++) {
  const i = voxel * 4,
    kappa = result.rgba[i + 3],
    density = kappa / maximum;
  const alphaHalf = DataUtils.toHalfFloat(density),
    decodedDensity = DataUtils.fromHalfFloat(alphaHalf);
  half[i + 3] = alphaHalf;
  const volume = result.voxelVolumes[voxel];
  originalMass += kappa * volume;
  decodedMass += decodedDensity * maximum * volume;
  absoluteMassError += Math.abs(decodedDensity * maximum - kappa) * volume;
  for (let channel = 0; channel < 3; channel++) {
    const color = result.rgba[i + channel];
    if (!Number.isFinite(color) || color < 0)
      throw Error("Invalid linear root colour");
    half[i + channel] = DataUtils.toHalfFloat(color * density);
    const decoded =
      decodedDensity > 1e-8
        ? DataUtils.fromHalfFloat(half[i + channel]) / decodedDensity
        : 0;
    colourErrorMass += Math.abs(decoded - color) * kappa * volume;
    colourMass += Math.max(color, 1e-6) * kappa * volume;
  }
}
const quantization = {
  originalMass,
  decodedMass,
  relativeSignedMassError: (decodedMass - originalMass) / originalMass,
  relativeAbsoluteMassError: absoluteMassError / originalMass,
  relativeColourError: colourErrorMass / Math.max(colourMass, 1e-12),
};
if (
  quantization.relativeAbsoluteMassError > 0.05 ||
  quantization.relativeColourError > 0.05
)
  throw Error(
    `Half-float quantization gate failed: ${JSON.stringify(quantization)}`,
  );
const bytes = Buffer.from(half.buffer, half.byteOffset, half.byteLength);
await fs.writeFile(path.join(output, "body-volume.rgba16f.bin"), bytes);
const metadata = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceManifestSHA: sha(manifestBytes),
  source: manifest.source,
  sourceConfiguration: manifest.configuration,
  geometryScales: { envelopeScale, sweepScale },
  resolution,
  format: "RGBA16F",
  colourSpace: "linear-no-colour-space-conversion",
  encoding: "RGB=linear-root-colour*normalised-kappa;A=normalised-kappa",
  densityScale: maximum,
  uvTransform,
  uvBounds: bounds,
  bytes: bytes.byteLength,
  sha256: sha(bytes),
  representedChildren: children,
  parentCount: count,
  totalInputParents: allParents,
  bakeMs,
  occupiedVoxels: occupied,
  quantization,
  stats: result.stats,
  caveats: [
    "Represented children and illustrative radius are prototype calibration, not a follicle census.",
    "The mapped envelope can contain folds and exclude hair portions; losses are reported, not renormalised.",
    "The atlas was sampled at the recorded canonical design; extreme edits need separate validation.",
  ],
};
await fs.writeFile(
  path.join(output, "body-volume.json"),
  JSON.stringify(metadata, null, 2),
);
console.log(
  JSON.stringify({
    output,
    resolution,
    parents: count,
    bakeMs,
    bytes: bytes.byteLength,
    densityScale: maximum,
    quantization,
    stats: result.stats,
  }),
);
