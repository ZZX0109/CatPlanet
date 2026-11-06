/** B-spline mathematical candidates, evaluated on archived real geometry only. */
import fs from "node:fs/promises";
import path from "node:path";
import { loadArchivedGroom } from "./cat-groom-audit-runtime.mjs";

const bundlePath =
  process.argv[2] ?? "artifacts/fur-realism/round-08/performance-probe.js";
const outputPath =
  process.argv[3] ??
  "artifacts/fur-realism/verification/guide-bspline-candidates-round08.json";
globalThis.__groomCandidateSamples = null;
const runtime = await loadArchivedGroom(bundlePath, {
  transformBundle(source) {
    const needle = "region.samples[sample]";
    if (source.split(needle).length !== 2)
      throw new Error("Unexpected archived sample lookup.");
    return source.replace(
      needle,
      "(region.name === 'body' && root.hairKind === 'down' && root.kind !== 1 && globalThis.__groomCandidateSamples ? globalThis.__groomCandidateSamples[sample] : region.samples[sample])",
    );
  },
});
const { api, model, fur, state, bounds, mmPerUnit } = runtime;
const region = state.regions.find((r) => r.name === "body"),
  original = region.longGroomCurve.slice();
const knots = [0, 0, 0, 0, 0.5, 1, 1, 1, 1],
  greville = [0, 1 / 6, 0.5, 5 / 6, 1];
function basis(i, p, t) {
  if (p === 0)
    return (t >= knots[i] && t < knots[i + 1]) || (t === 1 && i === 4) ? 1 : 0;
  const left = knots[i + p] - knots[i],
    right = knots[i + p + 1] - knots[i + 1];
  return (
    (left ? ((t - knots[i]) / left) * basis(i, p - 1, t) : 0) +
    (right ? ((knots[i + p + 1] - t) / right) * basis(i + 1, p - 1, t) : 0)
  );
}
function derivative(i, t) {
  const left = knots[i + 3] - knots[i],
    right = knots[i + 4] - knots[i + 1];
  return (
    (left ? (3 / left) * basis(i, 2, t) : 0) -
    (right ? (3 / right) * basis(i + 1, 2, t) : 0)
  );
}
const distribution = (values) => {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const at = (p) => values[Math.floor((values.length - 1) * p)];
  return {
    min: at(0),
    median: at(0.5),
    p05: at(0.05),
    p95: at(0.95),
    p99: at(0.99),
    max: at(1),
  };
};
const report = {
  capturedAt: new Date().toISOString(),
  bundle: bundlePath,
  bundleSha256: runtime.bundleSha256,
  glbSha256: runtime.glbSha256,
  method:
    "Archived actual production groom; only long body trunk/tail down uses an in-memory clamped cubic B-spline with five controls p0=0 and four canonical offsets. All endpoints/T/B control values, roots, length parameters, hair amount and other hair families remain fixed; actual CPU geometry is regenerated.",
  knots,
  normalization:
    "For inner N controls only: linear endpoint chord + scale*(original N - chord), using Greville abscissae. Per-root scale needed to retain the old eight-sample crest is calculated, then capped at1.2; endpoint N remains unchanged. Positive control values imply positive B-spline radial convex hull, not whole-body collision clearance.",
  volumeNote:
    "Local root skin-normal envelope proxy; illustrative 300mm cat height; no rendered realism certification.",
  rows: [],
};
model.motion.setBreathing(false);
model.motion.setIdleBlink(false);
try {
  for (const maximum of [false, true]) {
    const design = {
      ...api.defaultCreatorDesign,
      coatType: "long",
      shape: {
        ...api.defaultCreatorDesign.shape,
        ...api.getCatCoatProfile("long").defaults,
      },
    };
    if (maximum)
      for (const r of ["head", "ruff", "body"])
        for (const p of ["FurDensity", "FurLength"]) design.shape[r + p] = 100;
    globalThis.__groomCandidateSamples = null;
    region.longGroomCurve.set(original);
    api.applyCreatorDesign(model, design);
    fur.refresh({ full: true });
    const splineSamples = region.samples.map((sample) => ({
      ...sample,
      value: Array.from({ length: 5 }, (_, i) => basis(i, 3, sample.t)),
      derivative: Array.from({ length: 5 }, (_, i) => derivative(i, sample.t)),
    }));
    const baselinePeak = new Float64Array(region.roots.length);
    for (const candidate of [
      "Hermite-current",
      "B-spline-no-normalization",
      "B-spline-normalization-capped1.2",
    ]) {
      globalThis.__groomCandidateSamples =
        candidate === "Hermite-current" ? null : splineSamples;
      region.longGroomCurve.set(original);
      const requiredScale = [],
        appliedScale = [];
      let capped = 0,
        negativeControls = 0;
      if (candidate === "B-spline-normalization-capped1.2")
        for (let i = 0; i < region.roots.length; i++) {
          const root = region.roots[i];
          if (root.hairKind !== "down" || root.kind === 1) continue;
          const o = i * 12,
            tip = original[o + 9];
          const oldPeak = Math.max(
            ...region.samples.map((sample) =>
              sample.value
                .slice(1)
                .reduce((sum, w, k) => sum + w * original[o + k * 3], 0),
            ),
          );
          const crest = (scale) =>
            Math.max(
              ...splineSamples.map((sample) =>
                sample.value.slice(1).reduce((sum, w, k) => {
                  const chord = tip * greville[k + 1];
                  return (
                    sum + w * (chord + scale * (original[o + k * 3] - chord))
                  );
                }, 0),
              ),
            );
          let lo = 1,
            hi = 3;
          for (let j = 0; j < 18; j++) {
            const mid = (lo + hi) * 0.5;
            if (crest(mid) < oldPeak) lo = mid;
            else hi = mid;
          }
          const required = crest(1) >= oldPeak ? 1 : hi,
            applied = Math.min(1.2, required);
          requiredScale.push(required);
          appliedScale.push(applied);
          if (required > 1.2) capped++;
          for (let k = 0; k < 3; k++) {
            const chord = tip * greville[k + 1];
            region.longGroomCurve[o + k * 3] =
              chord + applied * (original[o + k * 3] - chord);
            if (region.longGroomCurve[o + k * 3] < 0) negativeControls++;
          }
        }
      region.pendingFull = true;
      fur.refresh({ full: true });
      const geometry = region.mesh.geometry,
        p = geometry.attributes.position,
        stride = region.mesh.userData.strandVertices,
        segments = region.mesh.userData.strandSegments,
        count = region.mesh.userData.strandCount,
        centers = new Float64Array((segments + 1) * 3),
        angles = [],
        maxAngles = [],
        arc = [],
        peak = [],
        clearance = [],
        peakRatio = [];
      let roots = 0,
        clipped = 0,
        above30 = 0,
        volumeBelow095 = 0,
        volumeBelow098 = 0;
      for (let i = 0; i < count; i++) {
        const root = region.roots[i];
        if (root.hairKind !== "down" || root.kind === 1) continue;
        const a = root.a * 3,
          b = root.b * 3,
          c = root.c * 3;
        let nx =
            state.normals[a] * root.u +
            state.normals[b] * root.v +
            state.normals[c] * root.w,
          ny =
            state.normals[a + 1] * root.u +
            state.normals[b + 1] * root.v +
            state.normals[c + 1] * root.w,
          nz =
            state.normals[a + 2] * root.u +
            state.normals[b + 2] * root.v +
            state.normals[c + 2] * root.w;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        let ground = false,
          length = 0,
          height = 0,
          minHeight = Infinity;
        for (let j = 0; j <= segments; j++) {
          const vertex = i * stride + j * 2,
            o = j * 3;
          centers[o] = (p.getX(vertex) + p.getX(vertex + 1)) * 0.5;
          centers[o + 1] = (p.getY(vertex) + p.getY(vertex + 1)) * 0.5;
          centers[o + 2] = (p.getZ(vertex) + p.getZ(vertex + 1)) * 0.5;
          if (j > 0)
            length += Math.hypot(
              centers[o] - centers[o - 3],
              centers[o + 1] - centers[o - 2],
              centers[o + 2] - centers[o - 1],
            );
          const radial =
            (centers[o] - centers[0]) * nx +
            (centers[o + 1] - centers[1]) * ny +
            (centers[o + 2] - centers[2]) * nz +
            0.00045;
          height = Math.max(height, radial);
          minHeight = Math.min(minHeight, radial);
          if (
            j > 0 &&
            Math.min(p.getY(vertex), p.getY(vertex + 1)) <=
              bounds.min.y + 0.002 + 1e-6
          )
            ground = true;
        }
        if (candidate === "Hermite-current") baselinePeak[i] = height;
        if (ground) {
          clipped++;
          continue;
        }
        roots++;
        arc.push(length * mmPerUnit);
        peak.push(height * mmPerUnit);
        clearance.push(minHeight * mmPerUnit);
        if (candidate !== "Hermite-current") {
          const r = height / baselinePeak[i];
          peakRatio.push(r);
          if (r < 0.95) volumeBelow095++;
          if (r < 0.98) volumeBelow098++;
        }
        let maximumAngle = 0;
        for (let j = 1; j < segments; j++) {
          const a = (j - 1) * 3,
            b = j * 3,
            c = (j + 1) * 3,
            ax = centers[b] - centers[a],
            ay = centers[b + 1] - centers[a + 1],
            az = centers[b + 2] - centers[a + 2],
            bx = centers[c] - centers[b],
            by = centers[c + 1] - centers[b + 1],
            bz = centers[c + 2] - centers[b + 2],
            product = Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz);
          if (product < 1e-14) continue;
          const angle =
            (Math.acos(
              Math.max(
                -1,
                Math.min(1, (ax * bx + ay * by + az * bz) / product),
              ),
            ) *
              180) /
            Math.PI;
          angles.push(angle);
          maximumAngle = Math.max(maximumAngle, angle);
          if (angle > 30) above30++;
        }
        maxAngles.push(maximumAngle);
      }
      report.rows.push({
        profile: maximum ? "long-maximum" : "long-default",
        candidate,
        roots,
        groundClipped: clipped,
        adjacentDegrees: distribution(angles),
        maximumPerStrandDegrees: distribution(maxAngles),
        fractionJointAbove30: above30 / angles.length,
        arcLengthMm: distribution(arc),
        peakNormalMm: distribution(peak),
        minNormalClearanceMm: distribution(clearance),
        perRootPeakRatioToCurrent: distribution(peakRatio),
        requiredScale: distribution(requiredScale),
        appliedScale: distribution(appliedScale),
        capHitCount: capped,
        negativeNControls: negativeControls,
        volumeBelow095,
        volumeBelow098,
      });
    }
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ outputPath, rows: report.rows }, null, 2));
} finally {
  globalThis.__groomCandidateSamples = null;
  model.dispose();
}
