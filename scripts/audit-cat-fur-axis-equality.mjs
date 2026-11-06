/** Byte equality of the axis threshold optimization and frozen physical groom. */
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadArchivedGroom } from "./cat-groom-audit-runtime.mjs";

const paths = {
  baseline: "artifacts/fur-realism/round-08/performance-probe.js",
  hypot: "artifacts/fur-realism/verification/axis-hypot-before-probe.js",
  squared: "artifacts/fur-realism/verification/axis-squared-after-probe.js",
};
const output =
  "artifacts/fur-realism/verification/axis-threshold-byte-equality.json";
const combination = {
  headRound: 100,
  headWidth: 75,
  headDepth: 35,
  cheeks: 80,
  jaw: 75,
  muzzle: 30,
  muzzleWidth: 60,
};
const hash = (array) =>
  createHash("sha256")
    .update(Buffer.from(array.buffer, array.byteOffset, array.byteLength))
    .digest("hex");
const archives = {};
for (const [name, bundle] of Object.entries(paths)) {
  const runtime = await loadArchivedGroom(bundle),
    { api, model, fur, state } = runtime;
  const cases = [];
  let tick = 0;
  model.motion.setBreathing(false);
  model.motion.setIdleBlink(false);
  try {
    for (const profile of ["short-default", "long-default", "long-maximum"])
      for (const pose of ["stand", "rest"])
        for (const shape of ["neutral", "combination"]) {
          const coatType = profile.startsWith("short") ? "short" : "long";
          model.motion.setPose(pose, true);
          model.motion.update(++tick, { reducedMotion: true });
          const design = {
            ...api.defaultCreatorDesign,
            coatType,
            shape: {
              ...api.defaultCreatorDesign.shape,
              ...api.getCatCoatProfile(coatType).defaults,
              ...(shape === "combination" ? combination : {}),
            },
          };
          if (profile === "long-maximum")
            for (const r of ["head", "ruff", "body"])
              for (const p of ["FurDensity", "FurLength"])
                design.shape[r + p] = 100;
          api.applyCreatorDesign(model, design);
          fur.setDetail(1);
          fur.refresh({ full: true });
          const regions = state.regions.map((region) => {
            const geometry = region.mesh.geometry,
              attributes = {};
            for (const key of [
              "position",
              "furWidth",
              "normal",
              "uv",
              "color",
              "furFilterAxis",
            ]) {
              const attribute = geometry.attributes[key];
              if (!attribute) continue;
              attributes[key] = {
                sha256: hash(attribute.array),
                count: attribute.count,
                itemSize: attribute.itemSize,
                normalized: attribute.normalized,
                arrayType: attribute.array.constructor.name,
                bytes: attribute.array.byteLength,
              };
            }
            attributes.index = {
              sha256: hash(geometry.index.array),
              count: geometry.index.count,
              arrayType: geometry.index.array.constructor.name,
              bytes: geometry.index.array.byteLength,
            };
            return {
              region: region.name,
              strands: region.mesh.userData.strandCount,
              vertices: region.mesh.userData.strandVertices,
              segments: region.mesh.userData.strandSegments,
              attributes,
            };
          });
          cases.push({ profile, pose, shape, regions });
        }
    archives[name] = {
      bundle,
      bundleSha256: runtime.bundleSha256,
      glbSha256: runtime.glbSha256,
      cases,
    };
  } finally {
    model.dispose();
  }
}
const comparisons = [];
for (let i = 0; i < archives.squared.cases.length; i++) {
  const current = archives.squared.cases[i],
    before = archives.hypot.cases[i],
    baseline = archives.baseline.cases[i];
  for (let j = 0; j < current.regions.length; j++) {
    const region = current.regions[j],
      old = before.regions[j],
      frozen = baseline.regions[j];
    const physicalKeys = [
      "position",
      "furWidth",
      "normal",
      "uv",
      "color",
      "index",
    ];
    comparisons.push({
      profile: current.profile,
      pose: current.pose,
      shape: current.shape,
      region: region.region,
      axisBytesIdentical:
        JSON.stringify(region.attributes.furFilterAxis) ===
        JSON.stringify(old.attributes.furFilterAxis),
      physicalBytesIdenticalToFrozen08: physicalKeys.every(
        (key) =>
          JSON.stringify(region.attributes[key]) ===
          JSON.stringify(frozen.attributes[key]),
      ),
      physicalBytesIdenticalToHypot: physicalKeys.every(
        (key) =>
          JSON.stringify(region.attributes[key]) ===
          JSON.stringify(old.attributes[key]),
      ),
    });
  }
}
const mismatches = comparisons.filter(
  (row) =>
    !row.axisBytesIdentical ||
    !row.physicalBytesIdenticalToFrozen08 ||
    !row.physicalBytesIdenticalToHypot,
);
await fs.writeFile(
  output,
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      method:
        "Full-capacity typed-array byte SHA256 equality over short-default,long-default,long-maximum × stand/rest × neutral/combination; no browser/GPU.",
      combination,
      comparisons,
      mismatches,
      archives,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    {
      output,
      cases: archives.squared.cases.length,
      regionComparisons: comparisons.length,
      allAxisBytesEqual: comparisons.every((r) => r.axisBytesIdentical),
      allPhysicalBytesEqualFrozen08: comparisons.every(
        (r) => r.physicalBytesIdenticalToFrozen08,
      ),
      mismatches,
    },
    null,
    2,
  ),
);
if (mismatches.length) process.exitCode = 1;
