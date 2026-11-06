/** CPU-only line-field moment/mip validation and current asset provenance. */
import fs from "node:fs/promises";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import sharp from "sharp";

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "ts",
    contents:
      "import {buildNativeCoatMomentMips,decodeNativeCoatMoment}from'./lib/cat-native-coat-moments';globalThis.__coatMoments={buildNativeCoatMomentMips,decodeNativeCoatMoment};",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "iife",
});
vm.runInThisContext(bundle.outputFiles[0].text);
const { buildNativeCoatMomentMips: pack, decodeNativeCoatMoment: decode } =
  globalThis.__coatMoments;
const checks = [];
const check = (name, pass, details) => {
  checks.push({ name, pass: !!pass, details });
  if (!pass) throw Error(name + ":" + JSON.stringify(details));
};
const field = (angles, confidence = angles.map(() => 1)) =>
  new Float32Array(
    angles.flatMap((a, i) => [
      Math.cos((a * Math.PI) / 90),
      Math.sin((a * Math.PI) / 90),
      confidence[i],
    ]),
  );
const lineAngle = (q) =>
  (0.5 * Math.atan2(q.sin2theta, q.cos2theta) * 180) / Math.PI;
const antipodal = pack({ data: field([89, -89]), width: 2, height: 1 });
const a = decode(antipodal.levels[1].floatData, "float");
check(
  "plus/minus89degree axes mip to90degree, never the false0degree half-vector average",
  Math.abs(Math.abs(lineAngle(a)) - 90) < 1e-6 && a.strength > 0.999,
  a,
);
const crossing = pack({ data: field([0, 90]), width: 2, height: 1 });
check(
  "equal orthogonal lines cancel anisotropy in float and RGBA8",
  !decode(crossing.levels[1].floatData, "float").validAxis &&
    !decode(crossing.levels[1].rgba8Data, "rgba8").validAxis,
);
const weighted = pack({ data: field([0, 90], [1, 0.1]), width: 2, height: 1 }),
  w = decode(weighted.levels[1].floatData, "float");
check(
  "confidence weights remain in the moment instead of normalizing every mip",
  Math.abs(w.moment[0] - 0.45) < 1e-7 && Math.abs(w.confidence - 0.55) < 1e-7,
  w,
);
const unknown = pack({ data: new Float32Array(4 * 3), width: 2, height: 2 });
check(
  "unknown moment remains exactly inactive despite signed zeroRGBA8 midpoint bias",
  unknown.levels.every(
    (l) =>
      decode(l.floatData, "float").strength === 0 &&
      decode(l.rgba8Data, "rgba8").strength === 0,
  ),
);
const mirror = pack({ data: field([30, -30]), width: 2, height: 1 });
check(
  "canonical BlenderUV-up sin2 is retained, not reflected by CPU",
  mirror.levels[0].floatData[1] > 0 && mirror.levels[0].floatData[5] < 0,
);
const rows = pack({ data: field([0, 30, 60, 90]), width: 2, height: 2 });
check(
  "image-top-first row ordering remains unchanged",
  Math.abs(lineAngle(decode(rows.levels[0].floatData, "float", 4)) - 30) <
    1e-5 &&
    Math.abs(lineAngle(decode(rows.levels[0].floatData, "float", 8)) - 60) <
      1e-5,
);
const oddData = field(
    Array.from({ length: 15 }, () => 20),
    Array.from({ length: 15 }, (_, i) => (i + 1) / 15),
  ),
  odd = pack({ data: oddData, width: 5, height: 3 });
const expected =
  Array.from({ length: 15 }, (_, i) => oddData[i * 3 + 2]).reduce(
    (a, b) => a + b,
    0,
  ) / 15;
check(
  "odd-sized mip footprints retain last row/column and total confidence mean",
  Math.abs(odd.levels.at(-1).floatData[2] - expected) < 1e-7,
  {
    expected,
    actual: odd.levels.at(-1).floatData[2],
    sizes: odd.levels.map((l) => [l.width, l.height]),
  },
);
for (const [name, data, width, height] of [
  ["bad length", new Float32Array(2), 1, 1],
  ["NaN", new Float32Array([NaN, 0, 1]), 1, 1],
  ["bad confidence", new Float32Array([1, 0, 2]), 1, 1],
  ["zero known direction", new Float32Array([0, 0, 0.5]), 1, 1],
  ["nonunit known direction", new Float32Array([0.1, 0.1, 0.5]), 1, 1],
  ["bad dimensions", new Float32Array(0), 0, 1],
]) {
  let rejected = false;
  try {
    pack({ data, width, height });
  } catch {
    rejected = true;
  }
  check(name + " is rejected", rejected);
}

const sourcePath = "artifacts/native-coat-flow/blender_uv_ready.bin",
  inputBytes = await fs.readFile(sourcePath),
  inputHash = createHash("sha256").update(inputBytes).digest("hex");
const data = new Float32Array(
  inputBytes.buffer.slice(
    inputBytes.byteOffset,
    inputBytes.byteOffset + inputBytes.byteLength,
  ),
);
const actual = pack({ data, width: 256, height: 256 });
check(
  "actual256square field has complete9level chain to1x1",
  actual.levels.length === 9 &&
    actual.levels.at(-1).width === 1 &&
    actual.levels.at(-1).height === 1,
);
check(
  "actual field is not mutated",
  createHash("sha256").update(Buffer.from(data.buffer)).digest("hex") ===
    inputHash,
);
let signedError = 0,
  confidenceError = 0,
  maximumBaseAngleError = 0,
  known = 0,
  maximumStrongMipAngleError = 0;
const levels = [];
for (const [levelIndex, l] of actual.levels.entries()) {
  let valid = 0;
  for (let i = 0; i < l.floatData.length; i += 4) {
    for (let k = 0; k < 2; k++)
      signedError = Math.max(
        signedError,
        Math.abs(l.floatData[i + k] - ((l.rgba8Data[i + k] * 2) / 255 - 1)),
      );
    confidenceError = Math.max(
      confidenceError,
      Math.abs(l.floatData[i + 2] - l.rgba8Data[i + 2] / 255),
    );
    const f = decode(l.floatData, "float", i),
      q = decode(l.rgba8Data, "rgba8", i);
    if (f.validAxis) valid++;
    if (f.validAxis && q.validAxis) {
      const dot = Math.max(
          -1,
          Math.min(1, f.cos2theta * q.cos2theta + f.sin2theta * q.sin2theta),
        ),
        error = (0.5 * Math.acos(dot) * 180) / Math.PI;
      if (levelIndex === 0) {
        maximumBaseAngleError = Math.max(maximumBaseAngleError, error);
        known++;
      }
      if (f.strength >= 0.1)
        maximumStrongMipAngleError = Math.max(
          maximumStrongMipAngleError,
          error,
        );
    }
  }
  levels.push({
    width: l.width,
    height: l.height,
    validAxes: valid,
    floatBytes: l.floatData.byteLength,
    rgba8Bytes: l.rgba8Data.byteLength,
  });
}
check(
  "signedRGBA8 quantization stays within1/255",
  signedError <= 1 / 255 + 1e-7,
  signedError,
);
check(
  "confidenceRGBA8 quantization stays within0.5/255",
  confidenceError <= 0.5 / 255 + 1e-7,
  confidenceError,
);
check(
  "actual confident base axes retain subdegree angle precision",
  maximumBaseAngleError < 0.5,
  { known, maximumBaseAngleError },
);
const assetPath = "public/models/creator/norwegian-cat.glb",
  assetBytes = await fs.readFile(assetPath),
  jsonLength = assetBytes.readUInt32LE(12),
  gltf = JSON.parse(assetBytes.subarray(20, 20 + jsonLength).toString()),
  bin = assetBytes.subarray(28 + jsonLength);
const material = gltf.materials.find((m) => m.normalTexture),
  image = gltf.images[gltf.textures[material.normalTexture.index].source],
  view = gltf.bufferViews[image.bufferView],
  encoded = bin.subarray(
    view.byteOffset ?? 0,
    (view.byteOffset ?? 0) + view.byteLength,
  ),
  rgb = await sharp(encoded).removeAlpha().raw().toBuffer();
const fieldMetadata = JSON.parse(
    await fs.readFile("artifacts/native-coat-flow/metadata.json", "utf8"),
  ),
  pixelHash = createHash("sha256").update(rgb).digest("hex");
check(
  "restored official asset normal pixels still exactly match the reviewedfield image domain",
  pixelHash === fieldMetadata.source.embeddedRGBPixelSHA,
  { pixelHash, expected: fieldMetadata.source.embeddedRGBPixelSHA },
);
const report = {
  capturedAt: new Date().toISOString(),
  moduleSHA: createHash("sha256")
    .update(await fs.readFile("lib/cat-native-coat-moments.ts"))
    .digest("hex"),
  checks,
  pass: checks.every((c) => c.pass),
  sourceField: { path: sourcePath, sha256: inputHash },
  currentAsset: {
    path: assetPath,
    sha256: createHash("sha256").update(assetBytes).digest("hex"),
    normalImageSHA256: createHash("sha256").update(encoded).digest("hex"),
    normalRGBPixelSHA256: pixelHash,
  },
  basis: actual.basis,
  rowOrder: actual.rowOrder,
  levels,
  errors: {
    maximumInputDirectorNormalization: actual.maximumInputDirectorNormalization,
    signedMoment: signedError,
    confidence: confidenceError,
    baseAngleDegrees: maximumBaseAngleError,
    strongMipAngleDegrees: maximumStrongMipAngleError,
    strongMipThreshold: 0.1,
  },
  quantization: actual.quantization,
  notes: [
    "No GPU/render/appearance acceptance.",
    "CPU preserves BlenderUV-up and image-top-first rows; fragment must apply the actualWebUV Jacobian with itsV reflection exactly once.",
    "RGBA8 zero-moment guard suppresses arbitrary direction from the unavoidable128 midpoint bias; do not feed these moment channels directly to built-in anisotropyMap.",
  ],
};
await fs.mkdir("artifacts/native-coat-surface-research", { recursive: true });
await fs.writeFile(
  "artifacts/native-coat-surface-research/moment-validation.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    output: "artifacts/native-coat-surface-research/moment-validation.json",
    pass: report.pass,
    checks: checks.length,
    errors: report.errors,
    normalImageSHA256: report.currentAsset.normalImageSHA256,
  }),
);
