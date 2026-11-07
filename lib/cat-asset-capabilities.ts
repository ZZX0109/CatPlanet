import * as THREE from "three";
import { creatorControls, type CreatorDesign } from "./cat-creator-design";
import { CatModelContractError, catTopologyVersion, defaultCatAssetRuntimeContract,
  creatorDesignContract, validateCatRendererContract, type CatAssetRuntimeContract, type CreatorBaseId } from "./cat-model-contract";

export type BodySurfaceManifest = { bodySurface: string };
const legacyBodyNodes: Record<CreatorBaseId, string> = {
  norwegian: "NorwegianCat_Surface",
  sphynx: "SphynxCat_Surface",
};

/** Explicit authoring role/manifest takes precedence over the legacy named node.
 * Never infer anatomy from vertex count, material order or traversal order.
 * glTF splits the authored surface into body and eye material primitives. The
 * authoring contract identifies eye-globe roles explicitly; they never grow fur.
 */
export function resolveCatBodySurface(
  scene: THREE.Object3D,
  base: CreatorBaseId,
  manifest?: BodySurfaceManifest,
): THREE.SkinnedMesh {
  const candidates = new Set<THREE.Object3D>();
  if (manifest) {
    scene.traverse(node => { if (node.name === manifest.bodySurface) candidates.add(node); });
  } else {
    scene.traverse(node => {
      if (node.userData.bodySurface === true || node.userData.role === "bodySurface")
        candidates.add(node);
    });
    if (!candidates.size)
      scene.traverse(node => { if (node.name === legacyBodyNodes[base]) candidates.add(node); });
  }
  const meshes = new Set<THREE.SkinnedMesh>();
  for (const candidate of candidates)
    candidate.traverse(node => { if (node instanceof THREE.SkinnedMesh) meshes.add(node); });
  const materials = (mesh: THREE.SkinnedMesh) => Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const explicitBodies = [...meshes].filter(mesh => materials(mesh).some(material =>
    material.userData.creatorRole === "body-surface"));
  if (explicitBodies.length) {
    meshes.clear();
    explicitBodies.forEach(mesh => meshes.add(mesh));
  } else {
    // Supported legacy builder contract: refine-foundation-face.py assigns the
    // two globe primitives creatorRole=eye-globe and base_EyeOptics_L/R names.
    // This is semantic exclusion, not "choose the largest/first other mesh".
    for (const mesh of meshes)
      if (materials(mesh).every(material => material.userData.creatorRole === "eye-globe" ||
          new RegExp(`^${base}_EyeOptics_[LR]$`).test(material.name))) meshes.delete(mesh);
  }
  if (meshes.size !== 1)
    throw new Error(`猫咪 bodySurface 需要唯一明确的蒙皮表面，当前找到 ${meshes.size} 个。请检查节点标记或 manifest。`);
  const mesh = [...meshes][0];
  const position = mesh.geometry.getAttribute("position"), uv = mesh.geometry.getAttribute("uv"),
    skinIndex = mesh.geometry.getAttribute("skinIndex"), skinWeight = mesh.geometry.getAttribute("skinWeight");
  if (!position || position.itemSize !== 3 || !position.count || !uv || uv.itemSize !== 2 ||
      !skinIndex || skinIndex.itemSize !== 4 || !skinWeight || skinWeight.itemSize !== 4 ||
      uv.count !== position.count || skinIndex.count !== position.count || skinWeight.count !== position.count ||
      !mesh.skeleton?.bones.length || mesh.skeleton.boneInverses.length !== mesh.skeleton.bones.length)
    throw new Error("猫咪 bodySurface 缺少坐标、UV 或骨骼绑定。");
  return mesh;
}

export const requiredCreatorFaceTargets = [
  "Head_round", "Head_wedge",
  ...creatorControls.filter(c => c.group !== "fur" && c.key !== "headRound" && c.key !== "headWedge")
    .flatMap(c => [`Shape_${c.key}_low`, `Shape_${c.key}_high`]),
];

function backedMorphTargets(mesh: THREE.Mesh) {
  const positions = mesh.geometry.morphAttributes.position ?? [];
  const vertexCount = mesh.geometry.getAttribute("position")?.count;
  const entries = Object.entries(mesh.morphTargetDictionary ?? {});
  const uses = new Map<number, number>();
  for (const [, index] of entries) uses.set(index, (uses.get(index) ?? 0) + 1);
  return entries.filter(([, index]) => uses.get(index) === 1 &&
    Number.isInteger(index) && index >= 0 && positions[index]?.itemSize === 3 &&
    positions[index].count === vertexCount && typeof vertexCount === "number" && vertexCount > 0 &&
    typeof mesh.morphTargetInfluences?.[index] === "number" &&
    Number.isFinite(mesh.morphTargetInfluences[index])).map(([name]) => name);
}

/** Both studio and room use this runtime inspection, rather than manifest counts. */
export function inspectCatAssetCapabilities(
  scene: THREE.Object3D,
  animations: THREE.AnimationClip[],
  base: CreatorBaseId,
) {
  const targets = new Set<string>();
  const invalidMorphTargets: string[] = [];
  const bones = new Set<string>();
  const materials = new Set<string>();
  let portableMaterials = true;
  const meshes: { name: string; morphTargets: number; skinned: boolean }[] = [];
  scene.traverse(node => {
    if (node instanceof THREE.Bone) bones.add(node.name);
    if (!(node instanceof THREE.Mesh)) return;
    const names = backedMorphTargets(node);
    for (const name of Object.keys(node.morphTargetDictionary ?? {}))
      if (!names.includes(name)) invalidMorphTargets.push(`${node.name}:${name}`);
    names.forEach(name => targets.add(name));
    meshes.push({ name: node.name, morphTargets: names.length, skinned: node instanceof THREE.SkinnedMesh });
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material.name);
      if (!(material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial))
        portableMaterials = false;
    }
  });
  const semanticBones = base === "norwegian"
    ? { head: "head", neck: "neck_01", pelvis: "PantherPelvis" }
    : { head: "HeadSkinJnt", neck: "Neck1SkinJnt", pelvis: "PelvisSkinJnt" };
  const missingFaceTargets = requiredCreatorFaceTargets.filter(name => !targets.has(name));
  const missingSemanticBones = Object.entries(semanticBones)
    .filter(([, name]) => !bones.has(name)).map(([semantic]) => semantic);
  let bodySurface: string | null = null;
  let bodySurfaceError: string | null = null;
  const bodyJoints = new Set<string>();
  let bodyTargets: string[] = [];
  try {
    const surface = resolveCatBodySurface(scene, base);
    bodySurface = surface.name;
    bodyTargets = backedMorphTargets(surface);
    surface.skeleton.bones.forEach(bone => bodyJoints.add(bone.name));
  }
  catch (error) { bodySurfaceError = error instanceof Error ? error.message : String(error); }
  const missingBoundSemanticBones = Object.entries(semanticBones)
    .filter(([, name]) => !bodyJoints.has(name)).map(([semantic]) => semantic);
  const missingBodyFaceTargets = requiredCreatorFaceTargets.filter(name => !bodyTargets.includes(name));
  const observedCapabilities = [
    ...(!bodySurfaceError ? ["skinned-body-surface-v1", "groom-surface-v1"] : []),
    ...(!missingSemanticBones.length && !missingBoundSemanticBones.length ? ["rig-semantics-v1"] : []),
    ...(!missingFaceTargets.length && !missingBodyFaceTargets.length ? ["face-controls-v1"] : []),
    ...(meshes.length && portableMaterials ? ["source-materials-v1"] : []),
    ...(bodyTargets.includes("Blink") && requiredCreatorFaceTargets.every(name => bodyTargets.includes(`Blink_${name}`)) ? ["blink-correctives-v1"] : []),
  ];
  return {
    evidence: "runtime-scene" as const,
    topologyVersion: catTopologyVersion(base),
    meshes, targets: [...targets].sort(), morphTargetCount: targets.size,
    baseFaceTargetCount: requiredCreatorFaceTargets.filter(name => targets.has(name)).length,
    blinkCorrectiveCount: [...targets].filter(name => name.startsWith("Blink_")).length,
    supportsBlink: bodyTargets.includes("Blink"), missingFaceTargets, missingBodyFaceTargets, invalidMorphTargets,
    bones: [...bones].sort(), semanticBones, missingSemanticBones,
    bodyJoints: [...bodyJoints].sort(), missingBoundSemanticBones,
    animations: animations.map(clip => ({ name: clip.name, duration: clip.duration,
      tracks: clip.tracks.map(track => track.name) })),
    // Imported clip names alone are not proof of walk/rest semantics.
    motionSemantics: { stand: "authored-default-pose", rest: "procedural-rig-adapter", walk: "unverified" },
    materials: [...materials].sort(), bodySurface, bodySurfaceError,
    observedCapabilities,
    compatible: !missingFaceTargets.length && !missingSemanticBones.length &&
      !missingBoundSemanticBones.length && !missingBodyFaceTargets.length && !bodySurfaceError,
  };
}

/** Requirements never certify a private asset: loaded buffers and bindings must satisfy them. */
export function validateCatRuntimeCapabilities(
  scene: THREE.Object3D,
  animations: THREE.AnimationClip[],
  base: CreatorBaseId,
  design?: CreatorDesign,
  assetContract: CatAssetRuntimeContract = defaultCatAssetRuntimeContract(),
) {
  validateCatRendererContract(assetContract);
  if (!(scene instanceof THREE.Object3D))
    throw new CatModelContractError("CAT_MODEL_MISSING", "猫咪模型未加载，无法验证资产能力。");
  if (design && creatorDesignContract(design).topologyVersion !== catTopologyVersion(base))
    throw new CatModelContractError("CAT_TOPOLOGY_INCOMPATIBLE", "猫咪模型拓扑与当前外观不兼容。");
  const report = inspectCatAssetCapabilities(scene, animations, base);
  const required = new Set([...defaultCatAssetRuntimeContract().capabilities.required, ...assetContract.capabilities.required]);
  if (base !== "sphynx" && design?.coatMode === "groom") required.add("groom-surface-v1");
  const missing = [...required].filter(capability => !report.observedCapabilities.includes(capability));
  if (missing.length)
    throw new CatModelContractError("CAT_ASSET_CAPABILITY_MISSING",
      `实际猫咪模型缺少所需能力：${missing.join(", ")}。缺失形变：${[...new Set([...report.missingFaceTargets, ...report.missingBodyFaceTargets])].join(", ") || "无"}；${report.bodySurfaceError ?? "请检查骨骼或材质绑定。"}`);
  return report;
}
