import type * as THREE from "three";

export type CatNativeCoatSettings = {
  /** Relative to the loaded asset normalScale, including its original Y sign. */
  normalStrength?: number;
  /** Keep the authored roughness texture and scalar. No uniform gloss override. */
  roughnessMultiplier?: 1;
  /** Remove residual metallic ORM values without editing the shared texture. */
  nonMetallic?: boolean;
};

type CoatSnapshot = {
  normalScale: THREE.Vector2;
  roughness: number;
  metalness: number;
  hadMetadata: boolean;
  metadata: unknown;
};

function eyeMaterial(material: THREE.Material): boolean {
  const role = String(material.userData.creatorRole ?? "");
  return (
    /eye|iris|cornea|pupil/i.test(role) ||
    /eye|iris|cornea|pupil/i.test(material.name) ||
    material.userData.creatorEyeSide !== undefined
  );
}

function standardMaterial(
  material: THREE.Material,
): material is THREE.MeshStandardMaterial {
  // Loader/plugin module boundaries may contain another Three constructor.
  // The documented material type flag remains valid across that boundary.
  return (
    (material as THREE.MeshStandardMaterial).isMeshStandardMaterial === true
  );
}

/**
 * Reversible tuning of existing coat materials. Create this once, immediately
 * after GLTF loading, before applying any source/groom normal-strength changes.
 * No textures, shaders, colours, UV transforms or geometry are created/changed.
 * The material/texture lifetime belongs to the model; dispose only restores the
 * few scalar/vector properties owned here and releases these bookkeeping refs.
 */
export function createCatNativeCoatTuner(materials: Iterable<THREE.Material>) {
  const snapshots = new Map<THREE.MeshStandardMaterial, CoatSnapshot>();
  const excludedEyes = new Set<THREE.Material>();
  for (const material of materials) {
    if (eyeMaterial(material)) {
      excludedEyes.add(material);
      continue;
    }
    if (
      !standardMaterial(material) ||
      !material.normalMap ||
      snapshots.has(material)
    )
      continue;
    snapshots.set(material, {
      normalScale: material.normalScale.clone(),
      roughness: material.roughness,
      metalness: material.metalness,
      hadMetadata: Object.prototype.hasOwnProperty.call(
        material.userData,
        "catNativeCoat",
      ),
      metadata: material.userData.catNativeCoat,
    });
  }
  let disposed = false;

  function restore() {
    if (disposed) return;
    for (const [material, original] of snapshots) {
      material.normalScale.copy(original.normalScale);
      material.roughness = original.roughness;
      material.metalness = original.metalness;
      if (original.hadMetadata)
        material.userData.catNativeCoat = original.metadata;
      else delete material.userData.catNativeCoat;
    }
  }

  return {
    get materialCount() {
      return snapshots.size;
    },
    get excludedEyeCount() {
      return excludedEyes.size;
    },
    apply(settings: CatNativeCoatSettings = {}) {
      if (disposed) return;
      const strength = settings.normalStrength ?? 1;
      if (!Number.isFinite(strength) || strength < 0 || strength > 2)
        throw new Error(
          "Native coat normalStrength must be finite, from 0 to 2.",
        );
      if (
        settings.roughnessMultiplier !== undefined &&
        settings.roughnessMultiplier !== 1
      )
        throw new Error("Native coat tuning preserves authored roughness.");
      const nonMetallic = settings.nonMetallic === true;
      for (const [material, original] of snapshots) {
        // Always start from the loaded asset, not the previous frame's tune.
        material.normalScale
          .copy(original.normalScale)
          .multiplyScalar(strength);
        material.roughness = original.roughness;
        material.metalness = nonMetallic ? 0 : original.metalness;
        material.userData.catNativeCoat = {
          version: 1,
          mode: nonMetallic ? "native-dielectric" : "authored-reflectance",
          normalStrength: strength,
          sourceNormalScale: original.normalScale.toArray(),
          normalScale: material.normalScale.toArray(),
          roughnessMultiplier: 1,
          sourceRoughness: original.roughness,
          roughness: material.roughness,
          sourceMetalness: original.metalness,
          metalness: material.metalness,
          normalMap: material.normalMap?.uuid ?? null,
          roughnessMap: material.roughnessMap?.uuid ?? null,
          metalnessMap: material.metalnessMap?.uuid ?? null,
          textures: "borrowed-unchanged",
          shader: "standard-PBR-no-custom-hook",
        };
      }
    },
    restore,
    /** Idempotent; never disposes a source material, texture or geometry. */
    dispose() {
      if (disposed) return;
      restore();
      disposed = true;
      snapshots.clear();
      excludedEyes.clear();
    },
  };
}
