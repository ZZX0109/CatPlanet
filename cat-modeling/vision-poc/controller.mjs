import fs from "node:fs";
import { createHash } from "node:crypto";
import sharp from "sharp";
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export async function observePng(filename) {
  const bytes = fs.readFileSync(filename),
    metadata = await sharp(bytes, { limitInputPixels: 1024 * 1024 }).metadata();
  if (
    metadata.format !== "png" ||
    metadata.width < 8 ||
    metadata.height < 8 ||
    metadata.width > 1024 ||
    metadata.height > 1024
  )
    throw Error("Expected bounded local fixture PNG");
  const { data, info } = await sharp(bytes, { limitInputPixels: 1024 * 1024 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const headMask = new Uint8Array(info.width * info.height),
    silhouetteMask = new Uint8Array(headMask.length);
  let left = info.width,
    right = -1,
    top = info.height,
    bottom = -1,
    silTop = info.height,
    silBottom = -1,
    silhouettePixels = 0;
  for (let i = 0; i < headMask.length; i++) {
    const offset = i * 4;
    if (data[offset + 3] < 128) continue;
    const x = i % info.width,
      y = Math.floor(i / info.width);
    silhouetteMask[i] = 1;
    silhouettePixels++;
    silTop = Math.min(silTop, y);
    silBottom = Math.max(silBottom, y);
    if (
      data[offset] > 170 &&
      data[offset + 1] < 110 &&
      data[offset + 2] < 110
    ) {
      headMask[i] = 1;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || silBottom < silTop)
    throw Error(
      "Fixture head ID or silhouette mask absent; real photos are unsupported",
    );
  return {
    sha256: sha256(bytes),
    width: info.width,
    height: info.height,
    headMask,
    silhouetteMask,
    normalizedHeadWidth: (right - left + 1) / (silBottom - silTop + 1),
    headBbox: { left, right, top, bottom },
    silhouettePixels,
  };
}
function iou(a, b) {
  let intersection = 0,
    union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) intersection++;
    if (a[i] || b[i]) union++;
  }
  if (!union) throw Error("Empty mask union");
  return intersection / union;
}
export function compareObservations(observation, target) {
  if (
    observation.width !== target.width ||
    observation.height !== target.height
  )
    throw Error("Frozen view dimensions differ");
  const headIoU = iou(observation.headMask, target.headMask),
    silhouetteIoU = iou(observation.silhouetteMask, target.silhouetteMask);
  return {
    headIoU,
    silhouetteIoU,
    normalizedHeadWidth: observation.normalizedHeadWidth,
    targetNormalizedHeadWidth: target.normalizedHeadWidth,
    loss:
      1 -
      headIoU +
      Math.abs(observation.normalizedHeadWidth - target.normalizedHeadWidth),
  };
}
export function proposeHeadWidths(current, step = 3) {
  if (
    !Number.isFinite(current) ||
    current < 0 ||
    current > 100 ||
    !Number.isFinite(step) ||
    step <= 0 ||
    step > 3
  )
    throw Error(
      "Bounded headWidth proposal requires value [0,100], step (0,3]",
    );
  return [
    ...new Set([Math.max(0, current - step), Math.min(100, current + step)]),
  ].filter((v) => v !== current);
}
export function decideCandidate(input) {
  const {
      currentParameter,
      candidateParameter,
      currentMetrics,
      candidateMetrics,
      expected,
      evidence,
    } = input,
    reasons = [];
  if (
    !Number.isFinite(candidateParameter) ||
    candidateParameter < 0 ||
    candidateParameter > 100 ||
    !Number.isFinite(currentParameter) ||
    currentParameter < 0 ||
    currentParameter > 100 ||
    Math.abs(candidateParameter - currentParameter) > 3 ||
    candidateParameter === currentParameter
  )
    reasons.push("parameter-step-outside-bounds");
  if (
    expected?.requestedParameter !== candidateParameter ||
    evidence?.appliedParameter !== candidateParameter
  )
    reasons.push("actual-parameter-does-not-match-request");
  const actualWeights = evidence?.shapeKeyWeights;
  for (const [name, value] of [
    ["Shape_headWidth_low", Math.max(0, (50 - candidateParameter) / 50)],
    ["Shape_headWidth_high", Math.max(0, (candidateParameter - 50) / 50)],
  ])
    if (
      !Number.isFinite(actualWeights?.[name]) ||
      Math.abs(actualWeights[name] - value) > 1e-6
    )
      reasons.push("actual-shape-key-weight-" + name);
  for (const field of [
    "candidateId",
    "round",
    "topologyHash",
    "uvHash",
    "configurationHash",
  ])
    if (
      expected?.[field] === undefined ||
      evidence?.[field] !== expected[field]
    )
      reasons.push("stale-or-mismatched-" + field);
  for (const field of ["baseSha256", "sourceSha256"])
    for (const phase of ["Before", "After"])
      if (
        !/^[a-f0-9]{64}$/.test(expected?.[field] ?? "") ||
        evidence?.[field + phase] !== expected[field]
      )
        reasons.push("immutable-" + field + "-" + phase);
  for (const field of ["finite", "nondegenerate", "orientationPreserved"])
    if (evidence?.[field] !== true) reasons.push("structural-" + field);
  const trainBefore = currentMetrics?.front?.loss,
    trainAfter = candidateMetrics?.front?.loss,
    heldBefore = currentMetrics?.three?.loss,
    heldAfter = candidateMetrics?.three?.loss;
  if (![trainBefore, trainAfter, heldBefore, heldAfter].every(Number.isFinite))
    reasons.push("missing-image-metrics");
  else {
    if (!(trainAfter < trainBefore - 1e-8))
      reasons.push("training-no-improvement");
    if (heldAfter > heldBefore + 1e-8) reasons.push("heldout-regression");
  }
  return { accepted: reasons.length === 0, reasons };
}
