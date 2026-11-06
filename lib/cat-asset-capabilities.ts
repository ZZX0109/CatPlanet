import * as THREE from "three";
import { creatorControls } from "./cat-creator-design";
import { catTopologyVersion, type CreatorBaseId } from "./cat-model-contract";

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
  if (!mesh.geometry.getAttribute("position") || !mesh.geometry.getAttribute("uv") ||
      !mesh.geometry.getAttribute("skinIndex") || !mesh.geometry.getAttribute("skinWeight") ||
      !mesh.skeleton?.bones.length)
    throw new Error("猫咪 bodySurface 缺少坐标、UV 或骨骼绑定。");
  return mesh;
}

export const requiredCreatorFaceTargets = [
  "Head_round", "Head_wedge",
  ...creatorControls.filter(c => c.group !== "fur" && c.key !== "headRound" && c.key !== "headWedge")
    .flatMap(c => [`Shape_${c.key}_low`, `Shape_${c.key}_high`]),
];

/** Both studio and room use this runtime inspection, rather than manifest counts. */
export function inspectCatAssetCapabilities(
  scene: THREE.Object3D,
  animations: THREE.AnimationClip[],
  base: CreatorBaseId,
) {
  const targets = new Set<string>();
  const bones = new Set<string>();
  const materials = new Set<string>();
  const meshes: { name: string; morphTargets: number; skinned: boolean }[] = [];
  scene.traverse(node => {
    if (node instanceof THREE.Bone) bones.add(node.name);
    if (!(node instanceof THREE.Mesh)) return;
    const names = Object.keys(node.morphTargetDictionary ?? {});
    names.forEach(name => targets.add(name));
    meshes.push({ name: node.name, morphTargets: names.length, skinned: node instanceof THREE.SkinnedMesh });
    for (const material of Array.isArray(node.material) ? node.material : [node.material])
      materials.add(material.name);
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
  try {
    const surface = resolveCatBodySurface(scene, base);
    bodySurface = surface.name;
    surface.skeleton.bones.forEach(bone => bodyJoints.add(bone.name));
  }
  catch (error) { bodySurfaceError = error instanceof Error ? error.message : String(error); }
  const missingBoundSemanticBones = Object.entries(semanticBones)
    .filter(([, name]) => !bodyJoints.has(name)).map(([semantic]) => semantic);
  return {
    evidence: "runtime-scene" as const,
    topologyVersion: catTopologyVersion(base),
    meshes, targets: [...targets].sort(), morphTargetCount: targets.size,
    baseFaceTargetCount: requiredCreatorFaceTargets.filter(name => targets.has(name)).length,
    blinkCorrectiveCount: [...targets].filter(name => name.startsWith("Blink_")).length,
    supportsBlink: targets.has("Blink"), missingFaceTargets,
    bones: [...bones].sort(), semanticBones, missingSemanticBones,
    bodyJoints: [...bodyJoints].sort(), missingBoundSemanticBones,
    animations: animations.map(clip => ({ name: clip.name, duration: clip.duration,
      tracks: clip.tracks.map(track => track.name) })),
    // Imported clip names alone are not proof of walk/rest semantics.
    motionSemantics: { stand: "authored-default-pose", rest: "procedural-rig-adapter", walk: "unverified" },
    materials: [...materials].sort(), bodySurface, bodySurfaceError,
    compatible: !missingFaceTargets.length && !missingSemanticBones.length &&
      !missingBoundSemanticBones.length && !bodySurfaceError,
  };
}
