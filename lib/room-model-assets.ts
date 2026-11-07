import registry from "./room-model-assets.json";
import type { CreatorDesign } from "./cat-creator-design";
import { getCatCoatProfile } from "./cat-coat-profiles";
import { CatModelContractError, creatorDesignContract, validateCatRendererContract,
  CAT_RENDERER, type CatRenderer, type CatAssetRuntimeContract } from "./cat-model-contract";
export type RoomModelAsset = {
  base: string; url: string; sha256: string; bytes: number;
  templateId: string; schemaVersion: number; facing: number; roomSize: number;
  assetRevision: string; topologyVersion: string; groomSchemaVersion: number;
  supportedDesignSchemaVersions: number[];
} & CatAssetRuntimeContract;
const assets = registry.assets as Record<string, RoomModelAsset>;
export function currentRoomAsset(design: CreatorDesign): string {
  return registry.current[getCatCoatProfile(design.coatType).baseModel];
}
export function validateRoomModelAsset(asset: RoomModelAsset, design: CreatorDesign, renderer: CatRenderer = CAT_RENDERER): RoomModelAsset {
  validateCatRendererContract(asset, renderer);
  const contract = creatorDesignContract(design);
  if (!asset || asset.base !== getCatCoatProfile(design.coatType).baseModel ||
      asset.templateId !== design.templateId ||
      !asset.supportedDesignSchemaVersions.includes(contract.designSchemaVersion) ||
      asset.topologyVersion !== contract.topologyVersion ||
      asset.groomSchemaVersion !== contract.groomSchemaVersion ||
      asset.assetRevision !== asset.sha256)
    throw new Error("猫咪模型版本与外观不匹配，请重新导入外观。");
  return asset;
}
export function roomModelAsset(id: string, design: CreatorDesign): RoomModelAsset {
  const asset = Object.hasOwn(assets, id) ? assets[id] : undefined;
  if (!asset) throw new CatModelContractError("CAT_ASSET_NOT_REGISTERED", "猫咪模型资产未登记或已缺失，请保留原外观并重新选择模型。");
  return validateRoomModelAsset(asset, design);
}
