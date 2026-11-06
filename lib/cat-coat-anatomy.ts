import { getCatCoatProfile, type CatCoatType } from "./cat-coat-profiles";

type V3 = [number, number, number];
type Bounds = { min: V3; max: V3 };
type Landmarks = {
  eyeCenters: V3[];
  earBases: V3[];
  muzzleCenter: V3;
  headBounds: Bounds;
  bodyBounds: Bounds;
};
export type CoatAnatomyWeights = {
  head?: number;
  limb?: number;
  hind?: number;
  tail?: number;
};
export type CoatAnatomySample = {
  /** Relative sampling weight, not follicles/mm². */
  density: number;
  lengthScale: number;
  widthScale: number;
  liftScale: number;
  crimp: number;
  downShare: number;
  awnShare: number;
  zones: {
    face: number;
    ear: number;
    ruff: number;
    belly: number;
    distalLimb: number;
    tail: number;
  };
};
export type CoatHairAnatomy = Pick<
  CoatAnatomySample,
  | "lengthScale"
  | "widthScale"
  | "liftScale"
  | "crimp"
  | "downShare"
  | "awnShare"
>;
export type CoatHairProfile = {
  kind: "down" | "awn" | "guard";
  layerT: number;
  lengthScale: number;
  widthScale: number;
  liftScale: number;
  crimp: number;
};
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Cat-inspired groom constraints in the undeformed surface frame. Studies of
 * normal cats support compound follicles and coarse primary/fine secondary
 * hairs, but do not provide a complete per-breed density/direction atlas.
 * Every regional coefficient here is an editable modelling approximation.
 */
export function createCatCoatAnatomy(data: Landmarks) {
  const ex = (data.eyeCenters[0][0] + data.eyeCenters[1][0]) / 2;
  const ey = (data.eyeCenters[0][1] + data.eyeCenters[1][1]) / 2;
  const ez = (data.eyeCenters[0][2] + data.eyeCenters[1][2]) / 2;
  const eyeSpan = Math.abs(data.eyeCenters[0][0] - data.eyeCenters[1][0]);
  const earY = Math.min(...data.earBases.map((p) => p[1]));
  const floor = data.bodyBounds.min[1];
  const height = data.bodyBounds.max[1] - floor;
  return {
    sample(
      point: V3,
      normal: V3,
      weights: CoatAnatomyWeights = {},
    ): CoatAnatomySample {
      const [x, y, z] = point;
      const geometricHead =
        smooth(data.headBounds.min[1] - 0.14, data.headBounds.min[1] + 0.3, y) *
        smooth(ez - 0.8, ez - 0.4, z);
      const head = clamp(weights.head ?? geometricHead);
      const limb = clamp(weights.limb ?? 0),
        tail = clamp(weights.tail ?? 0);
      const face =
        head *
        smooth(ez - 0.035, ez + 0.22, z) *
        (1 - smooth(ey + 0.08, ey + 0.27, y));
      const ear = head * smooth(earY + 0.025, earY + 0.2, y);
      const ruff =
        (1 - head) *
        smooth(ez - 0.95, ez - 0.55, z) *
        smooth(floor + height * 0.34, floor + height * 0.55, y) *
        (1 - limb);
      const belly =
        (1 - smooth(-0.48, -0.05, normal[1])) *
        (1 - smooth(floor + height * 0.4, floor + height * 0.58, y)) *
        (1 - limb) *
        (1 - tail);
      const distalLimb =
        limb * (1 - smooth(floor + height * 0.19, floor + height * 0.43, y));
      // Facial and distal-limb coverage stays dense, but uses much shorter hair.
      // Normal DSH measurements do not justify treating every leg as sparse.
      const density = clamp(
        0.84 + 0.11 * face + 0.07 * distalLimb - 0.14 * belly - 0.07 * ear,
        0.58,
        1,
      );
      // Give the short facial coat enough projection to read as fibres at a
      // close camera distance. The tiny patch above the nose stays shorter;
      // it must not become a row of whisker-like hairs across the nose tip.
      const noseCap = face *
        (1 - smooth(eyeSpan * 0.12, eyeSpan * 0.38, Math.abs(x - ex))) *
        smooth(data.muzzleCenter[1] - 0.015, data.muzzleCenter[1] + 0.03, y) *
        (1 - smooth(data.muzzleCenter[1] + 0.105, data.muzzleCenter[1] + 0.145, y)) *
        smooth(data.muzzleCenter[2] - 0.1, data.muzzleCenter[2] - 0.02, z);
      const lengthScale =
        (1 - 0.57 * face) * (1 - 0.2 * noseCap) *
        (1 - 0.7 * ear) *
        (1 - 0.56 * distalLimb) *
        (1 + 0.1 * ruff + 0.06 * tail);
      const widthScale =
        (1 - 0.16 * face) * (1 - 0.15 * ear) * (1 - 0.08 * distalLimb);
      const liftScale =
        (1 - 0.4 * face) * (1 - 0.36 * ear) * (1 - 0.22 * distalLimb);
      // Compound-follicle observations support many more fine secondary hairs
      // than coarse primary hairs, with a different balance on back and belly.
      // These are representative rendering shares, not a measured follicle map.
      // Keep facial, limb and tail mixes independent of the trunk adjustment.
      const trunk = (1 - head) * (1 - limb) * (1 - tail);
      const downShare = clamp(
        0.74 +
          0.08 * face +
          0.04 * ear -
          0.035 * tail +
          trunk * (0.14 + 0.045 * belly - 0.035 * ruff),
        0.69,
        0.94,
      );
      const awnShare = clamp(
        0.205 -
          0.055 * face -
          0.02 * ear +
          0.02 * tail -
          trunk * (0.115 + 0.025 * belly - 0.025 * ruff),
        0.035,
        0.24,
      );
      return {
        density,
        lengthScale,
        widthScale,
        liftScale,
        crimp: 1 + 0.18 * ruff + 0.12 * belly,
        downShare,
        awnShare,
        zones: { face, ear, ruff, belly, distalLimb, tail },
      };
    },
  };
}

const profiles = {
  short: getCatCoatProfile("short").groom,
  long: getCatCoatProfile("long").groom,
};
const hairWidths = [0.62, 1, 1.78] as const;
const hairLifts = [1.12, 0.95, 0.78] as const;
const hairCrimps = [1.0, 0.43, 0.12] as const;
/** A three-type representative fibre; relative thickness is not a micron claim. */
export function coatHairProfile(
  layer: number,
  anatomy: CoatHairAnatomy,
  coat: CatCoatType,
  out: CoatHairProfile = {
    kind: "down",
    layerT: 0,
    lengthScale: 0,
    widthScale: 0,
    liftScale: 0,
    crimp: 0,
  },
): CoatHairProfile {
  const groom = profiles[coat === "long" ? "long" : "short"];
  const down = clamp(anatomy.downShare, 0.05, 0.93),
    awn = clamp(anatomy.awnShare, 0.02, 0.98 - down);
  const value = clamp(layer, 0, 0.999999999);
  const index = value < down ? 0 : value < down + awn ? 1 : 2;
  out.kind = index === 0 ? "down" : index === 1 ? "awn" : "guard";
  out.layerT =
    index === 0
      ? value / down
      : index === 1
        ? (value - down) / awn
        : (value - down - awn) / (1 - down - awn);
  const range =
    index === 0
      ? groom.undercoatLength
      : index === 1
        ? groom.awnLength
        : groom.guardLength;
  out.lengthScale = anatomy.lengthScale * lerp(range[0], range[1], out.layerT);
  // Normal DSH primary/secondary diameter measurements motivate a large
  // contrast, while visible ribbon widths remain a real-time approximation.
  out.widthScale = anatomy.widthScale * hairWidths[index];
  out.liftScale = anatomy.liftScale * hairLifts[index];
  out.crimp = anatomy.crimp * hairCrimps[index];
  if (coat === "hairless") out.lengthScale = out.widthScale = 0;
  return out;
}
