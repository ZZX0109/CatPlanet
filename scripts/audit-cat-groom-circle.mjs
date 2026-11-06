/** Constant-turn circular guide candidates, no browser or production edits. */
import fs from "node:fs/promises";
import path from "node:path";
import { loadArchivedGroom } from "./cat-groom-audit-runtime.mjs";

const bundlePath =
  process.argv[2] ?? "artifacts/fur-realism/round-08/performance-probe.js";
const outputPath =
  process.argv[3] ??
  "artifacts/fur-realism/verification/guide-circle-candidates-round08.json";
globalThis.__groomCircle = null;
const runtime = await loadArchivedGroom(bundlePath, {
  transformBundle(source) {
    const needle = "        if (!longCoat) {";
    if (source.split(needle).length !== 2)
      throw new Error("Unexpected long-coat evaluation structure.");
    return source.replace(
      needle,
      `
        if (longCoat && region.name === 'body' && root.hairKind === 'down' && root.kind !== 1 && globalThis.__groomCircle) {
          const circle = globalThis.__groomCircle;
          const A = circle.amplitude[strand];
          const q = circle.samples[sample];
          cn = A * q.n;
          ct = A * q.t * circle.downClassTScale;
          dn = A * q.dn;
          dt = A * q.dt * circle.downClassTScale;
        }
${needle}`,
    );
  },
});
const { api, model, fur, state, bounds, mmPerUnit } = runtime;
const region = state.regions.find((r) => r.name === "body"),
  samples = region.samples;
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
function circleSamples(start, end) {
  const a = start * degree,
    d = (start - end) * degree;
  return Array.from({ length: 9 }, (_, i) => {
    const t = i / 8,
      theta = a - d * t;
    return {
      n: (Math.cos(theta) - Math.cos(a)) / d,
      t: (Math.sin(a) - Math.sin(theta)) / d,
      dn: Math.sin(theta),
      dt: Math.cos(theta),
    };
  });
}
function arc2d(points) {
  let length = 0;
  for (let i = 1; i < points.length; i++)
    length += Math.hypot(
      points[i][0] - points[i - 1][0],
      points[i][1] - points[i - 1][1],
    );
  return length;
}
const back = region.mesh.userData.canonicalGroom.guides.find(
  (g) => g.name === "back-ridge",
).longKnots;
// Preparing a long layout provides the exact production eight-sample Hermite weights.
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
const canonical = region.samples.map((s) => [
  s.value.slice(1).reduce((sum, w, k) => sum + w * back[k * 3], 0),
  s.value.slice(1).reduce((sum, w, k) => sum + w * back[k * 3 + 1], 0),
]);
const oldPeak = Math.max(...canonical.map((p) => p[0])),
  oldArc = arc2d(canonical),
  grid = [];
for (const start of [70, 75, 80, 85])
  for (const end of [-30, -25, -20, -15, -10, -5, 0, 5, 10]) {
    const curve = circleSamples(start, end),
      unitPeak = Math.max(...curve.map((s) => s.n)),
      A = oldPeak / unitPeak,
      arc = arc2d(curve.map((s) => [A * s.n, A * s.t])),
      arcError = arc / oldArc - 1;
    grid.push({
      id: `${start}to${end}`,
      start,
      end,
      A,
      peak: oldPeak,
      arc,
      arcError,
      turnPerJoint: (start - end) / 8,
      eligible: Math.abs(arcError) <= 0.1,
      tipN: A * curve.at(-1).n,
      tipT: A * curve.at(-1).t,
    });
  }
const eligible = grid.filter((c) => c.eligible);
const selections = [
  [...eligible].sort(
    (a, b) =>
      a.turnPerJoint - b.turnPerJoint ||
      Math.abs(a.arcError) - Math.abs(b.arcError),
  )[0],
  [...eligible].sort(
    (a, b) =>
      Math.abs(a.arcError) - Math.abs(b.arcError) ||
      a.turnPerJoint - b.turnPerJoint,
  )[0],
  eligible.find((c) => c.start === 80 && c.end === -20),
]
  .filter((c, i, all) => c && all.findIndex((x) => x?.id === c.id) === i)
  .slice(0, 3);
const report = {
  capturedAt: new Date().toISOString(),
  bundle: bundlePath,
  bundleSha256: runtime.bundleSha256,
  glbSha256: runtime.glbSha256,
  canonical: {
    reference:
      "actual back-ridge longKnots, 8-sample production Hermite, N/T plane only",
    peak: oldPeak,
    arc: oldArc,
    points: canonical,
  },
  method:
    "Actual archived runtime regenerated with an in-memory analytic constant-turn N/T guide only for long trunk/tail down. A matches each root's existing sampled canonical N crest. down N-loft .94 and T-lay .84 are retained by the ratio .84/.94 on T. Original B offsets, crimp, clump, gravity, physical length parameters, skin, roots and all other cohorts stay fixed.",
  circle:
    "theta=start-(start-end)*t; N=A*(cos(theta)-cos(start))/delta; T=A*(sin(start)-sin(theta))/delta. Derivatives A*sin(theta), A*cos(theta) are used in actual geometry generation.",
  limitations:
    "The author N/T plane is circular before the existing anatomical/shaft gains. B/crimp and transported skin make the final strand generally non-planar. Local radial clearance is not whole-body collision/SDF proof.",
  grid,
  selections,
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
        const curve = circleSamples(candidate.start, candidate.end),
          peak = Math.max(...curve.map((s) => s.n)),
          amplitude = new Float64Array(region.roots.length);
        for (let i = 0; i < region.roots.length; i++) {
          const root = region.roots[i];
          if (root.hairKind !== "down" || root.kind === 1) continue;
          const o = i * 12;
          const oldPeak = Math.max(
            ...region.samples.map((sample) =>
              sample.value
                .slice(1)
                .reduce(
                  (sum, w, k) => sum + w * region.longGroomCurve[o + k * 3],
                  0,
                ),
            ),
          );
          amplitude[i] = oldPeak / peak;
        }
        globalThis.__groomCircle = {
          samples: curve,
          amplitude,
          downClassTScale: 0.84 / 0.94,
        };
      } else globalThis.__groomCircle = null;
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
        arcRatio = [];
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
          largest = Math.max(largest, angle);
          if (angle > 30) above30++;
        }
        maxAngles.push(largest);
      }
      report.rows.push({
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
    JSON.stringify({ outputPath, selections, rows: report.rows }, null, 2),
  );
} finally {
  globalThis.__groomCircle = null;
  model.dispose();
}
