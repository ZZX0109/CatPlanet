import registry from "./room-model-assets.json";
import type { CreatorDesign } from "./cat-creator-design";
import { getCatCoatProfile } from "./cat-coat-profiles";
export type RoomModelAsset = {
  base: string; url: string; sha256: string; bytes: number;
  templateId: string; schemaVersion: number; facing: number; roomSize: number;
};
const assets: Record<string, RoomModelAsset> = registry.assets;
export function currentRoomAsset(design: CreatorDesign): string {
  return registry.current[getCatCoatProfile(design.coatType).baseModel];
}
export function roomModelAsset(id: string, design: CreatorDesign): RoomModelAsset {
  const asset = Object.hasOwn(assets, id) ? assets[id] : undefined;
  if (!asset || asset.base !== getCatCoatProfile(design.coatType).baseModel ||
      asset.templateId !== design.templateId || asset.schemaVersion !== design.schemaVersion)
    throw new Error("猫咪模型版本与外观不匹配，请重新导入外观。");
  return asset;
}
