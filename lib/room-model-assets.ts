import registry from "./room-model-assets.json";
import type { CreatorDesign } from "./cat-creator-design";
import { getCatCoatProfile } from "./cat-coat-profiles";
import { CatModelContractError, creatorDesignContract, validateCatRendererContract,
  CAT_RENDERER, type CatRenderer, type CatAssetRuntimeContract } from "./cat-model-contract";
export type RoomModelAsset = {
  base: string; url: string; sha256: string; bytes: number;
  templateId: string; schemaVersion: number; facing: number; roomSize: number;
  assetRevision: string; topologyVersion: string; groomSchemaVersion: number;
  /** Parameter versions to attempt after migration; never a binary certification. */
  requiredDesignSchemaVersions: number[];
  validationEvidence: {
    format: number; status: "unverified"; binaryStatus: "not-provided";
    auditContext: string; declarationScope: "load-requirements-only";
    requirementFields: string[]; validatedSha256: null; verifiedDesignSchemaVersions: number[];
    verifiedTopologyVersion: null; verifiedGroomSchemaVersion: null; verifiedRendererVersions: number[];
    localValidationReport: null; reason: string;
  };
} & CatAssetRuntimeContract;
const assets = registry.assets as Record<string, RoomModelAsset>;

/** All require the exact private archive. Fixture and metadata tests cannot complete them. */
export const LEGACY_ROOM_ASSET_LOCAL_CHECKS = [
  "archived-bytes-sha256", "v3-v4-v5-appearance-values", "body-surface-multi-primitive",
  "morph-dense-sparse-and-blink", "rig-material-groom-pose", "reload-and-old-account-restore",
] as const;

/** This API sees no bytes or authenticated local report and therefore cannot certify a model.
 * Even a forged/hand-edited status in JSON never upgrades the outcome to passed.
 * Evidence status is descriptive and does not disable an otherwise guarded runtime load.
 */
export function roomAssetValidationStatus(asset: RoomModelAsset) {
  return {
    status: "unverified" as const,
    evidence: "registry-requirements-only" as const,
    assetRevision: asset.assetRevision,
    binaryEvidence: "not-provided" as const,
    validatedSha256: null,
    verifiedDesignSchemaVersions: [] as number[],
    verifiedRendererVersions: [] as number[],
    requiredLocalChecks: LEGACY_ROOM_ASSET_LOCAL_CHECKS.map(id => ({ id, status: "unrun" as const })),
    limitation: "Registry declarations do not include archived bytes or an independently verified local report. Runtime scene validation is still required for each load.",
  };
}

export function currentRoomAsset(design: CreatorDesign): string {
  return registry.current[getCatCoatProfile(design.coatType).baseModel];
}
export function validateRoomModelAsset(asset: RoomModelAsset, design: CreatorDesign, renderer: CatRenderer = CAT_RENDERER): RoomModelAsset {
  validateCatRendererContract(asset, renderer);
  const contract = creatorDesignContract(design);
  if (!asset || asset.base !== getCatCoatProfile(design.coatType).baseModel ||
      asset.templateId !== design.templateId ||
      !asset.requiredDesignSchemaVersions.includes(contract.designSchemaVersion) ||
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
