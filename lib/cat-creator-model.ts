import * as THREE from "three";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import type { NorwegianFur } from "./norwegian-fur";
import type { CatCoatType } from "./cat-coat-profiles";
import { createCreatorMotion, type CreatorMotion } from "./cat-creator-motion";
import { createCatNativeCoatTuner } from "./cat-native-coat";
import {
  creatorControls,
  parseCreatorDesign,
  type CreatorDesign,
  type CreatorGroup,
  type CreatorCoatMode,
} from "./cat-creator-design";

type Coordinates = [number, number, number];
export type CreatorLandmarks = {
  eyeCenters: Coordinates[];
  earBases: Coordinates[];
  muzzleCenter: Coordinates;
};

export type CreatorModel = {
  baseId: "norwegian" | "sphynx";
  scene: THREE.Group;
  meshes: THREE.Mesh[];
  materials: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
  visibility: Map<THREE.Mesh, boolean>;
  targetNames: ReadonlySet<string>;
  /** Fixed, neutral head bounds for editing; full body stays in the same scene. */
  bounds: THREE.Box3;
  wholeBounds: THREE.Box3;
  landmarks: CreatorLandmarks;
  animations: THREE.AnimationClip[];
  supportsBlink: boolean;
  fur?: NorwegianFur;
  motion: CreatorMotion;
  framing(headOnly: boolean): THREE.Box3;
  anatomicalPoint(point: THREE.Vector3): THREE.Vector3;
  tuneCoatSurface(coat: CatCoatType, mode?: CreatorCoatMode): void;
  dispose(): void;
};

function coordinates(value: unknown): value is Coordinates {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}
function metadata(scene: THREE.Group): Record<string, unknown> {
  let result: Record<string, unknown> | undefined;
  scene.traverse((node) => {
    if (
      !result &&
      ["norwegian-cat-v1", "sphynx-cat-v1", "cat-foundation-v1"].includes(
        node.userData.creatorTemplateId,
      )
    )
      result = node.userData;
  });
  if (!result) throw new Error("模型缺少此版本母模的标识。");
  return result;
}

export function ownCreatorModel(
  scene: THREE.Group,
  animations: THREE.AnimationClip[] = [],
  expectedBase?: "norwegian" | "sphynx",
): CreatorModel {
  const meshes: THREE.Mesh[] = [];
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const visibility = new Map<THREE.Mesh, boolean>();
  const targetNames = new Set<string>();
  const sourceMaterials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  let coatTuner: ReturnType<typeof createCatNativeCoatTuner> | undefined;
  const skeletons = new Set<THREE.Skeleton>();
  const wholeBounds = new THREE.Box3();
  scene.updateMatrixWorld(true);
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    meshes.push(node);
    Object.keys(node.morphTargetDictionary ?? {}).forEach((name) =>
      targetNames.add(name),
    );
    geometries.add(node.geometry);
    materials.set(node, node.material);
    visibility.set(node, node.visible);
    node.castShadow = true;
    node.receiveShadow = true;
    if (node instanceof THREE.SkinnedMesh) {
      node.skeleton.update();
      skeletons.add(node.skeleton);
    }
    if (node.visible)
      wholeBounds.union(new THREE.Box3().setFromObject(node, true));
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      sourceMaterials.add(material);
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  let disposed = false;
  let resource: CreatorModel | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    resource?.motion.dispose();
    resource?.fur?.dispose();
    coatTuner?.dispose();
    geometries.forEach((item) => item.dispose());
    skeletons.forEach((skeleton) => skeleton.dispose());
    sourceMaterials.forEach((item) => item.dispose());
    textures.forEach((texture) => {
      const image = texture.source?.data;
      if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap)
        image.close();
      texture.dispose();
    });
  };
  try {
    const data = metadata(scene);
    const baseId =
      data.creatorBaseId === "sphynx" ||
      data.creatorTemplateId === "sphynx-cat-v1"
        ? "sphynx"
        : "norwegian";
    if (expectedBase && baseId !== expectedBase)
      throw new Error("基础猫与当前选择不匹配，请重新加载。");
    coatTuner = createCatNativeCoatTuner(sourceMaterials);
    const rawBounds = data.creatorHeadBounds as
      { min?: unknown; max?: unknown } | undefined;
    const rawLandmarks = data.creatorLandmarks as
      Partial<CreatorLandmarks> | undefined;
    if (
      !coordinates(rawBounds?.min) ||
      !coordinates(rawBounds?.max) ||
      !Array.isArray(rawLandmarks?.eyeCenters) ||
      rawLandmarks.eyeCenters.length !== 2 ||
      !rawLandmarks.eyeCenters.every(coordinates) ||
      !Array.isArray(rawLandmarks?.earBases) ||
      rawLandmarks.earBases.length !== 2 ||
      !rawLandmarks.earBases.every(coordinates) ||
      !coordinates(rawLandmarks?.muzzleCenter)
    )
      throw new Error("模型缺少头部观察范围或五官定位。");
    const bounds = new THREE.Box3(
      new THREE.Vector3(...rawBounds.min),
      new THREE.Vector3(...rawBounds.max),
    );
    const headBone = scene.getObjectByName(
      baseId === "sphynx" ? "HeadSkinJnt" : "head",
    );
    const inverseScene = scene.matrixWorld.clone().invert();
    const referenceHead = headBone
      ? new THREE.Matrix4()
          .multiplyMatrices(inverseScene, headBone.matrixWorld)
          .invert()
      : null;
    if (
      bounds.isEmpty() ||
      wholeBounds.isEmpty() ||
      !meshes.length ||
      !skeletons.size
    )
      throw new Error("基础猫网格或骨架不完整。");
    for (const name of ["Head_round", "Head_wedge"])
      if (!targetNames.has(name)) throw new Error(`缺少头型控制：${name}`);
    for (const { key, group } of creatorControls) {
      if (group === "fur" || key === "headRound" || key === "headWedge")
        continue;
      if (
        !targetNames.has(`Shape_${key}_low`) ||
        !targetNames.has(`Shape_${key}_high`)
      )
        throw new Error(`缺少脸部控制：${key}`);
    }
    // Three caches skinned bounds. A tiny standing eye sphere would otherwise
    // reject the eye after it moves down into a resting pose. This conservative
    // envelope covers the current pose range without recomputing all vertices
    // each frame; ray intersections still use the actual deformed triangles.
    const poseMargin = wholeBounds.getSize(new THREE.Vector3()).length();
    for (const mesh of meshes)
      if (mesh instanceof THREE.SkinnedMesh) {
        mesh.computeBoundingSphere();
        const scale = mesh.getWorldScale(new THREE.Vector3());
        const smallest = Math.max(
          0.000001,
          Math.min(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)),
        );
        if (mesh.boundingSphere) {
          mesh.boundingSphere.radius += poseMargin / smallest;
          mesh.boundingBox = new THREE.Box3().setFromCenterAndSize(
            mesh.boundingSphere.center,
            new THREE.Vector3().setScalar(mesh.boundingSphere.radius * 2),
          );
        }
      }
    resource = {
      baseId,
      scene,
      meshes,
      materials,
      visibility,
      targetNames,
      bounds,
      wholeBounds,
      landmarks: rawLandmarks as CreatorLandmarks,
      animations,
      motion: createCreatorMotion(scene, baseId),
      framing(headOnly) {
        scene.updateMatrixWorld(true);
        if (headOnly && headBone && referenceHead) {
          const current = new THREE.Matrix4()
            .multiplyMatrices(
              scene.matrixWorld.clone().invert(),
              headBone.matrixWorld,
            )
            .multiply(referenceHead);
          return bounds
            .clone()
            .applyMatrix4(current)
            .applyMatrix4(scene.matrixWorld);
        }
        const current = new THREE.Box3();
        for (const mesh of meshes)
          current.union(new THREE.Box3().setFromObject(mesh, true));
        return current.isEmpty() ? wholeBounds.clone() : current;
      },
      anatomicalPoint(point) {
        scene.updateMatrixWorld(true);
        const local = scene.worldToLocal(point.clone());
        if (!headBone || !referenceHead) return local;
        const current = new THREE.Matrix4()
          .multiplyMatrices(
            scene.matrixWorld.clone().invert(),
            headBone.matrixWorld,
          )
          .multiply(referenceHead);
        return local.applyMatrix4(current.invert());
      },
      supportsBlink:
        targetNames.has("Blink") &&
        (data.creatorFeatures as { blink?: boolean } | undefined)?.blink ===
          true,
      tuneCoatSurface(coat, mode = "source") {
        const detail =
          baseId === "sphynx" || mode === "source"
            ? 1
            : coat === "short"
              ? 0.55
              : 0.85;
        coatTuner?.apply({
          normalStrength: detail,
          roughnessMultiplier: 1,
          nonMetallic: baseId !== "sphynx" && mode === "source",
        });
      },
      dispose,
    };
    return resource;
  } catch (error) {
    dispose();
    throw error;
  }
}

export function creatorTargetWeights(
  design: CreatorDesign,
  blink = 0,
  targets?: Iterable<string>,
) {
  const valid = parseCreatorDesign(design);
  const weights: Record<string, number> = {
    Head_round: valid.shape.headRound / 100,
    Head_wedge: valid.shape.headWedge / 100,
  };
  for (const { key, group } of creatorControls) {
    if (group === "fur" || key === "headRound" || key === "headWedge") continue;
    const amount = (valid.shape[key] - 50) / 50;
    weights[`Shape_${key}_low`] = Math.max(0, -amount);
    weights[`Shape_${key}_high`] = Math.max(0, amount);
  }
  const closed = Number.isFinite(blink)
    ? THREE.MathUtils.clamp(blink, 0, 1)
    : 0;
  // Authored correctives remain optional; parameter controls do not invent them.
  for (const target of targets ?? []) {
    const name = target.startsWith("Blink_") ? target.slice(6) : target;
    if (!name.startsWith("Combo_")) continue;
    const factors = name.slice(6).split("__");
    if (factors.length < 2 || factors.length > 4) continue;
    weights[name] = factors.reduce(
      (product, factor) => product * (weights[factor] ?? 0),
      1,
    );
  }
  for (const [name, value] of Object.entries(weights))
    weights[`Blink_${name}`] = value * closed;
  weights.Blink = closed;
  return weights;
}

export function applyCreatorDesign(
  model: CreatorModel,
  design: CreatorDesign,
  blink = 0,
  options: { groom?: boolean } = {},
) {
  const weights = creatorTargetWeights(
    design,
    model.supportsBlink ? blink : 0,
    model.targetNames,
  );
  model.tuneCoatSurface(design.coatType, design.coatMode);
  for (const mesh of model.meshes) {
    if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
    for (const [name, index] of Object.entries(mesh.morphTargetDictionary))
      mesh.morphTargetInfluences[index] = weights[name] ?? 0;
  }
  model.scene.updateMatrixWorld(true);
  if (options.groom !== false) model.fur?.update(design);
}

/** Pick a real anatomical region using the authored three-dimensional landmarks. */
export function creatorPartFor(
  model: CreatorModel,
  point: THREE.Vector3,
): CreatorGroup {
  const p = model.anatomicalPoint(point);
  const size = model.bounds.getSize(new THREE.Vector3());
  const eyeRadius = size.x * 0.23;
  const earRadius = size.x * 0.25;
  for (const center of model.landmarks.eyeCenters) {
    const eye = new THREE.Vector3(...center);
    if (
      Math.abs(p.x - eye.x) < eyeRadius &&
      Math.abs(p.y - eye.y) < eyeRadius * 0.6 &&
      Math.abs(p.z - eye.z) < eyeRadius * 1.8
    )
      return "eyes";
  }
  for (const center of model.landmarks.earBases) {
    const base = new THREE.Vector3(...center);
    if (Math.abs(p.x - base.x) < earRadius && p.y > base.y - earRadius * 0.2)
      return "ears";
  }
  const muzzle = new THREE.Vector3(...model.landmarks.muzzleCenter);
  if (
    Math.abs(p.x - muzzle.x) < size.x * 0.29 &&
    Math.abs(p.y - muzzle.y) < size.y * 0.2 &&
    p.z > muzzle.z - size.z * 0.25
  )
    return "muzzle";
  return "head";
}

export function cloneCreatorForExport(
  model: CreatorModel,
  design: CreatorDesign,
  blink: number,
) {
  // A regular Object3D clone retains references to the live skeleton's bones.
  applyCreatorDesign(model, design, blink);
  const snapshot = cloneSkeleton(model.scene) as THREE.Group;
  const clonedFur: THREE.Object3D[] = [];
  snapshot.traverse((node) => {
    if (node.userData.norwegianFur) clonedFur.push(node);
  });
  clonedFur.forEach((node) => node.removeFromParent());
  const meshes: THREE.Mesh[] = [];
  snapshot.traverse((node) => {
    if (node instanceof THREE.Mesh) meshes.push(node);
  });
  if (meshes.length !== model.meshes.length)
    throw new Error("导出模型结构不完整。");
  meshes.forEach((mesh, index) => {
    const original = model.meshes[index];
    mesh.material = model.materials.get(original)!;
    mesh.visible = model.visibility.get(original) ?? true;
  });
  applyCreatorDesign(
    { ...model, scene: snapshot, meshes, fur: undefined },
    design,
    blink,
  );
  // The saved groom is the actual current geometry, independent of preview mode.
  // Later face edits in this app regenerate it from the preserved surface bindings.
  model.fur?.update(design);
  const groom = model.fur?.snapshotMeshes() ?? [];
  for (const furMesh of groom) snapshot.add(furMesh);
  // The coat is baked in the current pose. Do not include an automatically
  // activated source clip that would move the skin away from its static groom.
  // Original clips remain in the source GLB and authored Blender file.
  snapshot.animations = [];
  snapshot.userData = {
    ...snapshot.userData,
    creatorTemplateId: "cat-foundation-v1",
    creatorBaseId: model.baseId,
    creatorHeadBounds: {
      min: model.bounds.min.toArray(),
      max: model.bounds.max.toArray(),
    },
    creatorLandmarks: model.landmarks,
    miaoxingCreatorDesign: parseCreatorDesign(design),
    furExport:
      design.coatMode === "groom"
        ? "Current static pose and full intended experimental added groom; no auto-playing source clips. Settings retained in miaoxingCreatorDesign"
        : "Current static pose with original surface coat and replacement whiskers; added body/ruff/head groom and undercoat excluded. Settings retained in miaoxingCreatorDesign",
    assetSource: "User-provided Baidu model pack; modified locally in Blender",
  };
  // Ownership of the seller's underlying asset is not implied by this edit.
  delete snapshot.userData.license;
  return snapshot;
}

const disposedExports = new WeakSet<THREE.Object3D>();

/** Release only resources owned by an export, keeping the live editor intact. */
export function disposeCreatorExport(snapshot?: THREE.Object3D) {
  if (!snapshot || disposedExports.has(snapshot)) return;
  disposedExports.add(snapshot);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const skeletons = new Set<THREE.Skeleton>();
  snapshot.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton);
    if (!node.userData.norwegianFur) return;
    geometries.add(node.geometry);
    if (node.userData.ownedFurExportMaterial)
      for (const material of Array.isArray(node.material)
        ? node.material
        : [node.material])
        materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
}
