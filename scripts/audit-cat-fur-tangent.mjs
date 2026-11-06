/** Read-only actual-geometry direction audit; no browser or runtime edits. */
import fs from "node:fs/promises";
import path from "node:path";
import { loadArchivedGroom } from "./cat-groom-audit-runtime.mjs";

const bundlePath =
  process.argv[2] ?? "artifacts/fur-realism/round-08/performance-probe.js";
const outputPath =
  process.argv[3] ??
  "artifacts/fur-realism/verification/tangent-recovery-round08.json";
const runtime = await loadArchivedGroom(bundlePath);
const { api, model, fur, state, bounds, mmPerUnit } = runtime;
const combination = {
  headRound: 100,
  headWidth: 75,
  headDepth: 35,
  cheeks: 80,
  jaw: 75,
  muzzle: 30,
  muzzleWidth: 60,
};
const distribution = (values) => {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const at = (p) => values[Math.floor((values.length - 1) * p)];
  return {
    min: at(0),
    p001: at(0.001),
    p01: at(0.01),
    p05: at(0.05),
    median: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: at(1),
  };
};
const group = () => ({
  strands: 0,
  nodes: 0,
  invalidNodes: 0,
  cosine: [],
  cross: [],
  alignment: [],
  minCross: [],
  minAlignment: [],
  signFlipStrands: 0,
  reliableSignFlipStrands: 0,
  adjacentCrossFlipStrands: 0,
  near1e4: 0,
  near1e3: 0,
  near1e2: 0,
  lowAlignment: 0,
  axisZeroStrands: 0,
  axisMixedStrands: 0,
  axisInvalidValues: 0,
  axisPairErrors: 0,
  axisCorrectedSignFlipStrands: 0,
  axisCorrectedAdjacentFlipStrands: 0,
  axisNonzeroContactStrands: 0,
  correctedAlignment: [],
  examples: [],
});
const family = () => ({ withoutGround: group(), groundClipped: group() });
const summarize = (value) => ({
  strands: value.strands,
  nodes: value.nodes,
  invalidNodes: value.invalidNodes,
  normalWidthAbsoluteCosine: distribution(value.cosine),
  normalizedCrossMagnitude: distribution(value.cross),
  absoluteChordAlignment: distribution(value.alignment),
  minimumCrossPerStrand: distribution(value.minCross),
  minimumAbsAlignmentPerStrand: distribution(value.minAlignment),
  signFlipStrands: value.signFlipStrands,
  reliableSignFlipStrands: value.reliableSignFlipStrands,
  adjacentCrossFlipStrands: value.adjacentCrossFlipStrands,
  crossBelow1e4: value.near1e4,
  crossBelow1e3: value.near1e3,
  crossBelow1e2: value.near1e2,
  absAlignmentBelow09: value.lowAlignment,
  axisZeroStrands: value.axisZeroStrands,
  axisMixedStrands: value.axisMixedStrands,
  axisInvalidValues: value.axisInvalidValues,
  axisPairErrors: value.axisPairErrors,
  axisCorrectedSignFlipStrands: value.axisCorrectedSignFlipStrands,
  axisCorrectedAdjacentFlipStrands: value.axisCorrectedAdjacentFlipStrands,
  axisNonzeroContactStrands: value.axisNonzeroContactStrands,
  axisCorrectedSignedChordAlignment: distribution(value.correctedAlignment),
  examples: value.examples,
});
const report = {
  capturedAt: new Date().toISOString(),
  bundle: bundlePath,
  bundleSha256: runtime.bundleSha256,
  glbSha256: runtime.glbSha256,
  method:
    "Actual archived production normal/furWidth and pair-averaged positions, no browser/GPU. compare normalize(cross(N,W)) with node's forward central chord; endpoints use one-sided chord.",
  reliableSignNote:
    "Reliable signs require normalized cross magnitude >=.001 and abs chord alignment >=.5; an arbitrary constant sign per strand is allowed.",
  degeneracyNote:
    "Cross magnitude is |N cross W|/(|N||W|); cosine is abs(N dot W)/(|N||W|). Ground-clipped strands are separated by any non-root edge at canonical floor+.002 within1e-6.",
  combination,
  cases: [],
};
model.motion.setBreathing(false);
model.motion.setIdleBlink(false);
let tick = 0;
try {
  for (const coatType of ["short", "long"])
    for (const pose of ["stand", "rest"])
      for (const shape of ["neutral", "combination"]) {
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
        api.applyCreatorDesign(model, design);
        fur.setDetail(1);
        fur.refresh({ full: true });
        const rows = [];
        for (const region of state.regions) {
          const mesh = region.mesh,
            geometry = mesh.geometry;
          const position = geometry.attributes.position,
            normal = geometry.attributes.normal,
            width = geometry.attributes.furWidth;
          const axis = geometry.attributes.furFilterAxis;
          const stride = mesh.userData.strandVertices,
            nodes = mesh.userData.strandSegments + 1,
            count = mesh.userData.strandCount;
          const all = family(),
            kinds = { down: family(), awn: family(), guard: family() };
          const centers = new Float64Array(nodes * 3),
            samples = [];
          for (let strand = 0; strand < count; strand++) {
            let clipped = false;
            for (let node = 0; node < nodes; node++) {
              const vertex = strand * stride + node * 2,
                offset = node * 3;
              centers[offset] =
                (position.getX(vertex) + position.getX(vertex + 1)) * 0.5;
              centers[offset + 1] =
                (position.getY(vertex) + position.getY(vertex + 1)) * 0.5;
              centers[offset + 2] =
                (position.getZ(vertex) + position.getZ(vertex + 1)) * 0.5;
              if (
                node > 0 &&
                Math.min(position.getY(vertex), position.getY(vertex + 1)) <=
                  bounds.min.y + 0.002 + 1e-6
              )
                clipped = true;
            }
            samples.length = 0;
            let minCross = Infinity,
              minAlignment = Infinity,
              invalid = 0,
              firstSign = 0,
              reliableSign = 0,
              signFlip = false,
              reliableFlip = false,
              previousCross = null,
              adjacentFlip = false,
              previousCorrected = null,
              correctedAdjacentFlip = false,
              correctedSign = 0,
              correctedFlip = false,
              zeroAxis = 0,
              nonzeroAxis = 0,
              invalidAxis = 0,
              pairAxisErrors = 0;
            for (let node = 0; node < nodes; node++) {
              const vertex = strand * stride + node * 2;
              const axisValue = axis?.getX(vertex) ?? null;
              if (axis) {
                if (axisValue !== axis.getX(vertex + 1)) pairAxisErrors++;
                if (axisValue === 0) zeroAxis++;
                else if (axisValue === -1 || axisValue === 1) nonzeroAxis++;
                else invalidAxis++;
              }
              const nx = normal.getX(vertex),
                ny = normal.getY(vertex),
                nz = normal.getZ(vertex),
                wx = width.getX(vertex),
                wy = width.getY(vertex),
                wz = width.getZ(vertex);
              const cx = ny * wz - nz * wy,
                cy = nz * wx - nx * wz,
                cz = nx * wy - ny * wx;
              const nl = Math.hypot(nx, ny, nz),
                wl = Math.hypot(wx, wy, wz),
                cl = Math.hypot(cx, cy, cz);
              const prev = Math.max(0, node - 1) * 3,
                next = Math.min(nodes - 1, node + 1) * 3;
              const tx = centers[next] - centers[prev],
                ty = centers[next + 1] - centers[prev + 1],
                tz = centers[next + 2] - centers[prev + 2],
                tl = Math.hypot(tx, ty, tz);
              if (nl < 1e-8 || wl < 1e-12 || cl < 1e-15 || tl < 1e-8) {
                invalid++;
                continue;
              }
              const cross = cl / (nl * wl),
                cosine = Math.abs(nx * wx + ny * wy + nz * wz) / (nl * wl),
                alignment = Math.max(
                  -1,
                  Math.min(1, (cx * tx + cy * ty + cz * tz) / (cl * tl)),
                );
              minCross = Math.min(minCross, cross);
              minAlignment = Math.min(minAlignment, Math.abs(alignment));
              const sign = Math.sign(alignment);
              if (Math.abs(alignment) > 0.1) {
                if (firstSign && firstSign !== sign) signFlip = true;
                firstSign ||= sign;
              }
              if (cross >= 0.001 && Math.abs(alignment) >= 0.5) {
                if (reliableSign && reliableSign !== sign) reliableFlip = true;
                reliableSign ||= sign;
              }
              if (
                previousCross &&
                (previousCross[0] * cx +
                  previousCross[1] * cy +
                  previousCross[2] * cz) /
                  cl <
                  0
              )
                adjacentFlip = true;
              previousCross = [cx / cl, cy / cl, cz / cl];
              let corrected = null;
              if (axisValue !== null && axisValue !== 0) {
                corrected = alignment * axisValue;
                const sign = Math.sign(corrected);
                if (Math.abs(corrected) > 0.1) {
                  if (correctedSign && correctedSign !== sign)
                    correctedFlip = true;
                  correctedSign ||= sign;
                }
                const current = [
                  (cx / cl) * axisValue,
                  (cy / cl) * axisValue,
                  (cz / cl) * axisValue,
                ];
                if (
                  previousCorrected &&
                  current.reduce((s, v, i) => s + v * previousCorrected[i], 0) <
                    0
                )
                  correctedAdjacentFlip = true;
                previousCorrected = current;
              }
              samples.push({
                cross,
                cosine,
                alignment: Math.abs(alignment),
                corrected,
              });
            }
            const root = region.roots[strand];
            for (const family of [all, kinds[root.hairKind]]) {
              const target = clipped
                ? family.groundClipped
                : family.withoutGround;
              target.strands++;
              target.nodes += nodes;
              target.invalidNodes += invalid;
              if (Number.isFinite(minCross)) target.minCross.push(minCross);
              if (Number.isFinite(minAlignment))
                target.minAlignment.push(minAlignment);
              if (signFlip) target.signFlipStrands++;
              if (reliableFlip) target.reliableSignFlipStrands++;
              if (adjacentFlip) target.adjacentCrossFlipStrands++;
              if (axis) {
                if (zeroAxis === nodes) target.axisZeroStrands++;
                if (zeroAxis > 0 && nonzeroAxis > 0) target.axisMixedStrands++;
                target.axisInvalidValues += invalidAxis;
                target.axisPairErrors += pairAxisErrors;
                if (correctedFlip) target.axisCorrectedSignFlipStrands++;
                if (correctedAdjacentFlip)
                  target.axisCorrectedAdjacentFlipStrands++;
                if (clipped && nonzeroAxis > 0)
                  target.axisNonzeroContactStrands++;
              }
              if (
                (reliableFlip || minCross < 0.0001 || minAlignment < 0.5) &&
                target.examples.length < 4
              )
                target.examples.push({
                  strand,
                  kind: root.hairKind,
                  roll: root.roll,
                  reliableFlip,
                  minCross,
                  minAlignment,
                  root: Array.from(centers.slice(0, 3)),
                });
              for (const sample of samples) {
                target.cross.push(sample.cross);
                target.cosine.push(sample.cosine);
                target.alignment.push(sample.alignment);
                if (sample.cross < 0.0001) target.near1e4++;
                if (sample.cross < 0.001) target.near1e3++;
                if (sample.cross < 0.01) target.near1e2++;
                if (sample.alignment < 0.9) target.lowAlignment++;
                if (sample.corrected !== null)
                  target.correctedAlignment.push(sample.corrected);
              }
            }
          }
          rows.push({
            region: region.name,
            strandVertices: stride,
            axisAttribute: axis
              ? {
                  arrayType: axis.array.constructor.name,
                  itemSize: axis.itemSize,
                  normalized: axis.normalized,
                }
              : null,
            all: {
              withoutGround: summarize(all.withoutGround),
              groundClipped: summarize(all.groundClipped),
            },
            byKind: Object.fromEntries(
              Object.entries(kinds).map(([kind, value]) => [
                kind,
                {
                  withoutGround: summarize(value.withoutGround),
                  groundClipped: summarize(value.groundClipped),
                },
              ]),
            ),
          });
        }
        report.cases.push({ coatType, pose, shape, regions: rows });
      }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        outputPath,
        cases: report.cases.map((c) => ({
          coat: c.coatType,
          pose: c.pose,
          shape: c.shape,
          regions: c.regions.map((r) => ({
            region: r.region,
            ordinary: r.all.withoutGround.strands,
            clipped: r.all.groundClipped.strands,
            stableFlips: r.all.withoutGround.reliableSignFlipStrands,
            rawFlips: r.all.withoutGround.signFlipStrands,
            clippedFlips: r.all.groundClipped.reliableSignFlipStrands,
            minimumCross: r.all.withoutGround.normalizedCrossMagnitude.min,
            crossBelow001: r.all.withoutGround.crossBelow1e3,
            minAlignment: r.all.withoutGround.absoluteChordAlignment.min,
            alignmentP01: r.all.withoutGround.absoluteChordAlignment.p01,
            axisFallback: r.all.withoutGround.axisZeroStrands,
            correctedFlips: r.all.withoutGround.axisCorrectedSignFlipStrands,
            correctedAdjacentFlips:
              r.all.withoutGround.axisCorrectedAdjacentFlipStrands,
            correctedMin:
              r.all.withoutGround.axisCorrectedSignedChordAlignment?.min,
            contactNonzero: r.all.groundClipped.axisNonzeroContactStrands,
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
