export const shapeControls = [
  { key: "headWidth", label: "脸部宽度", group: "脸部", low: "窄", high: "宽" },
  {
    key: "cheeks",
    label: "脸颊饱满度",
    group: "脸部",
    low: "清瘦",
    high: "饱满",
  },
  { key: "muzzle", label: "口鼻长度", group: "脸部", low: "短", high: "长" },
  { key: "eyeSize", label: "眼睛大小", group: "脸部", low: "小", high: "大" },
  {
    key: "eyeSpacing",
    label: "眼睛间距",
    group: "脸部",
    low: "近",
    high: "远",
  },
  { key: "earSize", label: "耳朵大小", group: "脸部", low: "小", high: "大" },
  {
    key: "bodyWeight",
    label: "身体饱满度",
    group: "体型",
    low: "修长",
    high: "圆润",
  },
  {
    key: "bodyLength",
    label: "躯干长度",
    group: "体型",
    low: "短",
    high: "长",
  },
  { key: "legLength", label: "四肢长度", group: "体型", low: "短", high: "长" },
  {
    key: "tailLength",
    label: "尾巴长度",
    group: "体型",
    low: "短",
    high: "长",
  },
] as const;
export type ShapeKey = (typeof shapeControls)[number]["key"];
export type CatDesign = {
  schemaVersion: 1;
  shape: Record<ShapeKey, number>;
  coat: string;
  markings: string;
  eyes: string;
  pattern: "solid" | "tabby" | "bicolor" | "calico";
};
export type Pose = "stand" | "walk" | "rest";
export const designKey = "miaoxing.cat-studio.v1";
export const defaultDesign: CatDesign = {
  schemaVersion: 1,
  shape: Object.fromEntries(shapeControls.map((c) => [c.key, 50])) as Record<
    ShapeKey,
    number
  >,
  coat: "#ad7544",
  markings: "#593b29",
  eyes: "#92905b",
  pattern: "tabby",
};
export const presets: { name: string; design: CatDesign }[] = [
  { name: "橘色短毛", design: defaultDesign },
  {
    name: "银灰虎斑",
    design: {
      ...defaultDesign,
      coat: "#92938d",
      markings: "#373c3b",
      eyes: "#96b77d",
      shape: { ...defaultDesign.shape, headWidth: 62, cheeks: 62 },
    },
  },
  {
    name: "黑白短毛",
    design: {
      ...defaultDesign,
      pattern: "bicolor",
      coat: "#353838",
      markings: "#202526",
      eyes: "#b7b66b",
      shape: { ...defaultDesign.shape, bodyWeight: 32, headWidth: 40 },
    },
  },
  {
    name: "三花短毛",
    design: {
      ...defaultDesign,
      pattern: "calico",
      coat: "#c08a54",
      markings: "#343635",
      eyes: "#a3ab69",
      shape: { ...defaultDesign.shape, cheeks: 60, earSize: 45 },
    },
  },
];
export function parseDesign(raw: unknown): CatDesign {
  const data = raw as CatDesign;
  if (
    !data ||
    data.schemaVersion !== 1 ||
    !["solid", "tabby", "bicolor", "calico"].includes(data.pattern)
  )
    throw new Error("这不是受支持的猫咪外观文件。");
  for (const c of shapeControls)
    if (
      typeof data.shape?.[c.key] !== "number" ||
      !Number.isFinite(data.shape[c.key]) ||
      data.shape[c.key] < 0 ||
      data.shape[c.key] > 100
    )
      throw new Error("外形参数需要在 0 到 100 之间。");
  for (const key of ["coat", "markings", "eyes"] as const)
    if (!/^#[a-f\d]{6}$/i.test(data[key])) throw new Error("颜色格式不正确。");
  return {
    schemaVersion: 1,
    shape: Object.fromEntries(
      shapeControls.map((c) => [c.key, data.shape[c.key]]),
    ) as CatDesign["shape"],
    coat: data.coat,
    markings: data.markings,
    eyes: data.eyes,
    pattern: data.pattern,
  };
}
