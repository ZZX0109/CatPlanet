/** Real source-material CPU ownership checks; visual acceptance is separate. */
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp from "sharp";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createNativeCoatOpticsStudy } from "../lib/cat-native-coat-optics.ts";
import { buildNativeCoatMomentMips } from "../lib/cat-native-coat-moments.ts";
import { createCatNativeCoatTuner } from "../lib/cat-native-coat.ts";

const assetPath = "public/models/creator/norwegian-cat.glb";
const bytes = await fs.readFile(assetPath);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const sourceSHA = sha(bytes), jl = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.subarray(20, 20 + jl)), binary = bytes.subarray(28 + jl);
const images = await Promise.all(json.images.map(async (im) => {
  const v = json.bufferViews[im.bufferView];
  return sharp(binary.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}));
const borrowed = new Set();
const loader = new GLTFLoader();
loader.register(() => ({ name: "NATIVE_SURFACE_CPU_SOURCE_IMAGE", loadTexture(index) {
  const im = images[json.textures[index].source];
  const t = new THREE.DataTexture(new Uint8Array(im.data), im.info.width, im.info.height);
  t.flipY = false; t.needsUpdate = true; borrowed.add(t); return Promise.resolve(t);
} }));
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
const model = { meshes: [], materials: new Map() }, sourceMaterials = new Set();
gltf.scene.traverse((m) => { if (m.isMesh) { model.meshes.push(m); model.materials.set(m, m.material); for (const mat of Array.isArray(m.material) ? m.material : [m.material]) sourceMaterials.add(mat); } });
const tuner = createCatNativeCoatTuner(sourceMaterials);
tuner.apply({ normalStrength: 1, nonMetallic: true });
const originalRegistry = new Map(model.materials);
const body = [...sourceMaterials].find((m) => m.name === "Material #25");
assert(body);
const originalState = { normal: body.normalScale.toArray(), roughness: body.roughness, metalness: body.metalness, color: body.color.toArray(), userData: JSON.stringify(body.userData) };
const geometries = model.meshes.map((m) => m.geometry);
let sourceDisposals = 0, ownedMaterialDisposals = 0, ownedTextureDisposals = 0;
for (const item of [...sourceMaterials, ...borrowed, ...geometries]) item.addEventListener("dispose", () => sourceDisposals++);
const field = await fs.readFile("artifacts/native-coat-flow/blender_uv_ready.bin");
const values = new Float32Array(field.buffer.slice(field.byteOffset, field.byteOffset + field.byteLength));
const { levels } = buildNativeCoatMomentMips({ data: values, width: 256, height: 256 });
const settings = { anisotropy: .45, sheen: .06, sheenRoughness: .85, roughnessAxis: "across" };
const checks = [];
const check = (name, fn) => { fn(); checks.push({ name, pass: true }); };
const study = createNativeCoatOpticsStudy(model, levels, settings);
for (const mat of study.materials) mat.addEventListener("dispose", () => ownedMaterialDisposals++);
study.texture.addEventListener("dispose", () => ownedTextureDisposals++);
const replacement = study.materials[0];
check("exactly the real body changes material; real eye materials retain identity", () => {
  assert.equal(study.materials.length, 1);
  for (const [mesh, original] of originalRegistry) if (original !== body) assert.equal(model.materials.get(mesh), original);
});
check("source map objects, UV signs, roughness and nonmetallic surface are retained", () => {
  for (const slot of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap"]) assert.equal(replacement[slot], body[slot]);
  assert.deepEqual(replacement.normalScale.toArray(), [1, -1]);
  assert.equal(replacement.roughness, body.roughness); assert.equal(replacement.metalness, 0);
});
check("geometry and original morph arrays are never replaced", () => model.meshes.forEach((m, i) => assert.equal(m.geometry, geometries[i])));
check("moment texture has the complete reviewed noncolour mip chain", () => { assert.equal(study.texture.mipmaps.length, 9); assert.equal(study.texture.colorSpace, THREE.NoColorSpace); assert.equal(study.texture.flipY, false); });
check("attribution controls do not mutate original normal strength or source colour", () => {
  study.update({ ...settings, normalStrength: 0, flatAlbedo: true });
  replacement.onBeforeRender();
  assert.deepEqual(replacement.normalScale.toArray(), [0, -0]); assert.equal(replacement.map, null);
  assert.deepEqual(replacement.color.toArray(), [.18, .18, .18]);
  assert.deepEqual(body.normalScale.toArray(), originalState.normal); assert.deepEqual(body.color.toArray(), originalState.color);
  study.update(settings); replacement.onBeforeRender();
  assert.equal(replacement.map, body.map); assert.deepEqual(replacement.normalScale.toArray(), [1, -1]);
});
check("invalid settings fail before altering the active study", () => {
  assert.throws(() => study.update({ ...settings, anisotropy: NaN })); assert.equal(replacement.sheen, .06);
  assert.throws(() => study.update({ ...settings, normalStrength: -1 }));
});
study.dispose(); study.dispose();
check("double dispose restores the exact registry and disposes only owned resources once", () => {
  for (const [mesh, original] of originalRegistry) { assert.equal(mesh.material, original); assert.equal(model.materials.get(mesh), original); }
  assert.equal(ownedMaterialDisposals, 1); assert.equal(ownedTextureDisposals, 1); assert.equal(sourceDisposals, 0);
});
check("source scalar properties and material metadata remain unchanged", () => {
  assert.deepEqual({ normal: body.normalScale.toArray(), roughness: body.roughness, metalness: body.metalness, color: body.color.toArray(), userData: JSON.stringify(body.userData) }, originalState);
});
const invalidBody = body.clone(); invalidBody.normalMap = body.normalMap.clone(); invalidBody.normalMap.offset.x = .2;
const invalidMesh = new THREE.Mesh(model.meshes[0].geometry, invalidBody);
const invalidModel = { meshes: [model.meshes[0], invalidMesh], materials: new Map([[model.meshes[0], body], [invalidMesh, invalidBody]]) };
check("a late unsupported UV map restores previously replaced source materials", () => {
  assert.throws(() => createNativeCoatOpticsStudy(invalidModel, levels, settings), /identity UV0/);
  assert.equal(model.meshes[0].material, body); assert.equal(invalidModel.materials.get(model.meshes[0]), body); assert.equal(sourceDisposals, 0);
});
assert.equal(sha(await fs.readFile(assetPath)), sourceSHA);
const output = "artifacts/native-coat-surface-research/optics-ownership-validation.json";
await fs.writeFile(output, JSON.stringify({ method: "CPU-only real GLTFLoader source materials; does not prove visual improvement", checks, pass: true, sourceSHA256: sourceSHA, sourceDisposals, ownedMaterialDisposals, ownedTextureDisposals }, null, 2));
console.log(JSON.stringify({ checks: checks.length, pass: true, output }));
tuner.dispose();
invalidBody.normalMap.dispose(); invalidBody.dispose();
for (const g of new Set(geometries)) g.dispose();
for (const m of sourceMaterials) m.dispose();
for (const t of borrowed) t.dispose();
