import type { CreatorDesign } from "./cat-creator-design";
import { getCatCoatProfile } from "./cat-coat-profiles";

/** Parameter syntax, mesh layout, groom encoding and binary revision are independent. */
export const CREATOR_DESIGN_SCHEMA_VERSION = 5;
export const GROOM_SCHEMA_VERSION = 1;
export type CreatorBaseId = "norwegian" | "sphynx";
export const catTopologyVersion = (base: CreatorBaseId) => `${base}-cat-v1`;

export const CAT_RENDERER = {
  rendererId: "miaoxing-three-cat",
  version: 1,
  contractVersion: 1,
  supportedCapabilities: ["face-controls-v1", "skinned-body-surface-v1", "rig-semantics-v1",
    "source-materials-v1", "groom-surface-v1", "blink-correctives-v1"],
};
export type CatRenderer = typeof CAT_RENDERER;
export type CatAssetRuntimeContract = {
  rendererCompatibility: { contractVersion: number; rendererId: string; rendererVersions: number[] };
  capabilities: {
    declarationVersion: number;
    /** These declarations are requirements. Actual private binaries are not certified by metadata. */
    evidence: "requirements-only";
    required: string[];
    optional: string[];
  };
};
export class CatModelContractError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "CatModelContractError"; }
}

export function defaultCatAssetRuntimeContract(): CatAssetRuntimeContract {
  return {
    rendererCompatibility: { contractVersion: 1, rendererId: CAT_RENDERER.rendererId, rendererVersions: [1] },
    capabilities: { declarationVersion: 1, evidence: "requirements-only",
      required: ["face-controls-v1", "skinned-body-surface-v1", "rig-semantics-v1", "source-materials-v1"],
      optional: ["groom-surface-v1", "blink-correctives-v1"] },
  };
}

/** Validate the declarative renderer contract before taking ownership of decoded resources. */
export function validateCatRendererContract(input: unknown, renderer: CatRenderer = CAT_RENDERER): CatAssetRuntimeContract {
  const value = input as Partial<CatAssetRuntimeContract> | null;
  const compatibility = value?.rendererCompatibility;
  if (!compatibility || compatibility.contractVersion !== renderer.contractVersion)
    throw new CatModelContractError("CAT_RENDERER_CONTRACT_UNSUPPORTED", "不支持的猫咪渲染器契约版本。");
  if (compatibility.rendererId !== renderer.rendererId)
    throw new CatModelContractError("CAT_RENDERER_UNSUPPORTED", `猫咪资产要求其他渲染器：${compatibility.rendererId}`);
  if (!Array.isArray(compatibility.rendererVersions) || !compatibility.rendererVersions.length ||
      !compatibility.rendererVersions.every(version => Number.isInteger(version) && version > 0) ||
      !compatibility.rendererVersions.includes(renderer.version))
    throw new CatModelContractError("CAT_RENDERER_VERSION_UNSUPPORTED", "猫咪资产不支持当前渲染器版本。");
  const capabilities = value?.capabilities;
  if (!capabilities || capabilities.declarationVersion !== 1 || capabilities.evidence !== "requirements-only" ||
      !Array.isArray(capabilities.required) || !Array.isArray(capabilities.optional))
    throw new CatModelContractError("CAT_CAPABILITY_DECLARATION_UNSUPPORTED", "猫咪资产缺少可识别的能力需求声明。");
  for (const capability of [...capabilities.required, ...capabilities.optional])
    if (typeof capability !== "string" || !renderer.supportedCapabilities.includes(capability))
      throw new CatModelContractError("CAT_CAPABILITY_UNSUPPORTED", `渲染器不支持猫咪资产能力：${String(capability)}`);
  return value as CatAssetRuntimeContract;
}

export function creatorDesignContract(design: CreatorDesign) {
  if (design.schemaVersion !== CREATOR_DESIGN_SCHEMA_VERSION ||
      (design.designSchemaVersion !== undefined &&
       design.designSchemaVersion !== CREATOR_DESIGN_SCHEMA_VERSION))
    throw new Error("不支持的猫咪外观参数版本。");
  return {
    designSchemaVersion: CREATOR_DESIGN_SCHEMA_VERSION,
    topologyVersion: catTopologyVersion(getCatCoatProfile(design.coatType).baseModel),
    groomSchemaVersion: GROOM_SCHEMA_VERSION,
  };
}
