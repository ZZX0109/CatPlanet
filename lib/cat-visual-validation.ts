import * as THREE from "three";
import scenario from "./cat-visual-scenario.json";

export { scenario as catVisualScenario };
export type CatVisualView = keyof typeof scenario.views;

/** Normalize only the review copy, keeping all original asset coordinates intact. */
export function catVisualStage(model: THREE.Object3D, view: CatVisualView) {
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model, true);
  const size = bounds.getSize(new THREE.Vector3());
  if (bounds.isEmpty() || !Number.isFinite(size.y) || size.y <= 0)
    throw new Error("Empty or non-finite visual review bounds");
  const factor = scenario.normalizedHeight / size.y;
  const center = bounds.getCenter(new THREE.Vector3());
  const wrapper = new THREE.Group();
  wrapper.scale.setScalar(factor);
  wrapper.position.set(-center.x * factor, -bounds.min.y * factor, -center.z * factor);
  wrapper.add(model);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(scenario.background);
  scene.add(wrapper, new THREE.AmbientLight(0xffffff, scenario.ambient));
  for (const light of scenario.lights) {
    const source = new THREE.DirectionalLight(light.color, light.intensity);
    source.position.fromArray(light.position);
    source.target.position.fromArray(scenario.camera.target);
    scene.add(source, source.target);
  }
  const half = scenario.camera.span / 2;
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, scenario.camera.near, scenario.camera.far);
  camera.position.fromArray(scenario.views[view]);
  camera.lookAt(new THREE.Vector3(...scenario.camera.target));
  camera.updateMatrixWorld(true);
  return { scene, camera, normalization: { factor, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } } };
}

/** Capture actual decoded state, not a manifest's promise of capabilities. */
export function describeCatVisual(model: THREE.Object3D, animations: THREE.AnimationClip[]) {
  const meshes: object[] = [], bones: object[] = [];
  model.updateMatrixWorld(true);
  model.traverse(node => {
    if (node instanceof THREE.Bone)
      bones.push({ name: node.name, parent: node.parent?.name, matrix: node.matrix.toArray() });
    if (!(node instanceof THREE.Mesh)) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    meshes.push({
      name: node.name, vertices: node.geometry.getAttribute("position")?.count,
      skinned: node instanceof THREE.SkinnedMesh,
      joints: node instanceof THREE.SkinnedMesh ? node.skeleton.bones.map(bone => bone.name) : [],
      morphs: Object.entries(node.morphTargetDictionary ?? {}).map(([name, index]) => ({ name, weight: node.morphTargetInfluences?.[index] ?? 0 })),
      groom: Boolean(node.userData.norwegianFur),
      materials: materials.map(material => ({
        name: material.name, type: material.type, transparent: material.transparent,
        opacity: material.opacity, side: material.side,
        ...(material instanceof THREE.MeshStandardMaterial ? {
          roughness: material.roughness, metalness: material.metalness,
          color: material.color.getHexString(), normalScale: material.normalScale.toArray(),
          textures: ["map", "normalMap", "roughnessMap"].filter(key => Boolean((material as unknown as Record<string, unknown>)[key])),
        } : {}),
      })),
    });
  });
  return { meshes, bones, animations: animations.map(clip => ({ name: clip.name, duration: clip.duration, tracks: clip.tracks.map(track => track.name) })),
    nativeBlenderHairPortable: false,
    limitations: ["Static stand pose only; native Blender hair/shaders are not guaranteed glTF features.", "Review stage normalizes framing; it does not certify production lighting/compositing or dynamic groom binding."] };
}
