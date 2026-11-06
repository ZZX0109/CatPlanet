/** Read-only collar comparison on the actual frozen source groom. No GPU. */
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadArchivedGroom } from "./cat-groom-audit-runtime.mjs";

const bundles = {
  before: "artifacts/fur-realism/round-09/performance-probe.js",
  after: "artifacts/fur-realism/round-10/collar-probe.js",
};
const output = "artifacts/fur-realism/round-10/collar-check.json";
const hash = (a) =>
  createHash("sha256")
    .update(Buffer.from(a.buffer, a.byteOffset, a.byteLength))
    .digest("hex");
const summaries = {};
const raw = {};
const distance = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]));
const distribution = (v) => {
  v.sort((a, b) => a - b);
  const at = (p) => v[Math.floor((v.length - 1) * p)];
  return v.length
    ? {
        count: v.length,
        min: at(0),
        p05: at(0.05),
        median: at(0.5),
        p95: at(0.95),
        max: at(1),
      }
    : null;
};
for (const [label, bundle] of Object.entries(bundles)) {
  const r = await loadArchivedGroom(bundle, {
    transformBundle(s) {
      return s.replace(
        "globalThis.__groomAuditState = {regions,evaluated,normals};",
        "globalThis.__groomAuditState = {regions,evaluated,normals,membership,groomGuides};",
      );
    },
  });
  const reg = r.state.regions.find((r) => r.name === "ruff");
  const guides = reg.mesh.userData.canonicalGroom.guides;
  const guide = guides.find((g) => g.name === "short-neck-collar");
  const summary = {
    bundle,
    bundleSha256: r.bundleSha256,
    guideCount: guides.length,
    guide,
    regions: [],
    coats: [],
  };
  if (guide) {
    const v = guide.surfaceVertex;
    summary.guide = {
      ...guide,
      influence: r.state.groomGuides.guides.find((g) => g.name === guide.name)
        .influence,
      radius: r.state.groomGuides.guides.find((g) => g.name === guide.name)
        .radius,
      normalLengthError: Math.abs(Math.hypot(...guide.normal) - 1),
      combNormalDot: guide.normal.reduce(
        (sum, v, i) => sum + v * guide.comb[i],
        0,
      ),
      headWeight: r.state.membership.head[v],
      rootPositionError: distance(guide.root, [
        ...r.state.evaluated.subarray(v * 3, v * 3 + 3),
      ]),
    };
  }
  const points = [];
  for (const region of r.state.regions) {
    const anchors = new Float64Array(
      region.roots.flatMap((x) => [x.a, x.b, x.c, x.u, x.v, x.w]),
    );
    const downCurves = new Float32Array(
      region.roots.flatMap((x, i) =>
        x.hairKind === "down"
          ? [...region.longGroomCurve.slice(i * 12, i * 12 + 12)]
          : [],
      ),
    );
    summary.regions.push({
      name: region.name,
      roots: region.roots.length,
      anchors: hash(anchors),
      shortGuides: hash(region.groomCurve),
      longGuides: hash(region.longGroomCurve),
      downLongGuides: hash(downCurves),
    });
  }
  r.model.motion.setBreathing(false);
  r.model.motion.setIdleBlink(false);
  for (const coat of ["short", "long"]) {
    const design = {
      ...r.api.defaultCreatorDesign,
      coatType: coat,
      shape: {
        ...r.api.defaultCreatorDesign.shape,
        ...r.api.getCatCoatProfile(coat).defaults,
      },
    };
    r.api.applyCreatorDesign(r.model, design);
    r.fur.refresh({ full: true });
    summary.coats.push({
      coat,
      regions: r.state.regions.map((region) => {
        const attrs = region.mesh.geometry.attributes;
        const groups = { all: [], down: [], pureLimb: [], pureTail: [] };
        for (let i = 0; i < region.roots.length; i++) {
          const root = region.roots[i];
          const roles = ["all"];
          if (root.hairKind === "down") roles.push("down");
          const weight = (key) =>
            r.state.membership[key][root.a] * root.u +
            r.state.membership[key][root.b] * root.v +
            r.state.membership[key][root.c] * root.w;
          if (weight("limb") >= 1 - 1e-6) roles.push("pureLimb");
          if (weight("tail") >= 1 - 1e-6) roles.push("pureTail");
          for (const role of roles)
            for (let v = 0; v < region.strandVertices; v++)
              for (let a = 0; a < 3; a++)
                groups[role].push(
                  attrs.position.getComponent(i * region.strandVertices + v, a),
                );
        }
        return {
          name: region.name,
          positions: hash(attrs.position.array),
          positionGroups: Object.fromEntries(
            Object.entries(groups).map(([k, v]) => [
              k,
              { vertices: v.length / 3, sha256: hash(new Float32Array(v)) },
            ]),
          ),
        };
      }),
    });
  }
  const p = reg.mesh.geometry.attributes.position,
    stride = reg.strandVertices,
    segments = reg.strandSegments;
  const arcs = new Float64Array(reg.roots.length),
    styles = new Float64Array(reg.roots.length);
  for (let i = 0; i < reg.roots.length; i++) {
    const root = reg.roots[i];
    points.push(
      [0, 1, 2].map(
        (a) =>
          r.state.evaluated[root.a * 3 + a] * root.u +
          r.state.evaluated[root.b * 3 + a] * root.v +
          r.state.evaluated[root.c * 3 + a] * root.w,
      ),
    );
    let arc = 0,
      previous = null;
    for (let n = 0; n <= segments; n++) {
      const v = i * stride + n * 2;
      const point = [0, 1, 2].map(
        (a) => (p.getComponent(v, a) + p.getComponent(v + 1, a)) * 0.5,
      );
      if (previous) arc += distance(point, previous);
      previous = point;
    }
    arcs[i] = arc * r.mmPerUnit;
    styles[i] = reg.longStyle[i * 2];
  }
  raw[label] = {
    arcs,
    styles,
    points,
    kinds: reg.roots.map((x) => x.hairKind),
    guides,
  };
  summaries[label] = summary;
  r.model.dispose();
}
const base = raw.before,
  next = raw.after,
  guide = summaries.after.guide;
const center = base.guides.find((g) => g.name === "ruff-lock-center");
const left = base.guides.find((g) => g.name === "ruff-lock--1-middle");
const right = base.guides.find((g) => g.name === "ruff-lock-1-middle");
const groups = new Map();
for (let i = 0; i < next.kinds.length; i++) {
  const kind = next.kinds[i],
    names = [kind === "down" ? "down" : "outer"];
  if (kind !== "down") {
    if (distance(next.points[i], guide.root) < 0.2)
      names.push("collar-radius20");
    if (distance(next.points[i], center.root) < 0.15)
      names.push("central-bib-radius15");
    if (
      Math.min(
        distance(next.points[i], left.root),
        distance(next.points[i], right.root),
      ) < 0.15
    )
      names.push("side-chops-radius15");
  }
  for (const name of names) {
    if (!groups.has(name))
      groups.set(name, {
        name,
        arcBefore: [],
        arcAfter: [],
        arcRatio: [],
        styleRatio: [],
      });
    const g = groups.get(name);
    g.arcBefore.push(base.arcs[i]);
    g.arcAfter.push(next.arcs[i]);
    g.arcRatio.push(next.arcs[i] / base.arcs[i]);
    g.styleRatio.push(next.styles[i] / base.styles[i]);
  }
}
const changes = [...groups.values()].map((g) => ({
  name: g.name,
  arcBeforeMm: distribution(g.arcBefore),
  arcAfterMm: distribution(g.arcAfter),
  arcRatio: distribution(g.arcRatio),
  styleRatio: distribution(g.styleRatio),
}));
const invariants = {
  rootsAndShortGuidesUnchanged: summaries.after.regions.every(
    (r, i) =>
      r.anchors === summaries.before.regions[i].anchors &&
      r.shortGuides === summaries.before.regions[i].shortGuides,
  ),
  shortPositionsUnchanged: summaries.after.coats[0].regions.every(
    (r, i) => r.positions === summaries.before.coats[0].regions[i].positions,
  ),
  headLongPositionsUnchanged:
    summaries.after.coats[1].regions[0].positions ===
    summaries.before.coats[1].regions[0].positions,
  ruffDownPositionsUnchanged:
    summaries.after.coats[1].regions[1].positionGroups.down.sha256 ===
    summaries.before.coats[1].regions[1].positionGroups.down.sha256,
  pureBodyLimbPositionsUnchanged:
    summaries.after.coats[1].regions[2].positionGroups.pureLimb.sha256 ===
    summaries.before.coats[1].regions[2].positionGroups.pureLimb.sha256,
  pureBodyTailPositionsUnchanged:
    summaries.after.coats[1].regions[2].positionGroups.pureTail.sha256 ===
    summaries.before.coats[1].regions[2].positionGroups.pureTail.sha256,
};
const report = {
  capturedAt: new Date().toISOString(),
  note: "Actual frozen CPU geometry, no visual claim. before09/after10 includes the parent's long-body backLay as well as collar; group assertions isolate pure protected cohorts. Collar cohorts use reference-skin distances to projected named guide roots.",
  ...summaries,
  changes,
  invariants,
};
await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ output, guide, changes, invariants }, null, 2));
if (!Object.values(invariants).every(Boolean)) process.exitCode = 1;
