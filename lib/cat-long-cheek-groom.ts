/** Authored long-cat cheek locks in the existing canonical surface frame. */
export type CatLongCheekVec3 = readonly [number, number, number];
type V3 = CatLongCheekVec3;
type HairKind = "down" | "awn" | "guard";
type CheekData = {
  eyeCenters: readonly V3[];
  headBounds: { min: V3; max: V3 };
};

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const finite3 = (v: V3) =>
  v.length === 3 && Number.isFinite(v[0]) &&
  Number.isFinite(v[1]) && Number.isFinite(v[2]);

// Four non-root knots at t=.25/.5/.75/1. Raw N is multiplied by the supplied
// kind loft once; raw down T receives the established .84 lay once.
const profiles = {
  down: {
    upperN: [0.045, 0.08, 0.10, 0.065],
    lowerN: [0.11, 0.23, 0.30, 0.20],
    upperT: [0.16, 0.34, 0.55, 0.75],
    lowerT: [0.18, 0.43, 0.71, 0.99],
    variation: 0.02,
  },
  awn: {
    upperN: [0.065, 0.11, 0.14, 0.09],
    lowerN: [0.16, 0.33, 0.42, 0.27],
    upperT: [0.18, 0.40, 0.65, 0.90],
    lowerT: [0.23, 0.55, 0.94, 1.34],
    variation: 0.04,
  },
  guard: {
    upperN: [0.075, 0.13, 0.17, 0.10],
    lowerN: [0.18, 0.37, 0.46, 0.28],
    upperT: [0.20, 0.43, 0.72, 0.98],
    lowerT: [0.25, 0.62, 1.08, 1.57],
    variation: 0.065,
  },
} as const;

/**
 * Caller applies this only to long/head, after normalizing existing guide knots.
 * Coordinates follow the source canonical cat: +Y up, +Z towards the nose.
 * This is an editable anatomical approximation, not a measured coat-flow map.
 * No roots, widths, UVs, density, random stream or external input are changed.
 */
export function createCatLongCheekGroom(data: CheekData) {
  if (
    data.eyeCenters.length !== 2 ||
    !data.eyeCenters.every(finite3) ||
    !finite3(data.headBounds.min) || !finite3(data.headBounds.max)
  ) throw new Error("Long cheek groom requires finite paired eyes and head bounds.");
  const width = data.headBounds.max[0] - data.headBounds.min[0];
  const height = data.headBounds.max[1] - data.headBounds.min[1];
  if (width <= 0 || height <= 0)
    throw new Error("Long cheek groom head bounds must have positive extent.");
  // Copy the landmarks: later user code cannot mutate this canonical mask.
  const eyes = data.eyeCenters.map((p) => [...p] as [number, number, number]);
  const ex = (eyes[0][0] + eyes[1][0]) * 0.5;
  const ey = (eyes[0][1] + eyes[1][1]) * 0.5;
  const ez = (eyes[0][2] + eyes[1][2]) * 0.5;
  const scale = (width / 1.10 + height / 0.97) * 0.5;
  const inv = 1 / scale;

  return {
    /** Returns applied continuous weight; zero leaves all output bytes intact. */
    apply(
      point: V3, n: V3, t: V3, b: V3, headWeight: number,
      kind: HairKind, phase: number, loft: number,
      out: Float32Array, offset: number,
    ): number {
      if (!Number.isSafeInteger(offset) || offset < 0 || offset + 12 > out.length)
        throw new Error("Long cheek groom needs twelve output values at the offset.");
      if (!finite3(point) || !finite3(n) || !finite3(t) || !finite3(b) ||
        !Number.isFinite(headWeight) || !Number.isFinite(phase) ||
        !Number.isFinite(loft) || loft < 0 || !Object.hasOwn(profiles, kind))
        throw new Error("Long cheek groom received invalid frame or profile data.");
      const nl = Math.hypot(...n), tl = Math.hypot(...t), bl = Math.hypot(...b);
      if (Math.min(nl, tl, bl) < 1e-8) return 0;
      const x = (point[0] - ex) * inv;
      const y = (point[1] - ey) * inv;
      const z = (point[2] - ez) * inv;
      const side = x < 0 ? -1 : 1;
      const lateral = Math.abs(x);
      // Strict eye-line ceiling protects ear bases/crown without requiring a
      // guessed ear landmark. Forehead and central muzzle never join a lock.
      let weight = smooth(0.50, 0.88, headWeight)
        * smooth(0.18, 0.27, lateral) * (1 - smooth(0.51, 0.64, lateral))
        * smooth(-0.46, -0.35, y) * (1 - smooth(-0.07, 0.015, y))
        * smooth(-0.46, -0.30, z) * (1 - smooth(0.08, 0.19, z))
        * smooth(0.20, 0.65, Math.abs(n[0]) / nl);
      if (weight === 0) return 0;
      for (const eye of eyes) {
        const distance = ((point[0] - eye[0]) / (0.15 * scale)) ** 2
          + ((point[1] - eye[1]) / (0.115 * scale)) ** 2
          + ((point[2] - eye[2]) / (0.21 * scale)) ** 2;
        weight *= smooth(1.25, 2.80, distance);
      }
      // Conservative central whisker-pad/nose-mouth exclusion, inferred from
      // the eye frame. This mask proxy is not a reconstructed muzzle surface.
      const mouth = (x / 0.31) ** 2 + ((y + 0.26) / 0.22) ** 2
        + ((z - 0.20) / 0.27) ** 2;
      weight *= smooth(1.15, 1.90, mouth);
      if (weight === 0) return 0;

      const lower = 1 - smooth(-0.33, -0.11, y);
      // Upper cheek stays back-lying. Lower chops open laterally and sweep
      // downward/back into the ruff, using the caller's real surface frame.
      let dx = side * lerp(0.68, 0.40, lower);
      let dy = -lerp(0.22, 0.76, lower);
      let dz = -lerp(0.72, 0.54, lower);
      const projection = (dx * n[0] + dy * n[1] + dz * n[2]) / (nl * nl);
      dx -= n[0] * projection; dy -= n[1] * projection; dz -= n[2] * projection;
      const dl = Math.hypot(dx, dy, dz);
      if (dl < 1e-8) return 0;
      let ct = (dx * t[0] + dy * t[1] + dz * t[2]) / (dl * tl);
      let cb = (dx * b[0] + dy * b[1] + dz * b[2]) / (dl * bl);
      const span = Math.hypot(ct, cb);
      if (span < 1e-8) return 0;
      ct /= span; cb /= span;
      // Fade at an incompatible backwards-facing base field rather than
      // introducing a hard reversed lock or pulling through the face.
      weight *= smooth(0.15, 0.45, ct);
      if (weight === 0) return 0;

      const profile = profiles[kind];
      const lockVariation = 1 + Math.sin(phase) * profile.variation * lower;
      const downLay = kind === "down" ? 0.84 : 1;
      for (let i = 0; i < 12; i++)
        if (!Number.isFinite(out[offset + i]))
          throw new Error("Long cheek groom cannot mix nonfinite existing knots.");
      for (let knot = 0; knot < 4; knot++) {
        const at = offset + knot * 3;
        const targetN = lerp(profile.upperN[knot], profile.lowerN[knot], lower)
          * loft;
        const distance = lerp(profile.upperT[knot], profile.lowerT[knot], lower)
          * downLay * lockVariation;
        out[at] = lerp(out[at], targetN, weight);
        out[at + 1] = lerp(out[at + 1], distance * ct, weight);
        out[at + 2] = lerp(out[at + 2], distance * cb, weight);
      }
      return weight;
    },
  };
}
