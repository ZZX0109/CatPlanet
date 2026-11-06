import {
  getCatCoatProfile,
  isCatCoatType,
  type CatCoatType,
} from "./cat-coat-profiles";

export type CreatorCoatType = CatCoatType;
export type CreatorCoatMode = "source" | "groom";
export type CreatorGroup = "head" | "eyes" | "muzzle" | "ears" | "fur";

export const creatorControls = [
  {
    key: "headRound",
    label: "圆润头型",
    group: "head",
    low: "基础",
    high: "圆润",
    description: "混合圆润的颅骨、脸颊和下颌轮廓，与楔形头型共同分配混合比例。",
    defaultValue: 0,
  },
  {
    key: "headWedge",
    label: "楔形头型",
    group: "head",
    low: "基础",
    high: "楔形",
    description: "混合较长的楔形颅骨和口鼻，与圆润头型共同分配混合比例。",
    defaultValue: 0,
  },
  {
    key: "headWidth",
    label: "头部宽度",
    group: "head",
    low: "窄一些",
    high: "宽一些",
    description: "调整整个猫头的横向轮廓，并保持眼眶与五官协调。",
    defaultValue: 50,
  },
  {
    key: "headDepth",
    label: "头部深度",
    group: "head",
    low: "浅一些",
    high: "深一些",
    description: "调整头颅的前后深度，侧面观察变化最清楚。",
    defaultValue: 50,
  },
  {
    key: "cheeks",
    label: "脸颊饱满度",
    group: "head",
    low: "清瘦",
    high: "饱满",
    description: "调整脸颊和颧部的体积，不用毛色模拟脸型。",
    defaultValue: 50,
  },
  {
    key: "jaw",
    label: "下颌宽度",
    group: "head",
    low: "收窄",
    high: "宽厚",
    description: "独立调整下颌与下巴两侧的宽度。",
    defaultValue: 50,
  },
  {
    key: "muzzle",
    label: "口鼻突出程度",
    group: "muzzle",
    low: "收回",
    high: "突出",
    description: "调整口鼻的实际前后深度，侧面可观察真实轮廓变化。",
    defaultValue: 50,
  },
  {
    key: "muzzleWidth",
    label: "口鼻宽度",
    group: "muzzle",
    low: "窄一些",
    high: "宽一些",
    description: "调整鼻口区域与胡须垫的横向宽度。",
    defaultValue: 50,
  },
  {
    key: "noseBridge",
    label: "鼻梁高度",
    group: "muzzle",
    low: "低一些",
    high: "高一些",
    description: "调整鼻梁的起伏，保留鼻口衔接。",
    defaultValue: 50,
  },
  {
    key: "eyeSize",
    label: "眼睛大小",
    group: "eyes",
    low: "小一些",
    high: "大一些",
    description: "协调调整眼球、眼眶和眼睑的大小。",
    defaultValue: 50,
  },
  {
    key: "eyeSpacing",
    label: "眼睛间距",
    group: "eyes",
    low: "靠近",
    high: "分开",
    description: "协调移动眼球、眼眶与眼睑的位置。",
    defaultValue: 50,
  },
  {
    key: "eyeTilt",
    label: "眼睛倾角",
    group: "eyes",
    low: "平缓",
    high: "上扬",
    description: "调整眼裂两端的倾角，保持眼睑包覆。",
    defaultValue: 50,
  },
  {
    key: "earSize",
    label: "耳朵大小",
    group: "ears",
    low: "小一些",
    high: "大一些",
    description: "以耳根为支点调整耳廓大小。",
    defaultValue: 50,
  },
  {
    key: "earTilt",
    label: "耳朵外张角度",
    group: "ears",
    low: "内收",
    high: "外张",
    description: "调整耳廓向两侧展开的角度。",
    defaultValue: 50,
  },
  {
    key: "headFurDensity",
    label: "头部毛量",
    group: "fur",
    low: "无毛束",
    high: "浓密",
    description: "调整头顶与脸颊的实际毛束数量，眼睛和鼻头不生毛。",
    defaultValue: 75,
  },
  {
    key: "headFurLength",
    label: "头部毛长",
    group: "fur",
    low: "贴伏短毛",
    high: "较长",
    description: "改变头顶与脸颊毛束的实际长度，眼周保留短毛。",
    defaultValue: 40,
  },
  {
    key: "ruffFurDensity",
    label: "胸颈毛量",
    group: "fur",
    low: "无毛束",
    high: "浓密",
    description: "独立调整脖颈、胸前围脖的实际毛束数量。",
    defaultValue: 75,
  },
  {
    key: "ruffFurLength",
    label: "胸颈毛长",
    group: "fur",
    low: "贴伏短毛",
    high: "蓬松长毛",
    description: "改变胸前与颈侧毛束的实际长度。",
    defaultValue: 55,
  },
  {
    key: "bodyFurDensity",
    label: "身体毛量",
    group: "fur",
    low: "无毛束",
    high: "浓密",
    description: "独立调整躯干、四肢与尾巴的实际毛束数量。",
    defaultValue: 75,
  },
  {
    key: "bodyFurLength",
    label: "身体毛长",
    group: "fur",
    low: "贴伏短毛",
    high: "长毛",
    description: "改变躯干、四肢和尾巴的毛束长度，并沿身体毛流贴合。",
    defaultValue: 45,
  },
].map((control) => ({ ...control, min: 0, max: 100, step: 1 })) as readonly {
  key:
    | "headRound"
    | "headWedge"
    | "headWidth"
    | "headDepth"
    | "cheeks"
    | "jaw"
    | "muzzle"
    | "muzzleWidth"
    | "noseBridge"
    | "eyeSize"
    | "eyeSpacing"
    | "eyeTilt"
    | "earSize"
    | "earTilt"
    | "headFurDensity"
    | "headFurLength"
    | "ruffFurDensity"
    | "ruffFurLength"
    | "bodyFurDensity"
    | "bodyFurLength";
  label: string;
  group: CreatorGroup;
  low: string;
  high: string;
  description: string;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
}[];

export type CreatorKey = (typeof creatorControls)[number]["key"];
export type CreatorDesign = {
  /** Legacy wire alias retained for old room records and existing clients. */
  schemaVersion: 5;
  designSchemaVersion?: 5;
  templateId: "cat-foundation-v1";
  coatType: CreatorCoatType;
  coatMode: CreatorCoatMode;
  shape: Record<CreatorKey, number>;
};

export const defaultCreatorDesign: CreatorDesign = {
  schemaVersion: 5,
  designSchemaVersion: 5,
  templateId: "cat-foundation-v1",
  coatType: "long",
  coatMode: "groom",
  shape: {
    ...Object.fromEntries(
      creatorControls.map(({ key, defaultValue }) => [key, defaultValue]),
    ),
    ...getCatCoatProfile("long").defaults,
  } as CreatorDesign["shape"],
};

export type CreatorPresetId = "round" | "natural" | "wedge";
export const creatorPresets: readonly {
  id: CreatorPresetId;
  label: string;
  description: string;
  design: CreatorDesign;
}[] = [
  {
    id: "round",
    label: "圆润脸",
    description: "宽额、圆颊、短口鼻",
    design: {
      ...defaultCreatorDesign,
      shape: {
        ...defaultCreatorDesign.shape,
        headRound: 100,
        headWidth: 75,
        headDepth: 35,
        cheeks: 80,
        jaw: 75,
        muzzle: 30,
        muzzleWidth: 60,
      },
    },
  },
  {
    id: "natural",
    label: "自然脸",
    description: "保留底模原始比例",
    design: {
      ...defaultCreatorDesign,
      shape: { ...defaultCreatorDesign.shape },
    },
  },
  {
    id: "wedge",
    label: "楔形脸",
    description: "窄脸、收颌、长口鼻",
    design: {
      ...defaultCreatorDesign,
      shape: {
        ...defaultCreatorDesign.shape,
        headWedge: 100,
        headWidth: 25,
        headDepth: 70,
        cheeks: 25,
        jaw: 30,
        muzzle: 80,
        muzzleWidth: 40,
      },
    },
  },
];

const allowedKeys = new Set<string>(creatorControls.map(({ key }) => key));
const previousV3FurDefaults: Record<string, number> = {
  headFurDensity: 75,
  headFurLength: 40,
  ruffFurDensity: 75,
  ruffFurLength: 55,
  bodyFurDensity: 75,
  bodyFurLength: 45,
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** This template has different topology and semantics from both older editors. */
export function parseCreatorDesign(input: unknown): CreatorDesign {
  // Accept the explicit name on new files while preserving legacy v3/v4/v5
  // records. When both aliases exist they must agree; do not silently repair a
  // contradictory contract. Shape migration below remains the single authority.
  if (isRecord(input) && Object.hasOwn(input, "designSchemaVersion")) {
    if (input.designSchemaVersion !== 5 ||
        (input.schemaVersion !== undefined && input.schemaVersion !== 5))
      throw new Error("外观参数版本标识冲突或不受支持。");
    const { designSchemaVersion: _version, ...legacy } = input;
    input = { ...legacy, schemaVersion: 5 };
  }
  const previousVersion =
    isRecord(input) &&
    input.schemaVersion === 3 &&
    input.templateId === "norwegian-cat-v1";
  const foundationVersion =
    isRecord(input) &&
    (input.schemaVersion === 4 || input.schemaVersion === 5) &&
    input.templateId === "cat-foundation-v1";
  const currentVersion = foundationVersion && isRecord(input) && input.schemaVersion === 5;
  const expectedKeys = previousVersion
    ? ["schemaVersion", "templateId", "shape"]
    : [
        "schemaVersion",
        "templateId",
        "coatType",
        "shape",
        ...(isRecord(input) && Object.hasOwn(input, "coatMode")
          ? ["coatMode"]
          : []),
      ];
  if (
    !isRecord(input) ||
    Object.keys(input).length !== expectedKeys.length ||
    Object.keys(input).some((key) => !expectedKeys.includes(key)) ||
    (!previousVersion && !foundationVersion) ||
    (foundationVersion && !isCatCoatType(input.coatType)) ||
    (foundationVersion &&
      Object.hasOwn(input, "coatMode") &&
      input.coatMode !== "source" &&
      input.coatMode !== "groom") ||
    !isRecord(input.shape) ||
    Object.keys(input.shape).some((key) => !allowedKeys.has(key))
  ) {
    throw new Error(
      "这不是可识别的猫咪模板外观文件，旧结构猫参数不能直接套用。",
    );
  }
  const shape = {} as CreatorDesign["shape"];
  for (const { key, min, max, group } of creatorControls) {
    // Earlier v3 files used this same cat topology but did not yet have a groom.
    // Fill only missing fur settings; face parameters remain strictly required.
    const value =
      input.shape[key] === undefined && group === "fur" && previousVersion
        ? previousV3FurDefaults[key]
        : input.shape[key];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < min ||
      value > max
    ) {
      throw new Error("猫咪参数需要是 0 到 100 之间的数字。");
    }
    shape[key] = value;
  }
  if (shape.headRound + shape.headWedge > 100) {
    throw new Error("圆润与楔形头型的混合比例之和不能超过 100。");
  }
  return {
    schemaVersion: 5,
    designSchemaVersion: 5,
    templateId: "cat-foundation-v1",
    coatType: previousVersion ? "long" : (input.coatType as CreatorCoatType),
    // Restore the complete coat for v3/v4 records without changing their
    // existing face or fur values. A v5 source choice remains explicit.
    coatMode:
      currentVersion && input.coatMode === "source" ? "source" : "groom",
    shape,
  };
}

/** Stable key order also makes undo/save comparisons independent of JSON order. */
export function serializeCreatorDesign(design: CreatorDesign): string {
  return JSON.stringify({
    schemaVersion: design.schemaVersion,
    designSchemaVersion: design.designSchemaVersion ?? design.schemaVersion,
    templateId: design.templateId,
    coatType: design.coatType,
    coatMode: design.coatMode ?? "groom",
    shape: Object.fromEntries(
      creatorControls.map(({ key }) => [key, design.shape[key]]),
    ),
  });
}
