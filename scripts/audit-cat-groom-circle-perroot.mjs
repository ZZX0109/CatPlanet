/** Per-root constant-turn circular guide fits, no browser or production edits. */
import fs from "node:fs/promises";
import path from "node:path";
import { loadArchivedGroom } from "./cat-groom-audit-runtime.mjs";

const bundlePath =
  process.argv[2] ?? "artifacts/fur-realism/round-08/performance-probe.js";
const outputPath =
  process.argv[3] ??
  "artifacts/fur-realism/verification/guide-circle-perroot-round08.json";
globalThis.__groomPerRootCircle = null;
const runtime = await loadArchivedGroom(bundlePath, {
  transformBundle(source) {
    const needle = "        if (!longCoat) {";
    if (source.split(needle).length !== 2)
      throw new Error("Unexpected long-coat evaluation structure.");
    return source.replace(
      needle,
      `
        if (longCoat && region.name === 'body' && root.hairKind === 'down' && root.kind !== 1 && globalThis.__groomPerRootCircle) {
          const fit = globalThis.__groomPerRootCircle[strand];
          if (fit && !fit.unfittable) {
            const theta = fit.start-fit.delta*region.samples[sample].t;
            cn = fit.R*(Math.cos(theta)-Math.cos(fit.start))/fit.normalGain;
            ct = fit.R*(Math.sin(fit.start)-Math.sin(theta))/fit.forwardGain;
            dn = fit.arc*Math.sin(theta)/fit.normalGain;
            dt = fit.arc*Math.cos(theta)/fit.forwardGain;
          }
        }
${needle}`,
    );
  },
});
const { api, model, fur, state, bounds, mmPerUnit } = runtime;
const region = state.regions.find((r) => r.name === "body");
const distribution = (values) => {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const at = (p) => values[Math.floor((values.length - 1) * p)];
  return {
    min: at(0),
    p05: at(0.05),
    median: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: at(1),
  };
};
const degree = Math.PI / 180;
function arc2d(points) {
  let length = 0;
  for (let i = 1; i < points.length; i++)
    length += Math.hypot(
      points[i][0] - points[i - 1][0],
      points[i][1] - points[i - 1][1],
    );
  return length;
}
const baseDesign = {
  ...api.defaultCreatorDesign,
  coatType: "long",
  shape: {
    ...api.defaultCreatorDesign.shape,
    ...api.getCatCoatProfile("long").defaults,
  },
};
api.applyCreatorDesign(model, baseDesign);
fur.refresh({ full: true });
const forwardGain = api.getCatCoatProfile("long").groom.tangent + 0.1;
function fitRoot(root, index, mode) {
  const normalGain = root.hairLift,
    o = index * 12;
  const points = region.samples.map((sample) => {
    let n = 0,
      t = 0;
    for (let k = 0; k < 4; k++) {
      n += sample.value[k + 1] * region.longGroomCurve[o + k * 3] * normalGain;
      t +=
        sample.value[k + 1] *
        region.longGroomCurve[o + k * 3 + 1] *
        forwardGain;
    }
    return [n, t];
  });
  const peak = Math.max(...points.map((p) => p[0])),
    arc = arc2d(points),
    rho = peak / arc;
  const oldTipRatio = points.at(-1)[0] / peak;
  let best = null;
  for (let degrees = 20; degrees <= 85; degrees += 0.25) {
    const start = degrees * degree,
      delta = (1 - Math.cos(start)) / rho,
      end = start - delta;
    if (end > 1e-10 || end < -start - 1e-10 || delta >= 120 * degree) continue;
    const R = arc / delta;
    const tipRatio = (Math.cos(end) - Math.cos(start)) / (1 - Math.cos(start));
    const score =
      mode === "minimum-turn"
        ? delta
        : Math.abs(tipRatio - oldTipRatio) + delta * 0.0001;
    if (best && best.score <= score) continue;
    const samplePeak = Math.max(
      ...region.samples.map(
        (s) => R * (Math.cos(start - delta * s.t) - Math.cos(start)),
      ),
    );
    best = {
      start,
      end,
      delta,
      R,
      score,
      arc,
      peak,
      rho,
      tipRatio,
      oldTipRatio,
      samplePeak,
      normalGain,
      forwardGain,
      sampledArc: (arc * Math.sin(delta / 16)) / (delta / 16),
    };
  }
  return best ?? { arc, peak, rho, oldTipRatio, unfittable: true };
}
const selections = [{ id: "minimum-turn" }, { id: "preserve-tip-clearance" }];
const report = {
  capturedAt: new Date().toISOString(),
  bundle: bundlePath,
  bundleSha256: runtime.bundleSha256,
  glbSha256: runtime.glbSha256,
  method:
    "Per-root circular fit in the weighted original N/T plane: original eight-segment guide arc and sampled radial crest use root.hairLift and groom.tangent+.1. rho=Npeak/Arc; delta=(1-cos(theta0))/rho, theta1=theta0-delta, R=Arc/delta. theta0 grid20..85 degrees step.25, theta1 in[-theta0,0], delta<120degrees. Candidate continuous N/T arc and crest exactly equal the old sampled guide targets; rendered eight-segment chord is slightly shorter and may not sample the exact crest. Keep each root's original B curve, physical length, wave, gravity, clump, morph/pose and outer/short/ruff geometry. No valid circle => retain original guide.",
  candidates: selections.map((s) => ({
    id: s.id,
    objective:
      s.id === "minimum-turn"
        ? "Minimize constant curvature delta."
        : "Minimize difference from original tip-N/crest ratio, then delta; does not move the original crest target.",
  })),
  limitation:
    "This is only a Node geometry candidate, not a rendered realism result. No whole-body collision/SDF proof. Continuous guide targets differ from final 3D geometry because of unchanged B/wave/gravity/clump. Runtime/source/assets are not edited.",
  fits: [],
  rows: [],
};
model.motion.setBreathing(false);
model.motion.setIdleBlink(false);
try {
  for (const maximum of [false, true]) {
    const design = { ...baseDesign, shape: { ...baseDesign.shape } };
    if (maximum)
      for (const r of ["head", "ruff", "body"])
        for (const p of ["FurDensity", "FurLength"]) design.shape[r + p] = 100;
    const baselinePeak = new Float64Array(region.roots.length),
      baselineArc = new Float64Array(region.roots.length);
    for (const candidate of [null, ...selections]) {
      if (candidate) {
        const fits = region.roots.map((root, i) =>
          root.hairKind === "down" && root.kind !== 1
            ? fitRoot(root, i, candidate.id)
            : null,
        );
        globalThis.__groomPerRootCircle = fits;
        const current = fits
            .slice(0, region.mesh.userData.strandCount)
            .filter(Boolean),
          valid = current.filter((f) => !f.unfittable);
        report.fits.push({
          profile: maximum ? "long-maximum" : "long-default",
          candidate: candidate.id,
          cohort: current.length,
          fitted: valid.length,
          fallback: current.length - valid.length,
          rho: distribution(current.map((f) => f.rho)),
          startDegrees: distribution(valid.map((f) => f.start / degree)),
          endDegrees: distribution(valid.map((f) => f.end / degree)),
          turnDegrees: distribution(valid.map((f) => f.delta / degree)),
          continuousArcRatio: distribution(
            valid.map((f) => (f.R * f.delta) / f.arc),
          ),
          continuousCrestRatio: distribution(
            valid.map((f) => (f.R * (1 - Math.cos(f.start))) / f.peak),
          ),
          sampledArcRatio: distribution(valid.map((f) => f.sampledArc / f.arc)),
          sampledCrestRatio: distribution(
            valid.map((f) => f.samplePeak / f.peak),
          ),
          tipClearanceTargetError: distribution(
            valid.map((f) => f.tipRatio - f.oldTipRatio),
          ),
        });
      } else globalThis.__groomPerRootCircle = null;
      region.pendingFull = true;
      api.applyCreatorDesign(model, design);
      fur.refresh({ full: true });
      const p = region.mesh.geometry.attributes.position,
        stride = region.mesh.userData.strandVertices,
        segments = region.mesh.userData.strandSegments,
        count = region.mesh.userData.strandCount,
        centers = new Float64Array((segments + 1) * 3),
        angles = [],
        maxAngles = [],
        arc = [],
        peak = [],
        minimum = [],
        peakRatio = [],
        arcRatio = [],
        groups = new Map();
      let roots = 0,
        clipped = 0,
        above30 = 0,
        belowPeak095 = 0,
        arcOutside010 = 0,
        arcOutside005 = 0;
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
        if (!candidate) {
          baselinePeak[i] = height;
          baselineArc[i] = length;
        }
        if (ground) {
          clipped++;
          continue;
        }
        roots++;
        arc.push(length * mmPerUnit);
        peak.push(height * mmPerUnit);
        minimum.push(minHeight * mmPerUnit);
        if (candidate) {
          const r = height / baselinePeak[i],
            l = length / baselineArc[i];
          peakRatio.push(r);
          arcRatio.push(l);
          if (r < 0.95) belowPeak095++;
          if (Math.abs(l - 1) > 0.1) arcOutside010++;
          if (Math.abs(l - 1) > 0.05) arcOutside005++;
        }
        const fit = globalThis.__groomPerRootCircle?.[i];
        const fitGroup = fit && !fit.unfittable ? "fitted" : "fallback";
        const anatomy = root.kind === 2 ? "tail" : "trunk";
        const selectedGroups = [anatomy];
        if (candidate) selectedGroups.push(fitGroup, anatomy + "-" + fitGroup);
        const subgroupData = selectedGroups.map((name) => {
          if (!groups.has(name))
            groups.set(name, {
              name,
              roots: 0,
              angles: [],
              maximum: [],
              arc: [],
              peak: [],
              arcRatio: [],
              peakRatio: [],
            });
          const g = groups.get(name);
          g.roots++;
          g.arc.push(length * mmPerUnit);
          g.peak.push(height * mmPerUnit);
          if (candidate) {
            g.arcRatio.push(length / baselineArc[i]);
            g.peakRatio.push(height / baselinePeak[i]);
          }
          return g;
        });
        let largest = 0;
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
            Math.acos(
              Math.max(
                -1,
                Math.min(1, (ax * bx + ay * by + az * bz) / product),
              ),
            ) / degree;
          angles.push(angle);
          for (const g of subgroupData) g.angles.push(angle);
          largest = Math.max(largest, angle);
          if (angle > 30) above30++;
        }
        maxAngles.push(largest);
        for (const g of subgroupData) g.maximum.push(largest);
      }
      report.rows.push({
        subgroups: [...groups.values()].map((g) => ({
          name: g.name,
          roots: g.roots,
          adjacentDegrees: distribution(g.angles),
          maximumPerStrandDegrees: distribution(g.maximum),
          arcLengthMm: distribution(g.arc),
          peakNormalMm: distribution(g.peak),
          perRootArcRatio: distribution(g.arcRatio),
          perRootPeakRatio: distribution(g.peakRatio),
        })),
        profile: maximum ? "long-maximum" : "long-default",
        candidate: candidate?.id ?? "current",
        roots,
        groundClipped: clipped,
        adjacentDegrees: distribution(angles),
        maximumPerStrandDegrees: distribution(maxAngles),
        fractionJointAbove30: above30 / angles.length,
        arcLengthMm: distribution(arc),
        peakNormalMm: distribution(peak),
        minNormalClearanceMm: distribution(minimum),
        perRootPeakRatio: distribution(peakRatio),
        perRootArcRatio: distribution(arcRatio),
        belowPeak095,
        arcOutside010,
        arcOutside005,
      });
    }
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify(
      { outputPath, fits: report.fits, rows: report.rows },
      null,
      2,
    ),
  );
} finally {
  globalThis.__groomPerRootCircle = null;
  model.dispose();
}
