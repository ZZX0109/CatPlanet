/** Actual filled shell versus root-matched down envelope. Read-only Node. */
import fs from "node:fs/promises";
import { loadArchivedGroom } from "./cat-groom-audit-runtime.mjs";

const bundle =
  process.argv[2] ?? "artifacts/fur-realism/round-10/collar-probe.js";
const output =
  process.argv[3] ?? "artifacts/fur-realism/round-10/undercoat-clearance.json";
const r = await loadArchivedGroom(bundle);
const shell = r.fur.meshes.find((m) => m.userData.undercoat);
if (!shell) throw new Error("Actual undercoat mesh unavailable");
const distribution = (v) => {
  if (!v.length) return null;
  v.sort((a, b) => a - b);
  const at = (p) => v[Math.floor((v.length - 1) * p)];
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
  bundleSha256: r.bundleSha256,
  glbSha256: r.glbSha256,
  mmPerUnit: r.mmPerUnit,
  method:
    "Actual10 opaque shell positions and actual down strand centreline, both interpolated against the same barycentric skin root. Only shell-index-covered source triangles enter paired statistics. Node only, no browser/GPU.",
  caveat:
    "Millimetres assume skin height300mm. Radial heights are projections onto the root skin normal, not distance to the closest downstream shell or whole-body collision/SDF. Shell thickness at the root is a local proxy; comparisons do not prove every suspended pixel has that literal clearance.",
  profiles: [],
};
r.model.motion.setBreathing(false);
r.model.motion.setIdleBlink(false);
try {
  for (const maximum of [false, true]) {
    const design = {
      ...r.api.defaultCreatorDesign,
      coatType: "long",
      shape: {
        ...r.api.defaultCreatorDesign.shape,
        ...r.api.getCatCoatProfile("long").defaults,
      },
    };
    if (maximum)
      for (const region of ["head", "ruff", "body"])
        for (const p of ["FurLength", "FurDensity"])
          design.shape[region + p] = 100;
    r.api.applyCreatorDesign(r.model, design);
    r.fur.refresh({ full: true });
    const attrs = shell.geometry.attributes,
      index = shell.geometry.index,
      triangles = new Set();
    for (let i = 0; i < shell.geometry.drawRange.count; i += 3)
      triangles.add(
        [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
          .sort((a, b) => a - b)
          .join(","),
      );
    const groups = new Map();
    for (const region of r.state.regions) {
      if (!["body", "ruff"].includes(region.name)) continue;
      const p = region.mesh.geometry.attributes.position;
      const count = region.mesh.userData.strandCount;
      for (let i = 0; i < count; i++) {
        const root = region.roots[i];
        if (root.hairKind !== "down") continue;
        const skin = [0, 0, 0],
          normal = [0, 0, 0],
          shellPoint = [0, 0, 0];
        for (let a = 0; a < 3; a++) {
          skin[a] =
            r.state.evaluated[root.a * 3 + a] * root.u +
            r.state.evaluated[root.b * 3 + a] * root.v +
            r.state.evaluated[root.c * 3 + a] * root.w;
          normal[a] =
            r.state.normals[root.a * 3 + a] * root.u +
            r.state.normals[root.b * 3 + a] * root.v +
            r.state.normals[root.c * 3 + a] * root.w;
          shellPoint[a] =
            attrs.position.getComponent(root.a, a) * root.u +
            attrs.position.getComponent(root.b, a) * root.v +
            attrs.position.getComponent(root.c, a) * root.w;
        }
        const nl = Math.hypot(...normal);
        for (let a = 0; a < 3; a++) normal[a] /= nl;
        const names = [region.name];
        if (region.name === "body") {
          if (root.kind === 0 && normal[1] > 0.7) names.push("back");
          if (root.kind === 0 && Math.abs(normal[0]) > 0.7 && normal[1] <= 0.7)
            names.push("flank");
          if (root.kind === 2) names.push("tail");
        }
        const covered = triangles.has(
          [root.a, root.b, root.c].sort((a, b) => a - b).join(","),
        );
        const shellN =
          shellPoint.reduce(
            (sum, value, a) => sum + (value - skin[a]) * normal[a],
            0,
          ) * r.mmPerUnit;
        let crest = -Infinity,
          tip = 0,
          aboveShellNodes = 0,
          firstAboveT = null;
        for (let node = 0; node <= region.strandSegments; node++) {
          const v = i * region.strandVertices + node * 2;
          tip =
            [0, 1, 2].reduce(
              (sum, a) =>
                sum +
                ((p.getComponent(v, a) + p.getComponent(v + 1, a)) * 0.5 -
                  skin[a]) *
                  normal[a],
              0,
            ) * r.mmPerUnit;
          crest = Math.max(crest, tip);
          if (tip > shellN + 1) {
            aboveShellNodes++;
            if (firstAboveT === null)
              firstAboveT = node / region.strandSegments;
          }
        }
        for (const name of names) {
          if (!groups.has(name))
            groups.set(name, {
              name,
              covered: 0,
              uncovered: 0,
              shell: [],
              crest: [],
              tip: [],
              crestGap: [],
              tipGap: [],
              ratio: [],
              aboveNodeFraction: [],
              firstAbove: [],
              shellBelow1: 0,
              crestBeyond1: 0,
              tipBeyond1: 0,
            });
          const g = groups.get(name);
          if (!covered) {
            g.uncovered++;
            continue;
          }
          g.covered++;
          g.shell.push(shellN);
          g.crest.push(crest);
          g.tip.push(tip);
          g.crestGap.push(crest - shellN);
          g.tipGap.push(tip - shellN);
          g.ratio.push(shellN / crest);
          g.aboveNodeFraction.push(
            aboveShellNodes / (region.strandSegments + 1),
          );
          if (firstAboveT !== null) g.firstAbove.push(firstAboveT);
          if (shellN < 1) g.shellBelow1++;
          if (crest > shellN + 1) g.crestBeyond1++;
          if (tip > shellN + 1) g.tipBeyond1++;
        }
      }
    }
    report.profiles.push({
      profile: maximum ? "long-maximum" : "long-default",
      shellLoftMm: Object.fromEntries(
        Object.entries(shell.userData.loft).map(([k, v]) => [
          k,
          v * r.mmPerUnit,
        ]),
      ),
      density: shell.userData.density,
      shellTriangles: shell.geometry.drawRange.count / 3,
      groups: [...groups.values()].map((g) => ({
        cohort: g.name,
        coveredDownRoots: g.covered,
        uncoveredDownRoots: g.uncovered,
        shellRadialMm: distribution(g.shell),
        downCrestRadialMm: distribution(g.crest),
        downTipRadialMm: distribution(g.tip),
        crestAboveRootShellMm: distribution(g.crestGap),
        tipAboveRootShellMm: distribution(g.tipGap),
        shellToCrestRatio: distribution(g.ratio),
        curveNodesMoreThan1MmAboveRootShell: distribution(g.aboveNodeFraction),
        firstNodeMoreThan1MmAboveRootShellT: distribution(g.firstAbove),
        fractionShellBelow1Mm: g.shellBelow1 / g.covered,
        fractionCrestMoreThan1MmAboveRootShell: g.crestBeyond1 / g.covered,
        fractionTipMoreThan1MmAboveRootShell: g.tipBeyond1 / g.covered,
      })),
    });
  }
  await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        output,
        profiles: report.profiles.map((p) => ({
          profile: p.profile,
          loft: p.shellLoftMm,
          groups: p.groups,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  r.model.dispose();
}
