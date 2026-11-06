/** CPU-only canonical UV line moments. Does not create textures or materials. */
export type NativeCoatMomentLevel = {
  width: number;
  height: number;
  /** RG=confidence*(cos2theta,sin2theta), B=confidence, A=1. */
  floatData: Float32Array;
  /** RG=.5+.5*moment, B=confidence, A=1, quantized independently per mip. */
  rgba8Data: Uint8Array;
};

export const NATIVE_COAT_MOMENT_QUANTIZATION = {
  signedMomentMaximumError: 1 / 255,
  confidenceMaximumError: 0.5 / 255,
  zeroMomentMagnitudeGuard: Math.SQRT2 / 255 + 1e-7,
} as const;

const quantize = (data: Float32Array) => {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    out[i] = Math.round((data[i] * 0.5 + 0.5) * 255);
    out[i + 1] = Math.round((data[i + 1] * 0.5 + 0.5) * 255);
    out[i + 2] = Math.round(data[i + 2] * 255);
    out[i + 3] = 255;
  }
  return out;
};

/**
 * Input is native-coat-flow HWC(cos2theta,sin2theta,confidence), row0 image top.
 * Both input and output directors retain Blender UV+u right/+v up. In
 * particular this function NEVER reflects sin2theta or flips image rows.
 * Caller supplies the Web UV adapter and actual surface Jacobian separately.
 * Mips average premultiplied complex line moments, never half-angle vectors.
 */
export function buildNativeCoatMomentMips(input: {
  data: Float32Array;
  width: number;
  height: number;
}): {
  levels: NativeCoatMomentLevel[];
  basis: "blender-uv-up";
  rowOrder: "image-top-first-unchanged";
  maximumInputDirectorNormalization: number;
  quantization: typeof NATIVE_COAT_MOMENT_QUANTIZATION;
} {
  const { data, width, height } = input;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    !Number.isSafeInteger(width * height) ||
    data.length !== width * height * 3
  )
    throw new Error(
      "Native coat line moments require positive dimensions and three channels per texel.",
    );
  const base = new Float32Array(width * height * 4);
  let maximumInputDirectorNormalization = 0;
  for (let i = 0; i < width * height; i++) {
    const x = data[i * 3],
      y = data[i * 3 + 1],
      confidence = data[i * 3 + 2];
    if (
      ![x, y, confidence].every(Number.isFinite) ||
      confidence < 0 ||
      confidence > 1
    )
      throw new Error(
        "Native coat line data must be finite with confidence in[0,1].",
      );
    const magnitude = Math.hypot(x, y);
    if (confidence > 0 && Math.abs(magnitude - 1) > 1e-4)
      throw new Error(
        "Known native coat directors must be unit double-angle vectors.",
      );
    if (confidence > 0) {
      maximumInputDirectorNormalization = Math.max(
        maximumInputDirectorNormalization,
        Math.abs(magnitude - 1),
      );
      base[i * 4] = (confidence * x) / magnitude;
      base[i * 4 + 1] = (confidence * y) / magnitude;
    }
    base[i * 4 + 2] = confidence;
    base[i * 4 + 3] = 1;
  }
  const levels: NativeCoatMomentLevel[] = [
    { width, height, floatData: base, rgba8Data: quantize(base) },
  ];
  while (levels.at(-1)!.width > 1 || levels.at(-1)!.height > 1) {
    const prior = levels.at(-1)!;
    const w = Math.max(1, Math.floor(prior.width / 2));
    const h = Math.max(1, Math.floor(prior.height / 2));
    const next = new Float32Array(w * h * 4);
    // Exact source-cell footprint overlap handles odd dimensions without
    // dropping the last row/column. Power-of-two inputs reduce to a2x2 box.
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const x0 = (x * prior.width) / w,
          x1 = ((x + 1) * prior.width) / w;
        const y0 = (y * prior.height) / h,
          y1 = ((y + 1) * prior.height) / h;
        const out = (y * w + x) * 4;
        for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++)
          for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
            const area =
              ((Math.min(x1, sx + 1) - Math.max(x0, sx)) *
                (Math.min(y1, sy + 1) - Math.max(y0, sy))) /
              ((x1 - x0) * (y1 - y0));
            const source = (sy * prior.width + sx) * 4;
            for (let k = 0; k < 3; k++)
              next[out + k] += prior.floatData[source + k] * area;
          }
        next[out + 3] = 1;
      }
    levels.push({
      width: w,
      height: h,
      floatData: next,
      rgba8Data: quantize(next),
    });
  }
  return {
    levels,
    basis: "blender-uv-up",
    rowOrder: "image-top-first-unchanged",
    maximumInputDirectorNormalization,
    quantization: NATIVE_COAT_MOMENT_QUANTIZATION,
  };
}

/** Reference decoder for a texel or a bilinearly/trilinearly interpolated sample. */
export function decodeNativeCoatMoment(
  sample: ArrayLike<number>,
  encoding: "float" | "rgba8",
  offset = 0,
): {
  moment: [number, number];
  confidence: number;
  concentration: number;
  strength: number;
  cos2theta: number;
  sin2theta: number;
  validAxis: boolean;
} {
  const confidence = Math.max(
    0,
    Math.min(1, sample[offset + 2] / (encoding === "rgba8" ? 255 : 1)),
  );
  const x =
    encoding === "rgba8" ? sample[offset] * (2 / 255) - 1 : sample[offset];
  const y =
    encoding === "rgba8"
      ? sample[offset + 1] * (2 / 255) - 1
      : sample[offset + 1];
  const magnitude = Math.hypot(x, y);
  const zero =
    encoding === "rgba8"
      ? NATIVE_COAT_MOMENT_QUANTIZATION.zeroMomentMagnitudeGuard
      : 1e-8;
  if (confidence === 0 || !Number.isFinite(magnitude) || magnitude <= zero)
    return {
      moment: [0, 0],
      confidence,
      concentration: 0,
      strength: 0,
      cos2theta: 0,
      sin2theta: 0,
      validAxis: false,
    };
  // Quantization can put |moment| slightly above confidence; never amplify it.
  const strength = Math.min(magnitude, confidence);
  return {
    moment: [(x * strength) / magnitude, (y * strength) / magnitude],
    confidence,
    concentration: strength / confidence,
    strength,
    cos2theta: x / magnitude,
    sin2theta: y / magnitude,
    validAxis: true,
  };
}
