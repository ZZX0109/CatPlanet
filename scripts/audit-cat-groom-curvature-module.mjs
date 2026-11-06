/**
 * Compare the unused pure TS fitter with the independent archived Node fitter.
 * Reuses its actual-geometry measurement harness, not its fitting implementation.
 * No browser/GPU, live runtime edits or writes to the original audit report.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { transform } from "esbuild";

const modulePath = "lib/cat-groom-curvature.ts";
const moduleSource = await fs.readFile(modulePath, "utf8");
const compiled = await transform(moduleSource, { loader: "ts", format: "esm" });
const module = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`
);
const outputPath =
  process.argv[3] ??
  "artifacts/fur-realism/verification/guide-circle-module-profiles-round08.json";
const validationPath = outputPath.replace(/\.json$/, "-validation.json");

const edgeCases = [];
function check(name, assertion) {
  edgeCases.push({ name, pass: Boolean(assertion) });
  if (!assertion) throw new Error(name);
}
const example = Object.freeze([
  0.27, 0.18, 0.008, 0.72, 0.41, 0.035, 0.78, 0.72, 0.075, 0.44, 1.02, 0.12,
]);
const before = [...example];
const fit = module.fitCatGroomCircle(example, 1, 1);
check(
  "default strategy preserves tip clearance",
  fit.strategy === "preserve-tip-clearance",
);
check(
  "input is returned by reference and not mutated",
  fit.originalCurve === example && example.every((v, i) => v === before[i]),
);
check("ordinary arched guide has a circle", fit.kind === "circle");
for (const [name, curve, n, t, reason] of [
  ["invalid length", [1, 2, 3], 1, 1, "invalid-input"],
  ["nonfinite knot", [...example.slice(0, 11), NaN], 1, 1, "invalid-input"],
  ["zero gain", example, 0, 1, "invalid-input"],
  ["nonfinite gain", example, 1, Infinity, "invalid-input"],
  ["zero curve", Array(12).fill(0), 1, 1, "degenerate-guide"],
  [
    "unsupported rho",
    [0.25, 0.001, 0, 0.5, 0.002, 0, 0.75, 0.003, 0, 1, 0.004, 0],
    1,
    1,
    "unsupported-radial-ratio",
  ],
]) {
  const fallback = module.fitCatGroomCircle(curve, n, t);
  check(
    name,
    fallback.kind === "original" &&
      fallback.reason === reason &&
      fallback.originalCurve === curve,
  );
  const untouched = [9, 8, 7, 6];
  check(
    name + " leaves evaluation output untouched",
    !module.evaluateCatGroomCircle(fallback, 0.5, untouched) &&
      untouched.join() === "9,8,7,6",
  );
}
if (fit.kind === "circle") {
  const a = new Float64Array(4),
    b = new Float64Array(4),
    middle = new Float64Array(4);
  module.evaluateCatGroomCircle(fit, 0.5 - 1e-5, a);
  module.evaluateCatGroomCircle(fit, 0.5 + 1e-5, b);
  module.evaluateCatGroomCircle(fit, 0.5, middle);
  check(
    "analytic derivatives match finite differences",
    Math.abs((b[0] - a[0]) / 2e-5 - middle[2]) < 1e-8 &&
      Math.abs((b[1] - a[1]) / 2e-5 - middle[3]) < 1e-8,
  );
  const root = new Float64Array(4);
  module.evaluateCatGroomCircle(fit, 0, root);
  check("root remains exactly fixed", root[0] === 0 && root[1] === 0);
}

// The old audit remains an independent reference. Only replace its private fit
// function with an adapter; retain its source sampling, geometry and statistics.
globalThis.__catGroomCurvatureModule = module;
let harness = await fs.readFile(
  "scripts/audit-cat-groom-circle-perroot.mjs",
  "utf8",
);
const begin = harness.indexOf("function fitRoot(root, index, mode) {");
const end = harness.indexOf("const selections =", begin);
if (begin < 0 || end < 0)
  throw new Error("Independent audit structure changed.");
harness =
  harness.slice(0, begin) +
  `
function fitRoot(root, index, mode) {
  const result=globalThis.__catGroomCurvatureModule.fitCatGroomCircle(
    region.longGroomCurve.subarray(index*12,index*12+12), root.hairLift, forwardGain, mode);
  if(result.kind==='original') {
    const source=result.source;
    if(!source) throw new Error('Unexpected invalid actual guide');
    return {arc:source.arcLength,peak:source.peakNormal,rho:source.radialRatio,
      oldTipRatio:source.tipNormalRatio,unfittable:true};
  }
  const c=result.candidate,m=result.metrics,s=m.source;
  return {start:c.startAngle,end:c.endAngle,delta:c.sweepAngle,R:c.radius,
    arc:s.arcLength,peak:s.peakNormal,rho:s.radialRatio,tipRatio:m.tipNormalRatio,
    oldTipRatio:s.tipNormalRatio,samplePeak:m.sampledPeakRatio*s.peakNormal,
    normalGain:c.normalGain,forwardGain:c.forwardGain,sampledArc:s.arcLength*m.sampledArcRatio};
}
` +
  harness.slice(end);
harness = harness
  .replace(
    '"./cat-groom-audit-runtime.mjs"',
    JSON.stringify(
      pathToFileURL(path.resolve("scripts/cat-groom-audit-runtime.mjs")).href,
    ),
  )
  .replace(
    '"artifacts/fur-realism/verification/guide-circle-perroot-round08.json"',
    JSON.stringify(outputPath),
  );
await import(
  `data:text/javascript;base64,${Buffer.from(harness).toString("base64")}`
);
delete globalThis.__catGroomCurvatureModule;

const referencePath =
  "artifacts/fur-realism/verification/guide-circle-perroot-round08.json";
const reference = JSON.parse(await fs.readFile(referencePath, "utf8"));
const actual = JSON.parse(await fs.readFile(outputPath, "utf8"));
const mismatches = [];
let numericComparisons = 0;
let maximumNumericDifference = 0;
function compare(a, b, key) {
  if (typeof a === "number" && typeof b === "number") {
    numericComparisons++;
    const difference = Math.abs(a - b);
    maximumNumericDifference = Math.max(maximumNumericDifference, difference);
    if (difference > 1e-10) mismatches.push({ key, a, b, difference });
  } else if (a && typeof a === "object" && b && typeof b === "object") {
    for (const k of Object.keys(a)) compare(a[k], b[k], key + "." + k);
  } else if (a !== b) mismatches.push({ key, a, b });
}
compare(reference.fits, actual.fits, "fits");
compare(reference.rows, actual.rows, "rows");
actual.module = {
  path: modulePath,
  sha256: createHash("sha256").update(moduleSource).digest("hex"),
  importedByLiveGroom: false,
};
await fs.writeFile(outputPath, JSON.stringify(actual, null, 2) + "\n");
const validation = {
  capturedAt: new Date().toISOString(),
  module: actual.module,
  referencePath,
  actualPath: outputPath,
  edgeCases,
  numericComparisons,
  maximumNumericDifference,
  mismatches,
  note: "Actual archived GLB, long default and all-100 profiles. Pure module and independent reference fitted separately. No live runtime imports the new module.",
};
await fs.writeFile(validationPath, JSON.stringify(validation, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      validationPath,
      numericComparisons,
      maximumNumericDifference,
      mismatches,
    },
    null,
    2,
  ),
);
if (mismatches.length)
  throw new Error("Pure module diverged from the independent fit.");
