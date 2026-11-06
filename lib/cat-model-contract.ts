import type { CreatorDesign } from "./cat-creator-design";
import { getCatCoatProfile } from "./cat-coat-profiles";

/** Parameter syntax, mesh layout, groom encoding and binary revision are independent. */
export const CREATOR_DESIGN_SCHEMA_VERSION = 5;
export const GROOM_SCHEMA_VERSION = 1;
export type CreatorBaseId = "norwegian" | "sphynx";
export const catTopologyVersion = (base: CreatorBaseId) => `${base}-cat-v1`;

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
