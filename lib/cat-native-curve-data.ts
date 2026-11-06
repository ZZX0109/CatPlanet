/** Private prototype data contract. No renderer, texture, or source-asset edits. */
export const NATIVE_CURVE_POINTS = 9;
export const NATIVE_CURVE_TEXELS = NATIVE_CURVE_POINTS + 1;
export const NATIVE_CURVE_PREFIX_POINTS = 17;
export const NATIVE_CURVE_PREFIX_TEXELS = NATIVE_CURVE_PREFIX_POINTS + 1;
export const NATIVE_CURVE_PREFIX_LAYOUT = "native-curve17-prefix-v2";
export const NATIVE_CURVE_POINT_COLOR_TEXELS =
  NATIVE_CURVE_PREFIX_TEXELS + NATIVE_CURVE_PREFIX_POINTS;
export const NATIVE_CURVE_POINT_COLOR_LAYOUT = "native-curve17-point-color-v3";

type PointsPerCurve =
  typeof NATIVE_CURVE_POINTS | typeof NATIVE_CURVE_PREFIX_POINTS;

type Vec3 = [number, number, number];
export type NativeCurveRootBindings = {
  /** Source-skin vertex IDs, not Blender-imported vertex or face IDs. */
  triangleVertexIndices: Uint32Array;
  /** Three barycentric weights per curve, referenced to the same source skin. */
  barycentric: Float32Array;
  sourceAssetSHA256?: string;
};

export type NativeCurveInput = {
  /** Nine legacy knots, or seventeen native cache slots, per curve in Web space. */
  points: Float32Array;
  /** Omitted preserves the original nine-knot/ten-texel format byte for byte. */
  pointsPerCurve?: PointsPerCurve;
  /** Native17 only. Two to seventeen valid slots; remaining XYZ must repeat tip. */
  pointCounts?: Uint8Array;
  /** Physical radii in the same scene units: one per curve or one per point. */
  radii: Float32Array;
  /** One linear, unpremultiplied RGB value per curve; no sRGB conversion. */
  colors: Float32Array;
  /** Native17 only: per-slot scene-linear RGB; unused colours repeat the tip. */
  pointColors?: Float32Array;
  /** Optional CPU definitions for later transport. Not yet a GPU skin binding. */
  rootBindings?: NativeCurveRootBindings;
};

export type PackedNativeCurveData = {
  /** Native17/35 appends 17 RGB texels after the unchanged XYZr/root-metadata block. */
  data: Float32Array;
  width: number;
  height: number;
  curveCount: number;
  pointsPerCurve: PointsPerCurve;
  texelsPerCurve:
    | typeof NATIVE_CURVE_TEXELS
    | typeof NATIVE_CURVE_PREFIX_TEXELS
    | typeof NATIVE_CURVE_POINT_COLOR_TEXELS;
  /** Optional for existing legacy packets; required for Native17 packets. */
  layout?:
    | "native-curve9-v1"
    | typeof NATIVE_CURVE_PREFIX_LAYOUT
    | typeof NATIVE_CURVE_POINT_COLOR_LAYOUT;
  byteLength: number;
  /** Conservative uniform-CatmullRom Bezier-control-hull bounds plus radius. */
  bounds: { min: Vec3; max: Vec3 };
  maxRadius: number;
  rootBindings?: NativeCurveRootBindings;
};

/**
 * Pack flattened records into a real2D texture domain. A record may cross rows;
 * shader addresses are ivec2(texelIndex % width, texelIndex / width). Use
 * texelFetch/nearest RGBA32F, NoColorSpace, no mipmaps, flipY=false. The caller
 * owns any GPU texture; this function only allocates copied CPU data/bindings.
 */
export function packNativeCurveData(
  input: NativeCurveInput,
  options: { maxTextureSize: number; preferredWidth?: number },
): PackedNativeCurveData {
  const pointsPerCurve = input.pointsPerCurve ?? NATIVE_CURVE_POINTS;
  if (
    pointsPerCurve !== NATIVE_CURVE_POINTS &&
    pointsPerCurve !== NATIVE_CURVE_PREFIX_POINTS
  )
    throw new Error("Native curve point capacity must be nine or seventeen.");
  const nativePrefix = pointsPerCurve === NATIVE_CURVE_PREFIX_POINTS;
  const pointColor = input.pointColors !== undefined;
  const texelsPerCurve = nativePrefix
    ? pointColor
      ? NATIVE_CURVE_POINT_COLOR_TEXELS
      : NATIVE_CURVE_PREFIX_TEXELS
    : NATIVE_CURVE_TEXELS;
  const count = input.points.length / (pointsPerCurve * 3);
  const maximum = options.maxTextureSize;
  const preferred = options.preferredWidth ?? 2048;
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    !Number.isSafeInteger(preferred) ||
    preferred < 1
  )
    throw new Error(
      "Native curve texture dimensions require positive integer limits.",
    );
  if (
    !Number.isInteger(count) ||
    input.colors.length !== count * 3 ||
    (input.radii.length !== count &&
      input.radii.length !== count * pointsPerCurve)
  )
    throw new Error(
      "Native curves require complete XYZ records, one RGB, and one or per-slot radii per curve.",
    );
  if (
    !input.points.every(Number.isFinite) ||
    !input.colors.every((value) => Number.isFinite(value) && value >= 0) ||
    !input.radii.every((value) => Number.isFinite(value) && value >= 0)
  )
    throw new Error(
      "Native curve positions must be finite; radii and linear colours must also be nonnegative.",
    );
  if (
    pointColor &&
    (!nativePrefix ||
      !(input.pointColors instanceof Float32Array) ||
      input.pointColors.length !== count * pointsPerCurve * 3 ||
      !input.pointColors.every((value) => Number.isFinite(value) && value >= 0))
  )
    throw new Error(
      "Per-point colours require Native17 scene-linear Float32 RGB records.",
    );
  if (
    input.pointCounts !== undefined &&
    (!nativePrefix ||
      !(input.pointCounts instanceof Uint8Array) ||
      input.pointCounts.length !== count ||
      !input.pointCounts.every(
        (value) => value >= 2 && value <= pointsPerCurve,
      ))
  )
    throw new Error(
      "Native17 point counts must be a matching Uint8 array with values 2..17.",
    );
  if (nativePrefix && input.pointCounts)
    for (let curve = 0; curve < count; curve++) {
      const valid = input.pointCounts[curve];
      const tip = (curve * pointsPerCurve + valid - 1) * 3;
      for (let node = valid; node < pointsPerCurve; node++)
        for (let axis = 0; axis < 3; axis++)
          if (
            input.points[(curve * pointsPerCurve + node) * 3 + axis] !==
            input.points[tip + axis]
          )
            throw new Error(
              "Native17 unused XYZ slots must repeat the last valid point, not zero-pad.",
            );
          else if (
            input.pointColors &&
            input.pointColors[(curve * pointsPerCurve + node) * 3 + axis] !==
              input.pointColors[tip + axis]
          )
            throw new Error(
              "Native17 unused point colours must repeat the last valid tip colour.",
            );
    }
  const required = count * texelsPerCurve;
  if (!Number.isSafeInteger(required) || required > maximum * maximum)
    throw new Error(
      "Native curve records exceed the device MAX_TEXTURE_SIZE squared; use explicit batches.",
    );
  const binding = input.rootBindings;
  if (binding) {
    if (
      binding.triangleVertexIndices.length !== count * 3 ||
      binding.barycentric.length !== count * 3 ||
      !binding.barycentric.every(
        (value) =>
          Number.isFinite(value) && value >= -1e-6 && value <= 1 + 1e-6,
      )
    )
      throw new Error(
        "Native curve source bindings do not match the curve count.",
      );
    for (let i = 0; i < count; i++)
      if (
        Math.abs(
          binding.barycentric[i * 3] +
            binding.barycentric[i * 3 + 1] +
            binding.barycentric[i * 3 + 2] -
            1,
        ) > 1e-4
      )
        throw new Error("Native curve barycentric weights must sum to one.");
  }
  const width = Math.min(
    maximum,
    Math.max(1, Math.ceil(required / maximum), Math.min(preferred, required)),
  );
  const height = Math.max(1, Math.ceil(required / width));
  const data = new Float32Array(width * height * 4);
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let maxRadius = 0;
  for (let curve = 0; curve < count; curve++) {
    const base = curve * texelsPerCurve * 4;
    const valid = input.pointCounts?.[curve] ?? pointsPerCurve;
    for (let node = 0; node < pointsPerCurve; node++) {
      const source = (curve * pointsPerCurve + node) * 3;
      const destination = base + node * 4;
      for (let axis = 0; axis < 3; axis++) {
        const value = input.points[source + axis];
        data[destination + axis] = value;
        if (node < valid) {
          min[axis] = Math.min(min[axis], value);
          max[axis] = Math.max(max[axis], value);
        }
      }
      const radius =
        input.radii.length === count
          ? input.radii[curve]
          : input.radii[curve * pointsPerCurve + node];
      data[destination + 3] = radius;
      if (node < valid) maxRadius = Math.max(maxRadius, radius);
    }
    const color = base + pointsPerCurve * 4;
    data.set(input.colors.subarray(curve * 3, curve * 3 + 3), color);
    data[color + 3] = nativePrefix ? valid : 1;
    if (input.pointColors)
      for (let node = 0; node < pointsPerCurve; node++) {
        const source = (curve * pointsPerCurve + node) * 3;
        const destination = color + (node + 1) * 4;
        data.set(input.pointColors.subarray(source, source + 3), destination);
        data[destination + 3] = 1;
      }
    // Each CatmullRom segment equals a cubic Bezier. Its control hull gives a
    // conservative bound even when interpolation overshoots the supplied knots.
    for (let segment = 0; segment < valid - 1; segment++) {
      const p0 = base + Math.max(0, segment - 1) * 4;
      const p1 = base + segment * 4;
      const p2 = base + (segment + 1) * 4;
      const p3 = base + Math.min(valid - 1, segment + 2) * 4;
      for (let axis = 0; axis < 3; axis++) {
        const b1 = data[p1 + axis] + (data[p2 + axis] - data[p0 + axis]) / 6;
        const b2 = data[p2 + axis] - (data[p3 + axis] - data[p1 + axis]) / 6;
        min[axis] = Math.min(min[axis], b1, b2);
        max[axis] = Math.max(max[axis], b1, b2);
      }
    }
  }
  if (count === 0) (min.fill(0), max.fill(0));
  else
    for (let axis = 0; axis < 3; axis++)
      ((min[axis] -= maxRadius), (max[axis] += maxRadius));
  return {
    data,
    width,
    height,
    curveCount: count,
    pointsPerCurve,
    texelsPerCurve,
    ...(nativePrefix
      ? {
          layout: pointColor
            ? NATIVE_CURVE_POINT_COLOR_LAYOUT
            : NATIVE_CURVE_PREFIX_LAYOUT,
        }
      : {}),
    byteLength: data.byteLength,
    bounds: { min, max },
    maxRadius,
    ...(binding
      ? {
          rootBindings: {
            triangleVertexIndices: binding.triangleVertexIndices.slice(),
            barycentric: binding.barycentric.slice(),
            ...(binding.sourceAssetSHA256
              ? { sourceAssetSHA256: binding.sourceAssetSHA256 }
              : {}),
          },
        }
      : {}),
  };
}

/** CPU reference for a GLSL uniform CatmullRom with duplicated endpoint knots. */
export function sampleNativeCurveCatmullRom(
  packed: PackedNativeCurveData,
  curve: number,
  t: number,
): { position: Vec3; derivative: Vec3; radius: number; linearColor: Vec3 } {
  if (
    !Number.isInteger(curve) ||
    curve < 0 ||
    curve >= packed.curveCount ||
    !Number.isFinite(t)
  )
    throw new Error("Native curve sample is outside its valid domain.");
  const valid = getNativeCurvePointCount(packed, curve);
  const scaled = Math.max(0, Math.min(1, t)) * (valid - 1);
  const segment = Math.min(valid - 2, Math.floor(scaled));
  const u = scaled - segment,
    u2 = u * u,
    u3 = u2 * u;
  const base = curve * packed.texelsPerCurve * 4;
  const p0 = base + Math.max(0, segment - 1) * 4;
  const p1 = base + segment * 4;
  const p2 = base + (segment + 1) * 4;
  const p3 = base + Math.min(valid - 1, segment + 2) * 4;
  const position: Vec3 = [0, 0, 0],
    derivative: Vec3 = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    const a = packed.data[p0 + axis],
      b = packed.data[p1 + axis];
    const c = packed.data[p2 + axis],
      d = packed.data[p3 + axis];
    const first = -a + c,
      second = 2 * a - 5 * b + 4 * c - d;
    const third = -a + 3 * b - 3 * c + d;
    position[axis] = 0.5 * (2 * b + first * u + second * u2 + third * u3);
    // Derivative with respect to global normalized t, not segment-local u.
    derivative[axis] =
      0.5 * (first + 2 * second * u + 3 * third * u2) * (valid - 1);
  }
  const color = base + packed.pointsPerCurve * 4;
  const linearColor: Vec3 = [
    packed.data[color],
    packed.data[color + 1],
    packed.data[color + 2],
  ];
  if (packed.layout === NATIVE_CURVE_POINT_COLOR_LAYOUT) {
    const start = color + (segment + 1) * 4;
    for (let axis = 0; axis < 3; axis++)
      linearColor[axis] =
        packed.data[start + axis] * (1 - u) + packed.data[start + 4 + axis] * u;
  }
  return {
    position,
    derivative,
    // Linear radius interpolation cannot introduce negative cubic overshoot.
    radius: packed.data[p1 + 3] * (1 - u) + packed.data[p2 + 3] * u,
    linearColor,
  };
}

/** Decode layout and the valid prefix without using zero coordinates as a sentinel. */
export function getNativeCurvePointCount(
  packed: PackedNativeCurveData,
  curve: number,
): number {
  if (!Number.isInteger(curve) || curve < 0 || curve >= packed.curveCount)
    throw new Error("Native curve index is outside its valid domain.");
  if (
    packed.pointsPerCurve === NATIVE_CURVE_POINTS &&
    packed.texelsPerCurve === NATIVE_CURVE_TEXELS &&
    (packed.layout === undefined || packed.layout === "native-curve9-v1")
  )
    return NATIVE_CURVE_POINTS;
  if (
    packed.pointsPerCurve !== NATIVE_CURVE_PREFIX_POINTS ||
    !(
      (packed.texelsPerCurve === NATIVE_CURVE_PREFIX_TEXELS &&
        packed.layout === NATIVE_CURVE_PREFIX_LAYOUT) ||
      (packed.texelsPerCurve === NATIVE_CURVE_POINT_COLOR_TEXELS &&
        packed.layout === NATIVE_CURVE_POINT_COLOR_LAYOUT)
    )
  )
    throw new Error("Native curve packet layout is not supported.");
  const valid =
    packed.data[
      (curve * packed.texelsPerCurve + packed.pointsPerCurve) * 4 + 3
    ];
  if (
    !Number.isInteger(valid) ||
    valid < 2 ||
    valid > NATIVE_CURVE_PREFIX_POINTS
  )
    throw new Error("Native17 packet contains an invalid point count.");
  return valid;
}
