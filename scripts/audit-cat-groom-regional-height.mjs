/** Read-only source-geometry attribution of raised body/ruff fibres. No browser. */
import fs from "node:fs/promises";
import { loadArchivedGroom } from "./cat-groom-audit-runtime.mjs";

const bundle =
  process.argv[2] ?? "artifacts/fur-realism/round-08/performance-probe.js";
const output =
  process.argv[3] ??
  "artifacts/fur-realism/verification/regional-height-round08.json";
const runtime = await loadArchivedGroom(bundle);
const { api, model, fur, state, mmPerUnit } = runtime;
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
const report = {
  capturedAt: new Date().toISOString(),
  bundle,
  bundleSha256: runtime.bundleSha256,
  glbSha256: runtime.glbSha256,
  scale: "Assumed 300mm skin height, not author-supplied calibration.",
  caveat:
    "Npeak is maximum signed projection from real barycentric skin root to the sampled centreline along the root skin normal. Euclidean displacement also contains tangential sweep. Neither is whole-body closest-surface clearance or collision proof.",
  cohorts: {
    back: "body non-appendage root.kind0 and skin normal.y>.7",
    flank:
      "body non-appendage root.kind0, abs(skin normal.x)>.7, skin normal.y<=.7",
    tail: "root.kind2",
    region:
      "every active source strand in each head/ruff/body region; kinds fixed by compound-patch sampling",
  },
  profiles: [],
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
      for (const region of ["head", "ruff", "body"])
        for (const p of ["FurDensity", "FurLength"])
          design.shape[region + p] = 100;
    api.applyCreatorDesign(model, design);
    fur.refresh({ full: true });
    const groups = new Map(),
      outliers = [];
    for (const region of state.regions) {
      const positions = region.mesh.geometry.attributes.position;
      const widths = region.mesh.geometry.attributes.furWidth;
      const count = region.mesh.userData.strandCount,
        stride = region.strandVertices,
        segments = region.strandSegments;
      for (let i = 0; i < count; i++) {
        const root = region.roots[i];
        const skin = [0, 0, 0],
          normal = [0, 0, 0];
        for (let axis = 0; axis < 3; axis++) {
          skin[axis] =
            state.evaluated[root.a * 3 + axis] * root.u +
            state.evaluated[root.b * 3 + axis] * root.v +
            state.evaluated[root.c * 3 + axis] * root.w;
          normal[axis] =
            state.normals[root.a * 3 + axis] * root.u +
            state.normals[root.b * 3 + axis] * root.v +
            state.normals[root.c * 3 + axis] * root.w;
        }
        const nl = Math.hypot(...normal);
        for (let a = 0; a < 3; a++) normal[a] /= nl;
        let arc = 0,
          peak = -Infinity,
          maxDistance = 0,
          previous = null;
        for (let node = 0; node <= segments; node++) {
          const v = i * stride + node * 2;
          const p = [0, 1, 2].map(
            (axis) =>
              (positions.getComponent(v, axis) +
                positions.getComponent(v + 1, axis)) *
              0.5,
          );
          const delta = p.map((value, axis) => value - skin[axis]);
          peak = Math.max(
            peak,
            delta.reduce((sum, value, axis) => sum + value * normal[axis], 0),
          );
          maxDistance = Math.max(maxDistance, Math.hypot(...delta));
          if (previous)
            arc += Math.hypot(
              ...p.map((value, axis) => value - previous[axis]),
            );
          previous = p;
        }
        const names = [region.name];
        if (region.name === "body") {
          if (root.kind === 0 && normal[1] > 0.7) names.push("back");
          if (root.kind === 0 && Math.abs(normal[0]) > 0.7 && normal[1] <= 0.7)
            names.push("flank");
          if (root.kind === 2) names.push("tail");
        }
        const peakMm = peak * mmPerUnit,
          arcMm = arc * mmPerUnit,
          euclideanMm = maxDistance * mmPerUnit;
        const vertex = i * stride;
        const rootWidthMm =
          Math.hypot(
            widths.getX(vertex),
            widths.getY(vertex),
            widths.getZ(vertex),
          ) *
          2 *
          mmPerUnit;
        for (const name of names)
          for (const kind of ["all", root.hairKind]) {
            const key = name + "/" + kind;
            if (!groups.has(key))
              groups.set(key, {
                name,
                kind,
                arc: [],
                peak: [],
                distance: [],
                width: [],
                above10: 0,
                above20: 0,
                above30: 0,
                above40: 0,
              });
            const group = groups.get(key);
            group.arc.push(arcMm);
            group.peak.push(peakMm);
            group.distance.push(euclideanMm);
            group.width.push(rootWidthMm);
            if (peakMm > 10) group.above10++;
            if (peakMm > 20) group.above20++;
            if (peakMm > 30) group.above30++;
            if (peakMm > 40) group.above40++;
          }
        if (names.includes("back") || names.includes("flank"))
          outliers.push({
            region: region.name,
            cohort: names.slice(1),
            kind: root.hairKind,
            index: i,
            peakNormalMm: peakMm,
            arcLengthMm: arcMm,
            euclideanMm,
            skin,
            normal,
            rootWidthMm,
          });
      }
    }
    outliers.sort((a, b) => b.peakNormalMm - a.peakNormalMm);
    report.profiles.push({
      profile: maximum ? "long-maximum" : "long-default",
      groups: [...groups.values()].map((g) => ({
        cohort: g.name,
        kind: g.kind,
        count: g.arc.length,
        arcLengthMm: distribution(g.arc),
        peakNormalMm: distribution(g.peak),
        maximumEuclideanMm: distribution(g.distance),
        rootDiameterMm: distribution(g.width),
        above10Mm: g.above10,
        above20Mm: g.above20,
        above30Mm: g.above30,
        above40Mm: g.above40,
      })),
      topBackFlankOutliers: outliers.slice(0, 24),
    });
  }
  await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        output,
        rows: report.profiles.map((p) => ({
          profile: p.profile,
          groups: p.groups
            .filter((g) => ["back", "flank", "ruff"].includes(g.cohort))
            .map((g) => ({
              cohort: g.cohort,
              kind: g.kind,
              count: g.count,
              peakMed: g.peakNormalMm.median,
              peak95: g.peakNormalMm.p95,
              peakMax: g.peakNormalMm.max,
              arcMed: g.arcLengthMm.median,
              arc95: g.arcLengthMm.p95,
              above20: g.above20Mm,
              above30: g.above30Mm,
            })),
        })),
      },
      null,
      2,
    ),
  );
} finally {
  model.dispose();
}
