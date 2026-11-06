import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadArchivedGroom } from "./cat-groom-audit-runtime.mjs";

const directory = "artifacts/fur-volume/draw-diagnostics";
const capture = JSON.parse(
  await fs.readFile(
    "artifacts/fur-filter/volume-r14-draw-isolation-body/capture-report.json",
    "utf8",
  ),
);
const frame = capture.frames[0],
  bodyCapture = frame.context.regions.find((r) => r.region === "body");
const schema = JSON.parse(
  await fs.readFile(`${directory}/schema.json`, "utf8"),
);
const bundle =
  "artifacts/fur-filter/volume-r14-draw-isolation-body/model-probe.js";
const runtime = await loadArchivedGroom(bundle);
const { api, model, fur, state } = runtime;
const hash = (a) =>
  createHash("sha256")
    .update(Buffer.from(a.buffer, a.byteOffset, a.byteLength))
    .digest("hex");
model.motion.setBreathing(false);
model.motion.setIdleBlink(false);
const design = {
  ...api.defaultCreatorDesign,
  coatType: "long",
  shape: { ...capture.settings[0].shape },
};
api.applyCreatorDesign(model, design);
fur.setVolumeGeometry({ envelopeScale: 1.4, sweepScale: 0 });
fur.setVolume(true);
model.motion.setPose("rest", true);
model.motion.update(1, { reducedMotion: true });
api.applyCreatorDesign(model, design);
fur.refresh({ full: true });
const region = state.regions.find((r) => r.name === "body");
const geometry = region.mesh.geometry;
const labels = new Uint8Array(region.roots.map((root) => root.kind));
const triangles = new Uint32Array(
  region.roots.flatMap((root) => [root.a, root.b, root.c]),
);
const checks = {
  labelsMatch: hash(labels) === schema.arrays.kind.sha256,
  sourceBindingsMatch: hash(triangles) === schema.arrays.sourceTriangles.sha256,
  sourceIndexMatch:
    hash(geometry.index.array) === schema.rootIndexing.sourceGeometryIndexSHA,
  actualCapturedFullPositionMatch:
    hash(geometry.attributes.position.array) === bodyCapture.hashes.position,
};
if (Object.values(checks).some((pass) => !pass)) {
  await fs.writeFile(
    `${directory}/projected-attribution.json`,
    JSON.stringify(
      {
        checks,
        actualPositionSHA: hash(geometry.attributes.position.array),
        expectedPositionSHA: bodyCapture.hashes.position,
      },
      null,
      2,
    ),
  );
  throw Error(
    "Geometry/labels do not match actual screenshot; no attribution performed",
  );
}
const width = 826,
  height = 521;
const camera = new api.PerspectiveCamera();
camera.projectionMatrix.fromArray(frame.context.camera.projection);
camera.position.fromArray(frame.context.camera.position);
camera.lookAt(new api.Vector3().fromArray(frame.context.camera.target));
camera.updateMatrixWorld(true);
model.scene.updateMatrixWorld(true);
const matrix = camera.projectionMatrix
  .clone()
  .multiply(camera.matrixWorldInverse)
  .multiply(region.mesh.matrixWorld);
const baselineCapture = JSON.parse(
  await fs.readFile(
    "artifacts/fur-filter/volume-r14-draw-isolation/capture-report.json",
    "utf8",
  ),
);
const lodScale = baselineCapture.frames[0].context.actualDraws.find(
  (d) => d.name === "Fur_Body",
).uniforms.catFurLodScale;
const rois = {
  grayArc: [360, 184, 470, 226],
  centralComb: [365, 230, 445, 370],
  leftOuterArcs: [265, 220, 365, 365],
  rightOuterArcs: [445, 220, 555, 390],
  tailPlume: [395, 365, 545, 500],
};
function clip(poly, axis, bound, greater) {
  if (!poly.length) return [];
  const out = [];
  let previous = poly.at(-1),
    previousInside = greater
      ? previous[axis] >= bound
      : previous[axis] <= bound;
  for (const current of poly) {
    const inside = greater ? current[axis] >= bound : current[axis] <= bound;
    if (inside !== previousInside) {
      const t = (bound - previous[axis]) / (current[axis] - previous[axis]);
      out.push([
        previous[0] + (current[0] - previous[0]) * t,
        previous[1] + (current[1] - previous[1]) * t,
      ]);
    }
    if (inside) out.push(current);
    previous = current;
    previousInside = inside;
  }
  return out;
}
function areaInROI(poly, box) {
  for (const [axis, bound, greater] of [
    [0, box[0], true],
    [0, box[2], false],
    [1, box[1], true],
    [1, box[3], false],
  ])
    poly = clip(poly, axis, bound, greater);
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    area += a[0] * b[1] - a[1] * b[0];
  }
  return Math.abs(area) * 0.5;
}
function project(x, y, z) {
  const v = new api.Vector3(x, y, z).applyMatrix4(matrix);
  return [(v.x + 1) * width * 0.5, (1 - v.y) * height * 0.5];
}
const groups = {};
const activeCounts = {};
for (const roi of Object.keys(rois)) groups[roi] = {};
const p = geometry.attributes.position,
  widths = geometry.attributes.furWidth,
  weights = geometry.attributes.furVolumeWeight;
for (let strand = 0; strand < bodyCapture.previewStrands; strand++) {
  const root = region.roots[strand],
    opacity = 1 - weights.getX(strand * region.strandVertices);
  const key = `kind${root.kind}/${root.hairKind}`;
  activeCounts[key] ??= { roots: 0, nonzeroOpacity: 0, trunkWeightZero: 0 };
  activeCounts[key].roots++;
  if (opacity > 1e-5) activeCounts[key].nonzeroOpacity++;
  if (root.trunkWeight === 0) activeCounts[key].trunkWeightZero++;
  if (opacity <= 1e-5) continue;
  const nodes = [];
  for (let sample = 0; sample <= region.strandSegments; sample++) {
    const i = strand * region.strandVertices + sample * 2;
    const center = [0, 1, 2].map(
      (k) => (p.getComponent(i, k) + p.getComponent(i + 1, k)) * 0.5,
    );
    nodes.push(
      [-1, 1].map((side) =>
        project(
          ...center.map(
            (value, k) => value + widths.getComponent(i, k) * side * lodScale,
          ),
        ),
      ),
    );
  }
  for (const [name, box] of Object.entries(rois)) {
    let area = 0;
    for (let sample = 0; sample < region.strandSegments; sample++) {
      const [a, b] = nodes[sample],
        [c, d] = nodes[sample + 1];
      area += areaInROI([a, b, c], box) + areaInROI([b, d, c], box);
    }
    if (area <= 1e-10) continue;
    const group = (groups[name][key] ??= {
      projectedOpacityArea: 0,
      contributorRoots: 0,
      weightedTrunk: 0,
      examples: [],
    });
    group.projectedOpacityArea += area * opacity;
    group.contributorRoots++;
    group.weightedTrunk += area * opacity * root.trunkWeight;
    if (group.examples.length < 5) group.examples.push(strand);
  }
}
for (const entries of Object.values(groups)) {
  const total = Object.values(entries).reduce(
    (sum, group) => sum + group.projectedOpacityArea,
    0,
  );
  for (const group of Object.values(entries)) {
    group.areaFraction = group.projectedOpacityArea / total;
    group.meanTrunkWeightByArea =
      group.weightedTrunk / group.projectedOpacityArea;
  }
}
const report = {
  checks,
  bundle,
  bundleSHA: runtime.bundleSha256,
  capturePhase: capture.phase,
  camera: frame.context.camera,
  canvas: { width, height },
  actualPreviewStrands: bodyCapture.previewStrands,
  intended: bodyCapture.strandCount,
  lodScale,
  rois,
  activeCounts,
  groups,
  method:
    "Project actual current-pose CPU ribbon triangles with the exact camera; multiply physical halfspan by captured shader LOD factor, sum triangle/ROI intersection area times actual body bulk replacement opacity. Labels validated by original binding/index hashes and full captured pose-position hash.",
  limitations: [
    "Candidate projected contribution, not a final-pixel decomposition: ignores opaque depth, volume occlusion, lighting and OIT overlap.",
    "Legacy minimum-raster-width filter is not simulated. Physical projected area is used for label attribution.",
    "Actual visibility isolation proves body ribbon class for comb and body volume class for gray cap; these Node groups only refine the ribbon class hypothesis.",
  ],
};
await fs.writeFile(
  `${directory}/projected-attribution.json`,
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    output: `${directory}/projected-attribution.json`,
    checks,
    dominant: Object.fromEntries(
      Object.entries(groups).map(([name, entries]) => [
        name,
        Object.entries(entries)
          .sort((a, b) => b[1].areaFraction - a[1].areaFraction)
          .slice(0, 3)
          .map(([kind, data]) => ({ kind, fraction: data.areaFraction })),
      ]),
    ),
  }),
);
model.dispose();
