/**
 * Authored canonical cat groom. These are surface-projected guide curves, not
 * predictions from a reconstruction network. Their root-relative offsets are
 * stored in the root's tangent/normal frame and can follow the existing skin.
 */
import { createCatLongCheekGroom } from "./cat-long-cheek-groom";

export type GroomVec3 = [number, number, number];
type Bounds = { min: GroomVec3; max: GroomVec3 };
type HairKind = "down" | "awn" | "guard";
type Anatomy = { head?: number; limb?: number; tail?: number };
type Landmarks = {
  eyeCenters: GroomVec3[];
  earBases: GroomVec3[];
  headBounds: Bounds;
  bodyBounds: Bounds;
};
type Surface = {
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  included: ArrayLike<number>;
  head: ArrayLike<number>;
  limb: ArrayLike<number>;
  tail: ArrayLike<number>;
  uv(vertex: number): [number, number];
};
/** Four non-root knots; each is [normal, forward, transverse] / hair length. */
export const CAT_GROOM_CURVE_STRIDE = 12;
type GuideStyle = {
  longOnly?: boolean;
  outerCoatOnly?: boolean;
  restrictRegion?: "ruff";
  longLengthScale?: number;
  longWidthScale?: number;
  influence?: number;
};
export type CatGroomGuide = GuideStyle & {
  name: string;
  root: GroomVec3;
  normal: GroomVec3;
  comb: GroomVec3;
  bend: GroomVec3;
  radius: number;
  anatomy: Required<Anatomy>;
  curve: readonly number[];
  longCurve: readonly number[];
  followRootAxis?: boolean;
  surfaceVertex?: number;
  uv?: [number, number];
};
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const dot = (a: GroomVec3, b: GroomVec3) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: GroomVec3): GroomVec3 => {
  const d = Math.hypot(...a) || 1;
  return [a[0] / d, a[1] / d, a[2] / d];
};
const cross = (a: GroomVec3, b: GroomVec3): GroomVec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const tangent = (a: GroomVec3, n: GroomVec3): GroomVec3 => {
  const d = dot(a, n);
  return unit([a[0] - n[0] * d, a[1] - n[1] * d, a[2] - n[2] * d]);
};

// Hand-authored radial rise, lay and side bend. A guard is a curved space
// strand: its normal height peaks before its tip instead of pointing straight
// out from the skin. Distinct patches form the ruff, cheek fans and tail plume.
const curves = {
  velvet: [
    0.055, 0.23, 0.002, 0.095, 0.48, 0.006, 0.1, 0.73, 0.009, 0.075, 0.99,
    0.012,
  ],
  crown: [
    0.12, 0.2, 0.007, 0.23, 0.43, 0.02, 0.22, 0.7, 0.035, 0.13, 0.99, 0.025,
  ],
  cheek: [
    0.2, 0.17, 0.012, 0.35, 0.39, 0.05, 0.31, 0.68, 0.115, 0.18, 1.0, 0.17,
  ],
  ruff: [
    0.28, 0.16, 0.016, 0.51, 0.4, 0.07, 0.47, 0.73, 0.16, 0.28, 1.04, 0.24,
  ],
  shoulder: [
    0.25, 0.17, 0.008, 0.46, 0.4, 0.035, 0.42, 0.71, 0.08, 0.23, 1.0, 0.13,
  ],
  back: [
    0.27, 0.18, 0.006, 0.49, 0.41, 0.025, 0.45, 0.71, 0.06, 0.25, 1.01, 0.1,
  ],
  flank: [
    0.23, 0.18, 0.01, 0.43, 0.42, 0.045, 0.39, 0.73, 0.105, 0.23, 1.04, 0.18,
  ],
  breeches: [
    0.29, 0.14, 0.012, 0.53, 0.36, 0.045, 0.5, 0.68, 0.095, 0.31, 1.0, 0.13,
  ],
  limb: [
    0.09, 0.23, 0.003, 0.17, 0.49, 0.01, 0.17, 0.76, 0.02, 0.11, 1.04, 0.03,
  ],
  tail: [
    0.35, 0.11, 0.01, 0.63, 0.3, 0.04, 0.64, 0.59, 0.085, 0.43, 0.91, 0.14,
  ],
} as const;

// The long template has a real undercoat envelope over the flank and rump,
// not just longer tangential bristles. Its chest rises gradually before
// laying into the ruff; the tail has its own broad plume cross-section.
// The compact template above stays unchanged for close-lying short fur.
const longCurves = {
  cheek: [
    0.2, 0.17, 0.012, 0.37, 0.39, 0.045, 0.42, 0.68, 0.1, 0.23, 1.0, 0.16,
  ],
  ruff: [
    0.18, 0.18, 0.012, 0.36, 0.41, 0.055, 0.4, 0.73, 0.13, 0.27, 1.03, 0.19,
  ],
  shoulder: [
    0.28, 0.15, 0.01, 0.72, 0.36, 0.045, 0.8, 0.65, 0.11, 0.47, 0.96, 0.16,
  ],
  back: [
    0.27, 0.18, 0.008, 0.72, 0.41, 0.035, 0.78, 0.72, 0.075, 0.44, 1.02, 0.12,
  ],
  flank: [
    0.25, 0.16, 0.012, 0.7, 0.37, 0.055, 0.72, 0.68, 0.13, 0.44, 1.02, 0.2,
  ],
  breeches: [
    0.28, 0.14, 0.014, 0.78, 0.34, 0.05, 0.84, 0.65, 0.12, 0.55, 0.99, 0.18,
  ],
  tail: [
    0.38, 0.1, 0.012, 0.88, 0.27, 0.045, 0.94, 0.54, 0.1, 0.68, 0.85, 0.16,
  ],
} as const;

// Preserve the existing radial crown above the supporting undercoat surface.
// The shorter tangential travel and slower tip make down curl into the ruff
// rather than duplicating every outer lock's long vertical drape.
const longRuffOuterCurve = [
  0.18, 0.18, 0.012, 0.36, 0.40, 0.055, 0.4, 0.65, 0.13, 0.27, 0.80, 0.19,
] as const;
const longRuffDownCurve = [
  0.18, 0.18, 0.012, 0.36, 0.37, 0.055, 0.4, 0.54, 0.13, 0.27, 0.65, 0.19,
] as const;

// Tail curves must cover the whole circumference, including skin whose normal
// faces away from the single projected tail guide. Distinct supporting down
// and longer primary hairs use the already bound root-to-tip axis, not flank
// fallback curves. These are authored groom offsets, not measured cat anatomy.
const longTailCurves = {
  down: [0.20, 0.12, 0, 0.50, 0.26, 0, 0.70, 0.40, 0, 0.42, 0.52, 0],
  awn: [0.16, 0.16, 0, 0.42, 0.34, 0, 0.62, 0.56, 0, 0.42, 0.76, 0],
} as const;

/** Rotate a guide frame to the queried surface normal without a sign flip. */
function carry(v: GroomVec3, from: GroomVec3, to: GroomVec3): GroomVec3 {
  const axis = cross(from, to);
  const first = cross(axis, v);
  const second = cross(axis, first);
  const k = 1 / Math.max(1e-6, 1 + dot(from, to));
  return [
    v[0] + first[0] + second[0] * k,
    v[1] + first[1] + second[1] * k,
    v[2] + first[2] + second[2] * k,
  ];
}

export function createCatGroomGuides(data: Landmarks, surface?: Surface) {
  const longCheek = createCatLongCheekGroom({
    eyeCenters: data.eyeCenters,
    headBounds: data.headBounds,
  });
  const ex = (data.eyeCenters[0][0] + data.eyeCenters[1][0]) * 0.5;
  const ey = (data.eyeCenters[0][1] + data.eyeCenters[1][1]) * 0.5;
  const ez = (data.eyeCenters[0][2] + data.eyeCenters[1][2]) * 0.5;
  const floor = data.bodyBounds.min[1];
  const height = data.bodyBounds.max[1] - floor;
  const scale = height / 3;
  const guides: CatGroomGuide[] = [];
  const add = (
    name: string,
    p: GroomVec3,
    n: GroomVec3,
    comb: GroomVec3,
    bend: GroomVec3,
    radius: number,
    curve: readonly number[],
    anatomy: Anatomy = {},
    followRootAxis = false,
    longCurve: readonly number[] = curve,
    style: GuideStyle = {},
  ) => {
    guides.push({
      name,
      root: [ex + p[0] * scale, ey + p[1] * scale, ez + p[2] * scale],
      normal: unit(n),
      comb: unit(comb),
      bend: unit(bend),
      radius: radius * scale,
      curve,
      longCurve,
      anatomy: {
        head: anatomy.head ?? 0,
        limb: anatomy.limb ?? 0,
        tail: anatomy.tail ?? 0,
      },
      followRootAxis,
      ...style,
    });
  };
  add(
    "crown",
    [0, 0.22, -0.14],
    [0, 0.7, 0.7],
    [0, 0.6, -0.8],
    [0, 0, -1],
    0.37,
    curves.crown,
    { head: 1 },
  );
  add(
    "chin",
    [0, -0.33, 0.08],
    [0, -0.6, 0.8],
    [0, -0.94, -0.34],
    [0, -1, 0],
    0.32,
    curves.velvet,
    { head: 1 },
  );
  for (const side of [-1, 1]) {
    add(
      `cheek-${side}`,
      [side * 0.34, -0.09, -0.04],
      [side * 0.75, 0.05, 0.66],
      [side * 0.64, -0.25, -0.73],
      [side * 0.8, -0.5, -0.25],
      0.37,
      curves.cheek,
      { head: 1 },
      false,
      longCurves.cheek,
    );
    add(
      `temple-${side}`,
      [side * 0.32, 0.1, -0.25],
      [side * 0.88, 0.2, 0.42],
      [side * 0.32, -0.22, -0.92],
      [side * 0.7, -0.1, -0.7],
      0.4,
      curves.crown,
      { head: 1 },
    );
    add(
      `ear-velvet-${side}`,
      [side * 0.31, 0.34, -0.29],
      [side * 0.2, 0.25, -0.95],
      [side * 0.1, 0.75, -0.65],
      [side, 0, 0],
      0.28,
      curves.velvet,
      { head: 1 },
    );
    add(
      `ruff-fan-${side}`,
      [side * 0.39, -0.62, -0.33],
      [side * 0.66, -0.06, 0.75],
      [side * 0.18, -0.9, -0.4],
      [side * 0.8, -0.55, 0],
      0.65,
      curves.ruff,
      {},
      false,
      longCurves.ruff,
    );
    add(
      `flank-${side}`,
      [side * 0.56, -1.05, -1.65],
      [side * 0.98, -0.1, 0.1],
      [0, -0.4, -0.92],
      [0, -0.86, -0.51],
      0.85,
      curves.flank,
      {},
      false,
      longCurves.flank,
    );
    add(
      `breeches-${side}`,
      [side * 0.45, -1.27, -2.35],
      [side * 0.95, 0.1, -0.25],
      [0, -0.95, -0.3],
      [side * 0.35, -0.9, -0.25],
      0.62,
      curves.breeches,
      { limb: 0.8 },
      true,
      longCurves.breeches,
    );
    add(
      `foreleg-${side}`,
      [side * 0.32, -1.85, -0.67],
      [side * 0.8, 0.05, 0.6],
      [0, -1, -0.1],
      [side * 0.25, -1, 0],
      0.57,
      curves.limb,
      { limb: 1 },
      true,
    );
  }
  add(
    "sternum",
    [0, -0.83, -0.17],
    [0, -0.15, 0.99],
    [0, -0.97, -0.24],
    [0, -1, 0],
    0.64,
    curves.ruff,
    {},
    false,
    longCurves.ruff,
  );
  add(
    "shoulder-ridge",
    [0, -0.55, -0.83],
    [0, 1, 0.1],
    [0, -0.1, -0.99],
    [0, 0, -1],
    0.73,
    curves.shoulder,
    {},
    false,
    longCurves.shoulder,
  );
  add(
    "back-ridge",
    [0, -0.61, -1.65],
    [0, 1, 0],
    [0, -0.08, -1],
    [0, 0, -1],
    0.9,
    curves.back,
    {},
    false,
    longCurves.back,
  );
  add(
    "tail-plume",
    [0.15, -1.14, -2.65],
    [0.1, 0.8, -0.58],
    [0.1, 0.1, -0.99],
    [0.2, -0.6, -0.77],
    0.73,
    curves.tail,
    { tail: 1 },
    true,
    longCurves.tail,
  );

  // A few hand-placed overlapping locks break up the outer ruff's uniform
  // curtain. Their roots/lengths/fans are canonical and shared by neighbours;
  // neither the short coat nor the supporting down is changed by these guides.
  for (const side of [-1, 1]) {
    const locks = [
      {
        name: "upper",
        p: [0.26, -0.46, -0.24],
        n: [0.3, -0.08, 0.95],
        comb: [0.29, -0.92, -0.26],
        length: 0.72,
        width: 0.9,
        radius: 0.23,
      },
      {
        name: "middle",
        p: [0.42, -0.7, -0.32],
        n: [0.65, -0.04, 0.76],
        comb: [0.32, -0.87, -0.38],
        length: 1.01,
        width: 0.97,
        radius: 0.25,
      },
      {
        name: "lower",
        p: [0.25, -0.91, -0.21],
        n: [0.35, -0.13, 0.93],
        comb: [0.08, -0.97, -0.24],
        length: 0.78,
        width: 0.88,
        radius: 0.23,
      },
    ];
    for (const lock of locks) {
      add(
        `ruff-lock-${side}-${lock.name}`,
        [side * lock.p[0], lock.p[1], lock.p[2]],
        [side * lock.n[0], lock.n[1], lock.n[2]],
        [side * lock.comb[0], lock.comb[1], lock.comb[2]],
        [side * 0.65, -0.75, -0.1],
        lock.radius,
        curves.ruff,
        {},
        false,
        longCurves.ruff,
        {
          longOnly: true,
          outerCoatOnly: true,
          restrictRegion: "ruff",
          longLengthScale: lock.length,
          longWidthScale: lock.width,
          influence: 2.2,
        },
      );
    }
  }
  add(
    "ruff-lock-center",
    [0, -0.57, -0.12],
    [0, -0.1, 0.995],
    [0, -0.98, -0.2],
    [0, -1, 0],
    0.22,
    curves.ruff,
    {},
    false,
    longCurves.ruff,
    {
      longOnly: true,
      outerCoatOnly: true,
      restrictRegion: "ruff",
      longLengthScale: 0.86,
      longWidthScale: 0.94,
      influence: 2.2,
    },
  );

  // Keep a short neck collar above the side chops and frontal bib instead of
  // combing the entire throat into one equally long curtain. Its reference
  // location is projected to real skin below; only the long outer ruff uses it.
  add(
    "short-neck-collar",
    [0, -0.35, -0.1],
    [0, -0.15, 0.99],
    [0, -0.98, -0.2],
    [0, -1, 0],
    0.2,
    curves.ruff,
    {},
    false,
    longCurves.ruff,
    {
      longOnly: true,
      outerCoatOnly: true,
      restrictRegion: "ruff",
      longLengthScale: 0.52,
      longWidthScale: 0.88,
      influence: 8,
    },
  );

  // Bind each authored location to the existing reference skin. The guide data
  // exposes its real surface root and source UV for inspection/DCC handoff.
  if (surface)
    for (const guide of guides) {
      let best = Infinity,
        chosen = -1;
      for (let i = 0; i < surface.included.length; i++) {
        if (!surface.included[i]) continue;
        const o = i * 3;
        const alignment =
          guide.normal[0] * surface.normals[o] +
          guide.normal[1] * surface.normals[o + 1] +
          guide.normal[2] * surface.normals[o + 2];
        const semantic =
          Math.abs((surface.head[i] ?? 0) - guide.anatomy.head) +
          Math.abs((surface.limb[i] ?? 0) - guide.anatomy.limb) +
          Math.abs((surface.tail[i] ?? 0) - guide.anatomy.tail);
        const dx = surface.positions[o] - guide.root[0],
          dy = surface.positions[o + 1] - guide.root[1],
          dz = surface.positions[o + 2] - guide.root[2];
        const score =
          (dx * dx + dy * dy + dz * dz) / (guide.radius * guide.radius) +
          1.4 * (1 - clamp(alignment)) +
          semantic * 1.25;
        if (score < best) {
          best = score;
          chosen = i;
        }
      }
      if (chosen >= 0) {
        const o = chosen * 3;
        guide.root = [
          surface.positions[o],
          surface.positions[o + 1],
          surface.positions[o + 2],
        ];
        guide.normal = unit([
          surface.normals[o],
          surface.normals[o + 1],
          surface.normals[o + 2],
        ]);
        guide.comb = tangent(guide.comb, guide.normal);
        guide.surfaceVertex = chosen;
        guide.uv = surface.uv(chosen);
      }
    }

  return {
    guides: guides as readonly CatGroomGuide[],
    /** Write four explicit normalized offsets in [N,T,B] root coordinates. */
    write(
      point: GroomVec3,
      sourceNormal: GroomVec3,
      sourceTangent: GroomVec3,
      anatomy: Anatomy,
      kind: HairKind,
      phase: number,
      out: Float32Array,
      offset: number,
      coat: "short" | "long" = "short",
      region?: "head" | "ruff" | "body",
    ) {
      const n = unit(sourceNormal),
        t = tangent(sourceTangent, n),
        b = unit(cross(n, t));
      for (let i = 0; i < CAT_GROOM_CURVE_STRIDE; i++) out[offset + i] = 0;
      let total = 0,
        lengthStyle = 0,
        widthStyle = 0,
        explicitStyleWeight = 0,
        explicitLength = 0,
        explicitWidth = 0;
      for (const guide of guides) {
        if (
          (guide.longOnly && coat !== "long") ||
          (guide.outerCoatOnly && kind === "down") ||
          (guide.restrictRegion && guide.restrictRegion !== region)
        )
          continue;
        const alignment = dot(n, guide.normal);
        if (alignment <= 0) continue;
        const dh = Math.abs((anatomy.head ?? 0) - guide.anatomy.head),
          dl = Math.abs((anatomy.limb ?? 0) - guide.anatomy.limb),
          dt = Math.abs((anatomy.tail ?? 0) - guide.anatomy.tail);
        const semantic =
          Math.max(0, 1 - dh * 0.96) *
          Math.max(0, 1 - dl * 0.92) *
          Math.max(0, 1 - dt * 0.99);
        const dx = point[0] - guide.root[0],
          dy = point[1] - guide.root[1],
          dz = point[2] - guide.root[2];
        const w =
          Math.exp(
            -(dx * dx + dy * dy + dz * dz) /
              (guide.radius * guide.radius * 0.65),
          ) *
          alignment *
          alignment *
          semantic *
          semantic *
          (guide.influence ?? 1);
        if (w < 1e-8) continue;
        const comb = guide.followRootAxis
          ? t
          : tangent(carry(guide.comb, guide.normal, n), n);
        // Sign consistency comes from the existing anatomical root field; a
        // nearby backwards-facing guide cannot turn a lock through the skin.
        if (dot(comb, t) < 0.15) continue;
        const side = unit(cross(n, comb));
        const bend = carry(guide.bend, guide.normal, n);
        const turn = dot(bend, side);
        const ct = dot(comb, t),
          cb = dot(comb, b),
          st = dot(side, t),
          sb = dot(side, b);
        for (let knot = 0; knot < 4; knot++) {
          const o = knot * 3,
            q = coat === "long"
              ? region === "ruff" && guide.longCurve === longCurves.ruff
                ? kind === "down" ? longRuffDownCurve : longRuffOuterCurve
                : guide.longCurve
              : guide.curve;
          // The soft down curls within the envelope rather than hanging as
          // another copy of the long outer locks. Primary hairs keep the
          // complete authored sweep, giving distinct layers without noise.
          const downLay = coat === "long" && kind === "down" ? 0.84 : 1;
          out[offset + o] += q[o] * w;
          out[offset + o + 1] +=
            (q[o + 1] * ct * downLay + q[o + 2] * turn * st) * w;
          out[offset + o + 2] +=
            (q[o + 1] * cb * downLay + q[o + 2] * turn * sb) * w;
        }
        total += w;
        lengthStyle += (guide.longLengthScale ?? 1) * w;
        widthStyle += (guide.longWidthScale ?? 1) * w;
        if (coat === "long" && region === "ruff" && kind !== "down" &&
            guide.longLengthScale !== undefined) {
          explicitStyleWeight += w;
          explicitLength += guide.longLengthScale * w;
          explicitWidth += (guide.longWidthScale ?? 1) * w;
        }
      }
      if (total < 1e-7) {
        const fallback = coat === "long" ? longCurves.flank : curves.flank;
        for (let knot = 0; knot < 4; knot++) {
          out[offset + knot * 3] = fallback[knot * 3];
          out[offset + knot * 3 + 1] = fallback[knot * 3 + 1];
          out[offset + knot * 3 + 2] = 0;
        }
        total = 1;
        lengthStyle = widthStyle = 1;
      }
      const loft =
        kind === "down"
          ? coat === "long"
            ? 0.94
            : 0.84
          : kind === "awn"
            ? 1
            : 1.03;
      const ripple = Math.sin(phase) * (kind === "down" ? 0.012 : 0.028);
      const tailT = coat === "long" && region === "body"
        ? clamp(((anatomy.tail ?? 0) - 0.55) / 0.35) : 0;
      const tailBlend = tailT * tailT * (3 - 2 * tailT);
      for (let knot = 0; knot < 4; knot++) {
        const o = offset + knot * 3,
          u = (knot + 1) * 0.25;
        out[o] = (out[o] / total) * loft;
        out[o + 1] /= total;
        out[o + 2] = out[o + 2] / total + ripple * Math.sin(Math.PI * u) * u;
        if (coat === "long" && region === "ruff" && kind !== "down") {
          // All outer ruff guides lay onto the supporting down, including
          // shoulder guides blended into this region. Keep the root tangent
          // and first radial crown; return the outer tip instead of a veil.
          const late = clamp((u - 0.25) / 0.75);
          const lay = late * late * (3 - 2 * late);
          out[o + 1] *= 1 - (kind === "awn" ? 0.30 : 0.18) * lay;
          const end = clamp((u - 0.5) / 0.5);
          out[o] *= 1 - 0.18 * end * end * (3 - 2 * end);
        }
        // Retain the original sparse guard curves: returning their tips here
        // worsened a finite resting-pose closest-surface check. Down and awn
        // still form the more compact supporting tail coat.
        if (tailBlend > 0 && kind !== "guard") {
          const q = longTailCurves[kind], at = knot * 3;
          const targetN = q[at] * loft;
          const targetT = q[at + 1] * (kind === "down" ? 0.84 : 1);
          const targetB = ripple * Math.sin(Math.PI * u) * u;
          out[o] += (targetN - out[o]) * tailBlend;
          out[o + 1] += (targetT - out[o + 1]) * tailBlend;
          out[o + 2] += (targetB - out[o + 2]) * tailBlend;
        }
      }
      if (coat === "long" && region === "head")
        longCheek.apply(point, n, t, b, anatomy.head ?? 0, kind, phase, loft, out, offset);
      if (explicitStyleWeight > 1e-8) {
        // General direction guides do not cancel a specifically authored
        // short collar/lock. Fade smoothly at the styled guide's support edge;
        // supporting down and every non-ruff region retain the original rule.
        const u = clamp(explicitStyleWeight / 0.35);
        const influence = u * u * (3 - 2 * u);
        return [
          1 + (explicitLength / explicitStyleWeight - 1) * influence,
          1 + (explicitWidth / explicitStyleWeight - 1) * influence,
        ] as const;
      }
      return [lengthStyle / total, widthStyle / total] as const;
    },
  };
}
