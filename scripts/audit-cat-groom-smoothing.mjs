/** Mathematical candidates on an archived groom cache, never runtime edits. */
import fs from "node:fs/promises";
import path from "node:path";
import { loadArchivedGroom } from "./cat-groom-audit-runtime.mjs";

const bundlePath =
  process.argv[2] ?? "artifacts/fur-realism/round-08/performance-probe.js";
const outputPath =
  process.argv[3] ??
  "artifacts/fur-realism/verification/guide-smoothing-candidates-round08.json";
const runtime = await loadArchivedGroom(bundlePath);
const { api, model, fur, state, bounds, mmPerUnit } = runtime;
const region = state.regions.find((r) => r.name === "body");
const original = region.longGroomCurve.slice();
const distribution = (values) => {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const at = (p) => values[Math.floor((values.length - 1) * p)];
  return {
    min: at(0),
    median: at(0.5),
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
    "In-memory changes to archived long trunk/tail DOWN guide cache only; original skin, roots, N/T/B, samples, length parameters, phase, materials, other hair types are retained. No production source/asset modifications.",
  candidate:
    "Keep N knots1–3 and every T/B knot; raise fourth N knot to at least r*max(N2,N3), reducing the tight return bend while preserving the existing crest.",
  volumeNote:
    "Peak projection along each barycentric root skin normal is a local envelope proxy, not physical volumetric/SDF validation. Height300mm is illustrative.",
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
    const baselinePeak = new Float64Array(region.roots.length);
    for (const ratio of [null, 0.88, 0.96]) {
      region.longGroomCurve.set(original);
      if (ratio !== null)
        for (let i = 0; i < region.roots.length; i++) {
          const root = region.roots[i];
          if (root.hairKind !== "down" || root.kind === 1) continue;
          const o = i * 12;
          region.longGroomCurve[o + 9] = Math.max(
            original[o + 9],
            Math.max(original[o + 3], original[o + 6]) * ratio,
          );
        }
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
        peakRatio = [];
      let clipped = 0,
        roots = 0,
        above30 = 0;
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
        const px =
            state.evaluated[a] * root.u +
            state.evaluated[b] * root.v +
            state.evaluated[c] * root.w,
          py =
            state.evaluated[a + 1] * root.u +
            state.evaluated[b + 1] * root.v +
            state.evaluated[c + 1] * root.w,
          pz =
            state.evaluated[a + 2] * root.u +
            state.evaluated[b + 2] * root.v +
            state.evaluated[c + 2] * root.w;
        let ground = false,
          length = 0,
          height = 0;
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
          height = Math.max(
            height,
            (centers[o] - px) * nx +
              (centers[o + 1] - py) * ny +
              (centers[o + 2] - pz) * nz,
          );
          if (
            j > 0 &&
            Math.min(p.getY(vertex), p.getY(vertex + 1)) <=
              bounds.min.y + 0.002 + 1e-6
          )
            ground = true;
        }
        if (ratio === null) baselinePeak[i] = height;
        if (ground) {
          clipped++;
          continue;
        }
        roots++;
        arc.push(length * mmPerUnit);
        peak.push(height * mmPerUnit);
        if (ratio !== null)
          peakRatio.push(height / Math.max(1e-9, baselinePeak[i]));
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
        candidate: ratio === null ? "current" : `tip-N>=${ratio}*crest`,
        roots,
        groundClipped: clipped,
        adjacentDegrees: distribution(angles),
        maximumPerStrandDegrees: distribution(maxAngles),
        fractionJointAbove30: above30 / angles.length,
        arcLengthMm: distribution(arc),
        peakNormalMm: distribution(peak),
        perRootPeakRatioToCurrent: distribution(peakRatio),
      });
    }
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ outputPath, rows: report.rows }, null, 2));
} finally {
  model.dispose();
}
