/**
 * Optional canonical guide experiment, deliberately independent of the live groom.
 * A circle matches the existing weighted N/T arc and crest, rather than assigning
 * every anatomical patch one global arch. B, clumping and physical hair length
 * remain the caller's responsibility. This is not a whole-surface collision test.
 */
type CanonicalCurve = Readonly<ArrayLike<number>>;
export type CatGroomCircleStrategy = "preserve-tip-clearance" | "minimum-turn";

export type CatGroomCircleSourceMetrics = {
  /** Eight-segment arc in the weighted normal/forward plane, without B. */
  arcLength: number;
  peakNormal: number;
  radialRatio: number;
  tipNormalRatio: number;
};

export type CatGroomCircleCandidate = {
  /** All angles are in radians; t runs from the root to the tip. */
  startAngle: number;
  endAngle: number;
  sweepAngle: number;
  radius: number;
  arcLength: number;
  normalGain: number;
  forwardGain: number;
};

export type CatGroomCircleFitMetrics = {
  source: CatGroomCircleSourceMetrics;
  continuousArcRatio: number;
  continuousPeakRatio: number;
  sampledArcRatio: number;
  sampledPeakRatio: number;
  tipNormalRatio: number;
  /** New tip-normal/crest minus the original value; zero is an exact match. */
  tipNormalRatioError: number;
  turnPerJointDegrees: number;
};

export type CatGroomCircleFit = {
  /** Original input reference; never mutated, and used unchanged on fallback. */
  originalCurve: CanonicalCurve;
  strategy: CatGroomCircleStrategy;
} & (
  | {
      kind: "circle";
      candidate: CatGroomCircleCandidate;
      metrics: CatGroomCircleFitMetrics;
    }
  | {
      kind: "original";
      candidate: null;
      reason: "invalid-input" | "degenerate-guide" | "unsupported-radial-ratio";
      source: CatGroomCircleSourceMetrics | null;
    }
);

const DEGREE = Math.PI / 180;
const SEGMENTS = 8;

// Match the existing five-point C1 Hermite evaluator at its eight segments.
// Keep this module free of Three, GPU state and the live groom's implementation.
const SAMPLE_WEIGHTS = Array.from({ length: SEGMENTS + 1 }, (_, sample) => {
  const t = sample / SEGMENTS;
  const interval = Math.min(3, Math.floor(t * 4));
  const u = t * 4 - interval;
  const u2 = u * u;
  const u3 = u2 * u;
  const weights = [0, 0, 0, 0, 0];
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  weights[interval] += h00;
  weights[interval + 1] += h01;
  if (interval === 0) weights[1] += h10;
  else {
    weights[interval + 1] += h10 * 0.5;
    weights[interval - 1] -= h10 * 0.5;
  }
  if (interval === 3) {
    weights[4] += h11;
    weights[3] -= h11;
  } else {
    weights[interval + 2] += h11 * 0.5;
    weights[interval] -= h11 * 0.5;
  }
  return weights;
});

/**
 * Input is four non-root [N,T,B] knots, with an implicit zero root. The default
 * strategy minimizes tip-clearance error within theta0=20..85 degrees (.25 step),
 * theta1 in [-theta0,0], sweep<120 degrees, then weakly prefers lower curvature.
 * The finite eight-segment approximation is reported separately from the exact
 * continuous constraints. Added gravity/clump/wave can change final 3D metrics.
 */
export function fitCatGroomCircle(
  curve: CanonicalCurve,
  normalGain: number,
  forwardGain: number,
  strategy: CatGroomCircleStrategy = "preserve-tip-clearance",
): CatGroomCircleFit {
  const original = { originalCurve: curve, strategy };
  if (
    curve.length !== 12 ||
    !Number.isFinite(normalGain) ||
    !Number.isFinite(forwardGain) ||
    normalGain <= 0 ||
    forwardGain <= 0 ||
    Array.from({ length: 12 }, (_, i) => curve[i]).some(
      (value) => !Number.isFinite(value),
    )
  )
    return {
      ...original,
      kind: "original",
      candidate: null,
      reason: "invalid-input",
      source: null,
    };

  let arcLength = 0;
  let peakNormal = 0;
  let previousN = 0;
  let previousT = 0;
  for (let sample = 0; sample <= SEGMENTS; sample++) {
    let n = 0;
    let t = 0;
    for (let knot = 0; knot < 4; knot++) {
      const weight = SAMPLE_WEIGHTS[sample][knot + 1];
      n += weight * curve[knot * 3] * normalGain;
      t += weight * curve[knot * 3 + 1] * forwardGain;
    }
    if (sample > 0) arcLength += Math.hypot(n - previousN, t - previousT);
    peakNormal = Math.max(peakNormal, n);
    previousN = n;
    previousT = t;
  }
  if (!(arcLength > 1e-12 && peakNormal > 1e-12))
    return {
      ...original,
      kind: "original",
      candidate: null,
      reason: "degenerate-guide",
      source: null,
    };

  const radialRatio = peakNormal / arcLength;
  const tipNormalRatio = previousN / peakNormal;
  const source = { arcLength, peakNormal, radialRatio, tipNormalRatio };
  let best: CatGroomCircleCandidate | null = null;
  let bestScore = Infinity;
  let bestTipRatio = 0;
  for (let degrees = 20; degrees <= 85; degrees += 0.25) {
    const startAngle = degrees * DEGREE;
    const sweepAngle = (1 - Math.cos(startAngle)) / radialRatio;
    const endAngle = startAngle - sweepAngle;
    if (
      endAngle > 1e-10 ||
      endAngle < -startAngle - 1e-10 ||
      sweepAngle >= 120 * DEGREE
    )
      continue;
    const newTipRatio =
      (Math.cos(endAngle) - Math.cos(startAngle)) / (1 - Math.cos(startAngle));
    const score =
      strategy === "minimum-turn"
        ? sweepAngle
        : Math.abs(newTipRatio - tipNormalRatio) + sweepAngle * 0.0001;
    if (score >= bestScore) continue;
    bestScore = score;
    bestTipRatio = newTipRatio;
    best = {
      startAngle,
      endAngle,
      sweepAngle,
      radius: arcLength / sweepAngle,
      arcLength,
      normalGain,
      forwardGain,
    };
  }
  if (!best)
    return {
      ...original,
      kind: "original",
      candidate: null,
      reason: "unsupported-radial-ratio",
      source,
    };

  let sampledPeak = 0;
  for (let sample = 0; sample <= SEGMENTS; sample++)
    sampledPeak = Math.max(
      sampledPeak,
      best.radius *
        (Math.cos(best.startAngle - (best.sweepAngle * sample) / SEGMENTS) -
          Math.cos(best.startAngle)),
    );
  const halfSegmentAngle = best.sweepAngle / (SEGMENTS * 2);
  return {
    ...original,
    kind: "circle",
    candidate: best,
    metrics: {
      source,
      continuousArcRatio: (best.radius * best.sweepAngle) / arcLength,
      continuousPeakRatio:
        (best.radius * (1 - Math.cos(best.startAngle))) / peakNormal,
      sampledArcRatio: Math.sin(halfSegmentAngle) / halfSegmentAngle,
      sampledPeakRatio: sampledPeak / peakNormal,
      tipNormalRatio: bestTipRatio,
      tipNormalRatioError: bestTipRatio - tipNormalRatio,
      turnPerJointDegrees: best.sweepAngle / SEGMENTS / DEGREE,
    },
  };
}

/**
 * Write canonical [N,T,dN/dt,dT/dt]. The caller retains the original B curve and
 * applies its usual N/T gains exactly once. No output is touched on fallback.
 */
export function evaluateCatGroomCircle(
  fit: CatGroomCircleFit,
  t: number,
  output: Float32Array | Float64Array | number[],
  offset = 0,
): boolean {
  if (fit.kind !== "circle" || !Number.isFinite(t)) return false;
  const circle = fit.candidate;
  const theta =
    circle.startAngle - circle.sweepAngle * Math.max(0, Math.min(1, t));
  output[offset] =
    (circle.radius * (Math.cos(theta) - Math.cos(circle.startAngle))) /
    circle.normalGain;
  output[offset + 1] =
    (circle.radius * (Math.sin(circle.startAngle) - Math.sin(theta))) /
    circle.forwardGain;
  output[offset + 2] = (circle.arcLength * Math.sin(theta)) / circle.normalGain;
  output[offset + 3] =
    (circle.arcLength * Math.cos(theta)) / circle.forwardGain;
  return true;
}
