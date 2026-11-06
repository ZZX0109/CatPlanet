import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { catVisualScenario, catVisualStage, describeCatVisual } from "../lib/cat-visual-validation";

test("all review views share fixed framing and lighting, independent of asset units", () => {
  for (const view of Object.keys(catVisualScenario.views) as (keyof typeof catVisualScenario.views)[]) {
    const model = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), new THREE.MeshStandardMaterial());
    model.position.set(9, 3, -2);
    const before = model.position.clone();
    const stage = catVisualStage(model, view);
    stage.scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    assert.equal(bounds.min.y, 0);
    assert.equal(bounds.max.y, 2);
    assert.equal(bounds.getCenter(new THREE.Vector3()).x, 0);
    assert.deepEqual(model.position, before, "source local coordinates preserved");
    assert.equal(stage.scene.children.filter(node => node instanceof THREE.DirectionalLight).length, 3);
    assert.equal(stage.camera.right - stage.camera.left, 3.4);
    assert.deepEqual(stage.camera.position.toArray(), catVisualScenario.views[view]);
  }
});

test("review evidence reports actual morph weights, materials and no invented animation or hair portability", () => {
  const model = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ roughness: .7 }));
  mesh.name = "bodySurface";
  mesh.morphTargetDictionary = { Head_round: 0 };
  mesh.morphTargetInfluences = [.4];
  model.add(mesh);
  const report = describeCatVisual(model, []);
  assert.deepEqual(report.animations, []);
  assert.deepEqual(report.bones, []);
  assert.equal(report.nativeBlenderHairPortable, false);
  assert.deepEqual((report.meshes[0] as any).morphs, [{ name: "Head_round", weight: .4 }]);
  assert.equal((report.meshes[0] as any).materials[0].roughness, .7);
  assert.throws(() => catVisualStage(new THREE.Group(), "front"), /bounds/);
});
