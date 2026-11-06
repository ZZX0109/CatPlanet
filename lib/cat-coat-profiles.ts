export const catCoatTypes = ["hairless", "short", "long"] as const;
export type CatCoatType = (typeof catCoatTypes)[number];
export type CoatRegion = "head" | "ruff" | "body";
export type CoatDefaults = {
  headFurDensity: number;
  headFurLength: number;
  ruffFurDensity: number;
  ruffFurLength: number;
  bodyFurDensity: number;
  bodyFurLength: number;
};
type LengthRange = { min: number; max: number; exponent: number };
export type CoatGroom = {
  lengths: Record<CoatRegion, LengthRange>;
  undercoatLength: [number, number];
  awnLength: [number, number];
  guardLength: [number, number];
  lift: [number, number];
  arch: number;
  tangent: number;
  gravity: number;
  clump: number;
  width: Record<CoatRegion, number>;
  tailFullness: number;
  breeches: number;
  roughness: number;
  flowSpread: number;
  flyawayShare: number;
};
export type CatCoatProfile = {
  id: CatCoatType;
  label: string;
  description: string;
  baseModel: "sphynx" | "norwegian";
  defaults: CoatDefaults;
  groom: CoatGroom;
};

const shortGroom: CoatGroom = {
  lengths: {
    // The reference skin is about three scene units tall (~30 cm). Keep
    // torso down in the millimetre range instead of an almost invisible film;
    // the anatomy map still shortens eyelids, muzzle, ears and paws separately.
    head: { min: 0.006, max: 0.085, exponent: 1.15 },
    ruff: { min: 0.012, max: 0.18, exponent: 1.15 },
    body: { min: 0.012, max: 0.2, exponent: 1.15 },
  },
  undercoatLength: [0.6, 0.84],
  awnLength: [0.86, 1.04],
  guardLength: [1.06, 1.22],
  lift: [0.22, 0.14],
  arch: 0.045,
  tangent: 0.88,
  gravity: 0.055,
  clump: 0.025,
  width: { head: 0.00075, ruff: 0.0009, body: 0.0009 },
  tailFullness: 0.72,
  breeches: 0.72,
  roughness: 0.88,
  flowSpread: 0.075,
  flyawayShare: 0.003,
};

const longGroom: CoatGroom = {
  lengths: {
    head: { min: 0.008, max: 0.165, exponent: 1.2 },
    ruff: { min: 0.028, max: 0.54, exponent: 1.2 },
    body: { min: 0.02, max: 0.4, exponent: 1.25 },
  },
  undercoatLength: [0.36, 0.65],
  awnLength: [0.7, 0.96],
  guardLength: [1.03, 1.22],
  lift: [0.3, 0.2],
  arch: 0.22,
  tangent: 0.92,
  gravity: 0.28,
  clump: 0.64,
  width: { head: 0.0011, ruff: 0.00185, body: 0.00165 },
  tailFullness: 1.55,
  breeches: 1.65,
  roughness: 0.84,
  flowSpread: 0.10,
  flyawayShare: 0.007,
};

export const catCoatProfiles: readonly CatCoatProfile[] = [
  {
    id: "hairless",
    label: "无毛猫",
    baseModel: "sphynx",
    description: "斯芬克斯基础形体，保留皮肤纹理、褶皱与原生面部。",
    defaults: {
      headFurDensity: 0,
      headFurLength: 0,
      ruffFurDensity: 0,
      ruffFurLength: 0,
      bodyFurDensity: 0,
      bodyFurLength: 0,
    },
    groom: shortGroom,
  },
  {
    id: "short",
    label: "短毛猫",
    baseModel: "norwegian",
    description: "密而贴伏的短绒，脸颊、四肢和尾巴保持清晰轮廓。",
    defaults: {
      headFurDensity: 85,
      headFurLength: 30,
      ruffFurDensity: 85,
      ruffFurLength: 40,
      bodyFurDensity: 85,
      bodyFurLength: 40,
    },
    groom: shortGroom,
  },
  {
    id: "long",
    label: "长毛猫",
    baseModel: "norwegian",
    description: "分层底绒与披毛，带胸颈围脖、后腿饰毛和蓬松尾毛。",
    defaults: {
      headFurDensity: 80,
      headFurLength: 55,
      ruffFurDensity: 80,
      ruffFurLength: 70,
      bodyFurDensity: 80,
      bodyFurLength: 65,
    },
    groom: longGroom,
  },
];

export function isCatCoatType(value: unknown): value is CatCoatType {
  return value === "hairless" || value === "short" || value === "long";
}

export function getCatCoatProfile(value: unknown): CatCoatProfile {
  return (
    catCoatProfiles.find((profile) => profile.id === value) ??
    catCoatProfiles[2]
  );
}
