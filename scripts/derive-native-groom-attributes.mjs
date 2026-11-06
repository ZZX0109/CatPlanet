/** Private native-cache radii/arc derivation; no new roots or resampling. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import vm from "node:vm";

const folder = resolve(process.argv[2] ?? "");
if (!relative(resolve("artifacts/native-groom-capture"), folder) || relative(resolve("artifacts/native-groom-capture"), folder).startsWith(".."))
  throw Error("Pass a private capture subdirectory in artifacts/native-groom-capture");
const hash = value => createHash("sha256").update(value).digest("hex");
const metaBytes = await readFile(`${folder}/meta.json`);
const meta = JSON.parse(metaBytes);
const [pointsBytes, countsBytes] = await Promise.all([readFile(`${folder}/points.f32`), readFile(`${folder}/counts.u8`)]);
if (hash(pointsBytes) !== meta.pointFormat.sha256 || hash(countsBytes) !== meta.countFormat.sha256)
  throw Error("Frozen native input SHA differs from capture metadata");
const parameters = meta.sourceParametersRaw;
if (typeof parameters.nativeShapeRaw !== "number" || typeof parameters.nativeCloseTipRaw !== "boolean")
  throw Error("Capture the actual original shape and close-tip fields; never guess them");
const source = await build({ stdin: { resolveDir: process.cwd(), contents: "import {buildNativeCurveRadii} from './lib/cat-native-curve-radii';globalThis.__deriveNativeRadii=buildNativeCurveRadii;" }, bundle: true, platform: "node", format: "iife", write: false });
vm.runInThisContext(source.outputFiles[0].text);
const radii = globalThis.__deriveNativeRadii({
  pointsWorld: new Float32Array(pointsBytes.buffer, pointsBytes.byteOffset, pointsBytes.length / 4),
  pointCounts: new Uint8Array(countsBytes), pointCapacity: 17,
  parameters: { rootDiameter: parameters.nativeRootRadiusRaw, tipDiameter: parameters.nativeTipRadiusRaw, diameterScale: parameters.nativeRadiusScaleRaw, shape: parameters.nativeShapeRaw, closeTip: parameters.nativeCloseTipRaw },
  objectMatrixWorld: Array.from({ length: 16 }, (_, i) => meta.sourceObjectMatrixWorld[i % 4][Math.floor(i / 4)]),
  worldToOutputScale: 1, capPolicy: "cycles-export-slot",
});
const files = {};
for (const [name, array] of [["radii.f32", radii.radii], ["normalized-arc.f32", radii.normalizedArc]]) {
  const buffer = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  await writeFile(`${folder}/${name}`, buffer);
  files[name] = { bytes: buffer.length, sha256: hash(buffer), format: "Float32LE", shape: [meta.retainedCurves, 17] };
}
const report = { status: "actual-cache source-formula WORLD radius/arc only; not appearance acceptance", sourceSha256: meta.sourceSha256, sourceInputHashes: { "meta.json": hash(metaBytes), "points.f32": hash(pointsBytes), "counts.u8": hash(countsBytes) }, parameters, capPolicy: "cycles-export-slot", worldToOutputScale: 1, files, diagnostics: radii.diagnostics, limits: ["Uses verified Cycles exporter formula, not a captured Cycles device-radius buffer", "Short valid-prefix renderer may not draw final repeated export-slot cap", "Children-only source draw selection is the caller's responsibility"] };
await writeFile(`${folder}/radii-metadata.json`, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ folder, curves: meta.retainedCurves, files }));
