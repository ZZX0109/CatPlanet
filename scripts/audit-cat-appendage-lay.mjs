/** Compare archived old/new actual groom geometry; no browser or source edits. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadArchivedGroom } from "./cat-groom-audit-runtime.mjs";

const [
  oldBundle = "artifacts/fur-filter/volume-round02/model-probe.js",
  newBundle,
  output = "artifacts/fur-volume/appendage-lay/geometry-check.json",
] = process.argv.slice(2);
if (!newBundle)
  throw Error(
    "Usage: node scripts/audit-cat-appendage-lay.mjs oldBundle newBundle [report.json]",
  );
const hash = (array) =>
  createHash("sha256")
    .update(Buffer.from(array.buffer, array.byteOffset, array.byteLength))
    .digest("hex");
const failures = [];
const load = async (bundle) =>
  loadArchivedGroom(bundle, {
    transformBundle(source) {
      const normal = /const normalGain = root\.hairLift[\s\S]*?;/;
      const derivative = "const vl2 = vx * vx + vy * vy + vz * vz || 1;";
      if (!normal.test(source) || !source.includes(derivative))
        throw Error("Audit instrumentation no longer matches " + bundle);
      return source
        .replace(
          "globalThis.__groomAuditState = {regions,evaluated,normals};",
          "globalThis.__groomAuditState = {regions,evaluated,normals,membership};",
        )
        .replace(
          normal,
          "$&\n        root.__auditGain = normalGain; root.__auditLength = length; root.__auditNormal = [nx,ny,nz]; root.__auditDerivativesFinite = true; root.__auditFloor = allBounds.min.y + .002;",
        )
        .replace(
          derivative,
          derivative +
            "\n          root.__auditDerivativesFinite = root.__auditDerivativesFinite && Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vz);",
        );
    },
  });
const old = await load(oldBundle),
  next = await load(newBundle);
for (const r of [old, next]) {
  r.model.motion.setBreathing(false);
  r.model.motion.setIdleBlink(false);
  r.fur.setDetail(1);
}
const bindings = (region) => {
  const a = new Float64Array(region.roots.length * 7);
  region.roots.forEach((r, i) =>
    a.set([r.a, r.b, r.c, r.u, r.v, r.w, r.kind], i * 7),
  );
  return hash(a);
};
const cases = [];
const max = (stats, key, value) => {
  stats[key] = Math.max(stats[key], value);
};
const sameBytes = (a, b) =>
  a.byteLength === b.byteLength &&
  Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(
    Buffer.from(b.buffer, b.byteOffset, b.byteLength),
  );
try {
  for (const [coat, pose] of [
    ["long", "stand"],
    ["long", "rest"],
    ["short", "stand"],
  ]) {
    for (const r of [old, next]) {
      r.model.motion.setPose(pose, true);
      r.model.motion.update(1, { reducedMotion: true });
      const design = {
        ...r.api.defaultCreatorDesign,
        coatType: coat,
        shape: {
          ...r.api.defaultCreatorDesign.shape,
          ...r.api.getCatCoatProfile(coat).defaults,
          headFurDensity: 100,
          ruffFurDensity: 100,
          bodyFurDensity: 100,
        },
      };
      r.api.applyCreatorDesign(r.model, design);
      r.fur.refresh({ full: true });
    }
    const result = {
      coat,
      pose,
      regions: [],
      checks: {
        counts: true,
        bindings: true,
        indices: true,
        uv: true,
        widthMagnitude: true,
        unchangedCohorts: true,
        onlyNormalChange: true,
        analyticGain: true,
        anatomyCache: true,
        finiteDerivatives: true,
      },
      maxGainRatioError: 0,
      maxAnatomyCacheError: 0,
      maxNormalPredictionError: 0,
      maxTProjectionChange: 0,
      maxBProjectionChange: 0,
      maxWidthMagnitudeChange: 0,
      checkedAppendageNodes: 0,
      groundContactNodesExcluded: 0,
      changedAppendageRoots: 0,
      changedByKind: { 0: 0, 1: 0, 2: 0 },
      changedByHairKind: { down: 0, awn: 0, guard: 0 },
    };
    for (let ri = 0; ri < old.state.regions.length; ri++) {
      const a = old.state.regions[ri],
        b = next.state.regions[ri],
        ga = a.mesh.geometry,
        gb = b.mesh.geometry;
      const row = {
        region: a.name,
        countBefore: a.roots.length,
        countAfter: b.roots.length,
        bindingSHA: bindings(a),
        newBindingSHA: bindings(b),
        indexSHA: hash(ga.index.array),
        newIndexSHA: hash(gb.index.array),
      };
      result.regions.push(row);
      result.checks.counts &&=
        a.roots.length === b.roots.length &&
        a.strandVertices === b.strandVertices &&
        a.strandIndices === b.strandIndices &&
        a.mesh.userData.strandCount === b.mesh.userData.strandCount;
      result.checks.bindings &&=
        row.bindingSHA === row.newBindingSHA &&
        sameBytes(a.longGroomCurve, b.longGroomCurve) &&
        sameBytes(a.groomCurve, b.groomCurve);
      result.checks.indices &&= row.indexSHA === row.newIndexSHA;
      result.checks.uv &&= sameBytes(
        ga.attributes.uv.array,
        gb.attributes.uv.array,
      );
      const pa = ga.attributes.position.array,
        pb = gb.attributes.position.array,
        wa = ga.attributes.furWidth.array,
        wb = gb.attributes.furWidth.array;
      for (let rootIndex = 0; rootIndex < a.roots.length; rootIndex++) {
        const root = a.roots[rootIndex],
          other = b.roots[rootIndex];
        const smooth = (value) => {
          const t = Math.max(0, Math.min(1, (value - 0.05) / 0.4));
          return t * t * (3 - 2 * t);
        };
        const weighted = (name) =>
          old.state.membership[name][root.a] * root.u +
          old.state.membership[name][root.b] * root.v +
          old.state.membership[name][root.c] * root.w;
        const tail = smooth(weighted("tail")),
          limb = smooth(weighted("limb"));
        const lay = 1 - 0.45 * tail - 0.32 * limb * (1 - tail);
        const appendageWeight = tail + limb * (1 - tail);
        const factor = (r) => {
          if (coat !== "long" || a.name !== "body") return 1;
          const layFactor = Number.isFinite(r.appendageLay) ? lay : 1;
          const depthFactor =
            Number.isFinite(r.appendageWeight) && r.hairKind === "down"
              ? 1 - appendageWeight * 0.7 * (1 - r.downDepth * r.downDepth)
              : 1;
          return layFactor * depthFactor;
        };
        const expected = factor(other) / factor(root);
        const affected = expected !== 1;
        for (const r of [root, other])
          for (const [key, target] of [
            ["appendageLay", lay],
            ["appendageWeight", appendageWeight],
          ]) {
            if (!(key in r)) continue; // An archived implementation has no such stage.
            const cacheError = Math.abs(r[key] - target);
            max(result, "maxAnatomyCacheError", cacheError);
            result.checks.anatomyCache &&=
              Number.isFinite(cacheError) && cacheError < 1e-12;
          }
        result.checks.bindings &&=
          root.hairKind === other.hairKind &&
          root.downDepth === other.downDepth;
        max(
          result,
          "maxGainRatioError",
          Math.abs(other.__auditGain - root.__auditGain * expected),
        );
        result.checks.analyticGain &&=
          Math.abs(other.__auditGain - root.__auditGain * expected) < 1e-12 &&
          other.__auditLength === root.__auditLength;
        result.checks.finiteDerivatives &&=
          root.__auditDerivativesFinite && other.__auditDerivativesFinite;
        if (!affected) {
          const start = rootIndex * a.strandVertices * 3,
            end = start + a.strandVertices * 3;
          for (const name of ["position", "normal", "furWidth"])
            if (
              !sameBytes(
                ga.attributes[name].array.subarray(start, end),
                gb.attributes[name].array.subarray(start, end),
              )
            )
              result.checks.unchangedCohorts = false;
          continue;
        }
        result.changedAppendageRoots++;
        result.changedByKind[root.kind]++;
        result.changedByHairKind[root.hairKind]++;
        const n = root.__auditNormal;
        // An arbitrary fixed orthonormal basis spans the original root tangent plane.
        let t = Math.abs(n[1]) < 0.9 ? [n[2], 0, -n[0]] : [0, -n[2], n[1]];
        const tl = Math.hypot(...t);
        t = t.map((v) => v / tl);
        const side = [
          n[1] * t[2] - n[2] * t[1],
          n[2] * t[0] - n[0] * t[2],
          n[0] * t[1] - n[1] * t[0],
        ];
        for (let node = 0; node <= a.strandSegments; node++) {
          const vi = rootIndex * a.strandVertices + node * 2,
            o = vi * 3;
          const contact =
            node > 0 &&
            Math.min(pa[o + 1], pa[o + 4], pb[o + 1], pb[o + 4]) <=
              root.__auditFloor + 1e-6;
          if (contact) {
            result.groundContactNodesExcluded++;
            continue;
          }
          const delta = [0, 1, 2].map(
            (axis) =>
              (pb[o + axis] +
                pb[o + 3 + axis] -
                pa[o + axis] -
                pa[o + 3 + axis]) *
              0.5,
          );
          const weights = a.samples[node].value;
          let cn = 0;
          for (let k = 0; k < 4; k++)
            cn += a.longGroomCurve[rootIndex * 12 + k * 3] * weights[k + 1];
          const predicted =
            root.__auditLength * cn * (other.__auditGain - root.__auditGain);
          const radial = delta.reduce((sum, v, k) => sum + v * n[k], 0);
          max(result, "maxNormalPredictionError", Math.abs(radial - predicted));
          max(
            result,
            "maxTProjectionChange",
            Math.abs(delta.reduce((sum, v, k) => sum + v * t[k], 0)),
          );
          max(
            result,
            "maxBProjectionChange",
            Math.abs(delta.reduce((sum, v, k) => sum + v * side[k], 0)),
          );
          const radiusA = Math.hypot(wa[o], wa[o + 1], wa[o + 2]),
            radiusB = Math.hypot(wb[o], wb[o + 1], wb[o + 2]);
          max(result, "maxWidthMagnitudeChange", Math.abs(radiusA - radiusB));
          result.checkedAppendageNodes++;
        }
      }
    }
    result.checks.onlyNormalChange =
      result.maxNormalPredictionError < 3e-6 &&
      result.maxTProjectionChange < 3e-6 &&
      result.maxBProjectionChange < 3e-6;
    result.checks.widthMagnitude = result.maxWidthMagnitudeChange < 1e-8;
    for (const [name, pass] of Object.entries(result.checks))
      if (!pass) failures.push(`${coat}/${pose}/${name}`);
    cases.push(result);
  }
  const report = {
    capturedAt: new Date().toISOString(),
    old: {
      bundle: oldBundle,
      bundleSHA: old.bundleSha256,
      assetSHA: old.glbSha256,
    },
    next: {
      bundle: newBundle,
      bundleSHA: next.bundleSha256,
      assetSHA: next.glbSha256,
    },
    sourceModelUnchanged: old.glbSha256 === next.glbSha256,
    cases,
    failures,
    pass: failures.length === 0 && old.glbSha256 === next.glbSha256,
    notes: [
      "Actual archived CPU production geometry, no browser/GPU or visual quality claim.",
      "Lay cache is independently recomputed from neutral membership:1-.45*smoothstep(.05,.45,tail)-.32*smoothstep(.05,.45,limb)*(1-tailWeight). Soft anatomical transitions may affect kind0 roots; only pure trunk is protected.",
      "When a bundle contains appendageWeight, its separate down-depth stage is independently predicted as1-.7*appendageWeight*(1-downDepth^2). Comparisons use new/old total stage factors, so an existing lay stage is not applied twice.",
      "Width comparison means actual radius magnitude, not ribbon span orientation: span must rotate with the new curve tangent.",
      "T/B changes exclude nodes where either old/new ribbon is clipped by the ground; floor-clamped Y is not claimed identical.",
      "Radial prediction isolates the authored normalGain contribution; gravity, gather and tangential travel are not multiplied by the lay factor.",
    ],
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
} finally {
  old.fur.dispose();
  next.fur.dispose();
}
