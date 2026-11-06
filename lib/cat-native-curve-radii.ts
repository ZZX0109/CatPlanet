/**
 * Source-derived radius profile for Blender 3.6 legacy particle PATH hair.
 * RNA root_radius/tip_radius are DIAMETERS despite their property names.
 * This reproduces the exporter formula, not a captured Cycles GPU radius buffer.
 */
export const NATIVE_RADIUS_FORMULA_SOURCE =
  "https://github.com/blender/blender/blob/v3.6.23/intern/cycles/blender/curves.cpp";
export const NATIVE_RADIUS_SCALE_SOURCE =
  "https://github.com/blender/blender/blob/v3.6.23/intern/cycles/scene/hair.cpp#L441";

export type NativeParticleRadiusParameters = {
  /** Copy of ParticleSettings.root_radius: root DIAMETER multiplier. */
  rootDiameter: number;
  /** Copy of ParticleSettings.tip_radius: tip DIAMETER multiplier. */
  tipDiameter: number;
  /** Copy of ParticleSettings.radius_scale: DIAMETER scale in emitter units. */
  diameterScale: number;
  shape: number;
  closeTip: boolean;
};

export type NativeCurveRadiiInput = {
  /** Actual evaluated co_hair WORLD coordinates; unused slots repeat the tip. */
  pointsWorld: Float32Array;
  pointCounts: Uint8Array;
  /** Cycles export key-slot count, e.g. 2^display_step+1, not each prefix size. */
  pointCapacity: number;
  parameters: NativeParticleRadiusParameters;
  /** Blender object.matrix_world, flattened COLUMN-major. Never apply twice. */
  objectMatrixWorld: ArrayLike<number>;
  /** Explicit output scene-units per Blender WORLD unit; 1 keeps world units. */
  worldToOutputScale: number;
  /**
   * Default matches Cycles' final EXPORT slot. Moving its cap to a shortened
   * prefix endpoint is an explicitly labelled geometry approximation.
   */
  capPolicy?: "cycles-export-slot" | "retained-prefix-tip";
};

function validateParameters(parameters: NativeParticleRadiusParameters) {
  if (
    ![
      parameters.rootDiameter,
      parameters.tipDiameter,
      parameters.diameterScale,
    ].every((value) => Number.isFinite(value) && value >= 0) ||
    !Number.isFinite(parameters.shape) ||
    parameters.shape < -1 ||
    parameters.shape > 1 ||
    typeof parameters.closeTip !== "boolean"
  )
    throw new Error(
      "Native particle radius parameters must be finite, nonnegative diameters and shape in [-1,1].",
    );
}

/** Nominal shaperadius before the separate close-tip slot override. */
export function nativeParticleRadiusAtArcFraction(
  parameters: NativeParticleRadiusParameters,
  normalizedArc: number,
): number {
  validateParameters(parameters);
  if (!Number.isFinite(normalizedArc) || normalizedArc < 0 || normalizedArc > 1)
    throw new Error(
      "Native particle radius requires an arc fraction in [0,1].",
    );
  const q = 1 - normalizedArc;
  const exponent =
    parameters.shape < 0
      ? 1 + parameters.shape
      : parameters.shape > 0
        ? 1 / (1 - parameters.shape)
        : 1;
  // C powf(1,+inf)=1, whereas JavaScript Math.pow(1,Infinity) is NaN.
  // At shape=-1 the zero exponent, including powf(0,0)=1, is intentional.
  const profile = q === 1 ? 1 : Math.pow(q, exponent);
  const root = parameters.diameterScale * 0.5 * parameters.rootDiameter;
  const tip = parameters.diameterScale * 0.5 * parameters.tipDiameter;
  return profile * (root - tip) + tip;
}

export function buildNativeCurveRadii(input: NativeCurveRadiiInput) {
  validateParameters(input.parameters);
  const capacity = input.pointCapacity;
  const count = input.pointCounts.length;
  const policy = input.capPolicy ?? "cycles-export-slot";
  if (
    !Number.isInteger(capacity) ||
    capacity < 2 ||
    capacity > 255 ||
    input.pointsWorld.length !== count * capacity * 3 ||
    !(input.pointCounts instanceof Uint8Array) ||
    !input.pointCounts.every((value) => value >= 2 && value <= capacity) ||
    !input.pointsWorld.every(Number.isFinite) ||
    !Number.isFinite(input.worldToOutputScale) ||
    input.worldToOutputScale <= 0 ||
    (policy !== "cycles-export-slot" && policy !== "retained-prefix-tip")
  )
    throw new Error(
      "Native radius input has invalid points, prefix counts, capacity, output scale or cap policy.",
    );
  const m = Array.from(input.objectMatrixWorld);
  if (
    m.length !== 16 ||
    !m.every(Number.isFinite) ||
    Math.abs(m[3]) > 1e-12 ||
    Math.abs(m[7]) > 1e-12 ||
    Math.abs(m[11]) > 1e-12 ||
    Math.abs(m[15] - 1) > 1e-12
  )
    throw new Error(
      "Native object matrix must be a finite affine column-major matrix.",
    );
  const a = m[0],
    b = m[4],
    c = m[8],
    d = m[1],
    e = m[5],
    f = m[9],
    g = m[2],
    h = m[6],
    i = m[10];
  const determinant =
    a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const lengths = [
    Math.hypot(a, d, g),
    Math.hypot(b, e, h),
    Math.hypot(c, f, i),
  ];
  if (!Number.isFinite(determinant) || lengths.some((value) => value <= 1e-12))
    throw new Error("Native object matrix cannot be singular.");
  const scaleDeviation = Math.max(...lengths) / Math.min(...lengths) - 1;
  const orthogonalityError = Math.max(
    Math.abs(a * b + d * e + g * h) / (lengths[0] * lengths[1]),
    Math.abs(a * c + d * f + g * i) / (lengths[0] * lengths[2]),
    Math.abs(b * c + e * f + h * i) / (lengths[1] * lengths[2]),
  );
  // Only tolerate normal Float32 matrix roundoff, never flatten an ellipsoid.
  if (scaleDeviation > 1e-6 || orthogonalityError > 1e-6)
    throw new Error(
      "A scalar native radius requires uniform object scale without shear.",
    );
  const objectScale = Math.cbrt(Math.abs(determinant));
  if (!Number.isFinite(objectScale) || objectScale <= 1e-12)
    throw new Error("Native object matrix cannot be singular.");
  const inverse = [
    (e * i - f * h) / determinant,
    (c * h - b * i) / determinant,
    (b * f - c * e) / determinant,
    (f * g - d * i) / determinant,
    (a * i - c * g) / determinant,
    (c * d - a * f) / determinant,
    (d * h - e * g) / determinant,
    (b * g - a * h) / determinant,
    (a * e - b * d) / determinant,
  ];
  const radiusScale = objectScale * input.worldToOutputScale;
  const radii = new Float32Array(count * capacity);
  const normalizedArc = new Float32Array(count * capacity);
  const objectCurveLengths = new Float64Array(count);
  const cumulative = new Float64Array(capacity);
  let shortenedCurves = 0,
    capOutsideValidPrefix = 0,
    zeroLengthCurves = 0;
  for (let curve = 0; curve < count; curve++) {
    const valid = input.pointCounts[curve],
      base = curve * capacity;
    const tip = (base + valid - 1) * 3;
    cumulative.fill(0);
    for (let node = 1; node < capacity; node++) {
      const current = (base + node) * 3,
        previous = current - 3;
      if (
        node >= valid &&
        [0, 1, 2].some(
          (axis) =>
            input.pointsWorld[current + axis] !== input.pointsWorld[tip + axis],
        )
      )
        throw new Error(
          "Native radius input must repeat the real tip in unused XYZ slots.",
        );
      const x = input.pointsWorld[current] - input.pointsWorld[previous],
        y = input.pointsWorld[current + 1] - input.pointsWorld[previous + 1],
        z = input.pointsWorld[current + 2] - input.pointsWorld[previous + 2];
      cumulative[node] =
        cumulative[node - 1] +
        Math.hypot(
          inverse[0] * x + inverse[1] * y + inverse[2] * z,
          inverse[3] * x + inverse[4] * y + inverse[5] * z,
          inverse[6] * x + inverse[7] * y + inverse[8] * z,
        );
    }
    const length = cumulative[capacity - 1];
    objectCurveLengths[curve] = length;
    if (length === 0) zeroLengthCurves++;
    if (valid < capacity) {
      shortenedCurves++;
      if (input.parameters.closeTip) capOutsideValidPrefix++;
    }
    for (let node = 0; node < capacity; node++) {
      const t = length > 0 ? cumulative[node] / length : 0;
      normalizedArc[base + node] = t;
      let radius =
        nativeParticleRadiusAtArcFraction(input.parameters, t) * radiusScale;
      if (
        input.parameters.closeTip &&
        (node === capacity - 1 ||
          (policy === "retained-prefix-tip" && node >= valid - 1))
      )
        radius = 0;
      radii[base + node] = radius;
    }
  }
  if (!radii.every(Number.isFinite) || !normalizedArc.every(Number.isFinite))
    throw new Error(
      "Native radius output overflowed its Float32 representation.",
    );
  return {
    radii,
    normalizedArc,
    objectCurveLengths,
    diagnostics: {
      curveCount: count,
      pointCapacity: capacity,
      capPolicy: policy,
      formula: "blender-3.6-cycles-legacy-particle-export",
      formulaSource: NATIVE_RADIUS_FORMULA_SOURCE,
      scaleSource: NATIVE_RADIUS_SCALE_SOURCE,
      numerics:
        "Float64 formula/arc calculations with Float32 radii; not a bitwise Cycles buffer capture",
      objectUniformScale: objectScale,
      objectScaleRelativeDeviation: scaleDeviation,
      objectOrthogonalityError: orthogonalityError,
      worldToOutputScale: input.worldToOutputScale,
      rootRadiusOutput:
        input.parameters.diameterScale *
        0.5 *
        input.parameters.rootDiameter *
        radiusScale,
      nominalTipRadiusOutput:
        input.parameters.diameterScale *
        0.5 *
        input.parameters.tipDiameter *
        radiusScale,
      shortenedCurves,
      zeroLengthCurves,
      closeTipOutsideValidPrefix: capOutsideValidPrefix,
      prefixCapApproximation:
        policy === "retained-prefix-tip" && capOutsideValidPrefix > 0,
      extraParticleOrChildSizeMultiplierApplied: false,
      upstreamSizeLengthRandomness:
        "Already represented by evaluated co_hair points; this Cycles export branch adds no independent per-particle/child radius multiplier",
      limitation:
        "A shortened-prefix renderer omits coincident padded end slots. Cycles-export-slot close-tip radii are exact formula slots, not proof of identical endpoint cap rasterization.",
    },
  };
}
