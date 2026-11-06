import * as THREE from "three";
import { createCatGroomDetails } from "./cat-groom-details";
import type { NorwegianFur } from "./norwegian-fur";

/** The source surface needs replacement whiskers, not a dormant full-body groom. */
export function createCatNativeCoatDetails(
  scene: THREE.Group,
  surface: THREE.Mesh,
): NorwegianFur {
  const details = createCatGroomDetails(scene, surface);
  details.update({ density: 0 });
  let disposed = false;
  let detailLevel = 1;
  return {
    preparedGroom: false,
    meshes: details.meshes,
    update(design) {
      if (disposed) return;
      if (design.coatMode === "groom")
        throw new Error("请先加载附加毛层，再应用实验毛发参数。");
      // Original ear-hair geometry and textures remain on the source surface;
      // removed whisker cards use the existing triangle-bound replacement.
      details.update({ density: 0 });
    },
    refresh() {
      if (!disposed) details.update({ density: 0 });
    },
    setDetail(level) {
      if (!disposed && Number.isFinite(level))
        detailLevel = THREE.MathUtils.clamp(level, 0.18, 1);
    },
    setVolume() {},
    setVolumeDensity() {},
    setVolumeGeometry() {},
    volumeInfo: () => [],
    snapshotMeshes() {
      if (disposed) return [];
      details.update({ density: 0 });
      return details.snapshotMeshes();
    },
    stats() {
      const empty = () => ({
        capacity: 0,
        strands: 0,
        previewStrands: 0,
        length: 0,
        detailLevel,
        strandSegments: 0,
        strandVertices: 0,
        strandIndices: 0,
      });
      return { head: empty(), ruff: empty(), body: empty() };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      details.dispose();
    },
  };
}
