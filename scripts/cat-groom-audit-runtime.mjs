/**
 * Read-only CPU audit of an archived production groom bundle. No browser or GPU.
 * Usage: node scripts/audit-cat-groom-scale.mjs [bundle.js] [report.json]
 * The capture bundle retains the exact implementation used by that visual round.
 * Closure instrumentation exists only in memory; it never edits runtime/assets.
 */
import fs from "node:fs/promises";
import vm from "node:vm";
import { createHash } from "node:crypto";
import sharp from "sharp";

export async function loadArchivedGroom(bundlePath, options = {}) {
  const source = await fs.readFile("public/models/creator/norwegian-cat.glb");
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const jsonLength = source.readUInt32LE(12);
  const original = JSON.parse(source.subarray(20, 20 + jsonLength).toString());
  const json = structuredClone(original);
  const binChunk = source.subarray(20 + jsonLength);
  const bin = binChunk.subarray(8);
  const images = [];
  for (const image of original.images ?? []) {
    const view = original.bufferViews[image.bufferView];
    const raw = await sharp(
      bin.subarray(
        view.byteOffset ?? 0,
        (view.byteOffset ?? 0) + view.byteLength,
      ),
    )
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    images.push({
      pixels: raw.data,
      width: raw.info.width,
      height: raw.info.height,
    });
  }
  // Remove DOM image loading from a transient GLB copy. Restore original diffuse
  // pixels below, so the same production UV sampler/nose exclusions still run.
  for (const material of json.materials ?? []) {
    for (const key of Object.keys(material))
      if (key.endsWith("Texture")) delete material[key];
    for (const key of Object.keys(material.pbrMetallicRoughness ?? {}))
      if (key.endsWith("Texture")) delete material.pbrMetallicRoughness[key];
    for (const extension of Object.values(material.extensions ?? {}))
      for (const key of Object.keys(extension))
        if (key.endsWith("Texture")) delete extension[key];
  }
  delete json.images;
  delete json.textures;
  delete json.samplers;
  const encoded = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20);
  encoded.copy(padded);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length + binChunk.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const geometryOnly = Buffer.concat([header, padded, binChunk]);

  globalThis.window = globalThis;
  globalThis.document = {
    createElement(name) {
      if (name !== "canvas")
        throw new Error(`Unexpected DOM dependency: ${name}`);
      let image;
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage(value) {
              image = value;
            },
            getImageData() {
              return { data: image.pixels };
            },
          };
        },
      };
    },
  };
  const archivedBundle = await fs.readFile(bundlePath, "utf8");
  const closureReturn = archivedBundle.lastIndexOf("    return resource;");
  const performanceProbe = archivedBundle.includes(
    "window.__furFlowPerformance =",
  );
  const filterProbe = archivedBundle.includes("window.__filterAuditTools =");
  if (closureReturn < 0 || (!performanceProbe && !filterProbe))
    throw new Error("Expected an unminified archived capture bundle.");
  let instrumented =
    archivedBundle.slice(0, closureReturn) +
    "    globalThis.__groomAuditState = {regions,evaluated,normals};\n" +
    archivedBundle.slice(closureReturn);
  instrumented = instrumented.replace(
    /const gravity = length \* groom\.gravity \* \(region\.name === "head" \? 0\.28 : 1\);/,
    "$&\n      root.__auditGravity = gravity;",
  );
  instrumented = instrumented.replace(
    "window.__furFlowPerformance =",
    `
globalThis.__groomAuditModules = {GLTFLoader,Texture,SRGBColorSpace,Box3,Vector3,
ownCreatorModel,applyCreatorDesign,defaultCreatorDesign,getCatCoatProfile,createNorwegianFur};
window.__furFlowPerformance =`,
  );
  if (options.transformBundle)
    instrumented = options.transformBundle(instrumented);
  vm.runInThisContext(instrumented, { filename: bundlePath });
  const api = performanceProbe
    ? globalThis.__groomAuditModules
    : {
        ...globalThis.__filterAuditTools.THREE,
        ...globalThis.__filterAuditTools,
      };
  const gltf = await new api.GLTFLoader().parseAsync(
    geometryOnly.buffer.slice(
      geometryOnly.byteOffset,
      geometryOnly.byteOffset + geometryOnly.length,
    ),
    "",
  );
  gltf.scene.traverse((node) => {
    if (!node.isMesh) return;
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      const association = gltf.parser.associations.get(material);
      const baseColor =
        original.materials[association?.materials]?.pbrMetallicRoughness
          ?.baseColorTexture;
      if (!baseColor) continue;
      const texture = new api.Texture(
        images[original.textures[baseColor.index].source],
      );
      texture.flipY = false;
      texture.colorSpace = api.SRGBColorSpace;
      const transform = baseColor.extensions?.KHR_texture_transform;
      if (transform?.offset) texture.offset.fromArray(transform.offset);
      if (transform?.scale) texture.repeat.fromArray(transform.scale);
      if (transform?.rotation) texture.rotation = transform.rotation;
      material.map = texture;
    }
  });
  const model = api.ownCreatorModel(gltf.scene, gltf.animations, "norwegian");
  const surface = model.meshes
    .filter((mesh) => mesh.isSkinnedMesh)
    .sort(
      (a, b) =>
        b.geometry.attributes.position.count -
        a.geometry.attributes.position.count,
    )[0];
  const fur = await api.createNorwegianFur(model.scene, surface);
  model.fur = fur;
  model.scene.add(...fur.meshes);
  fur.setDetail(1);
  const state = globalThis.__groomAuditState;
  const bounds = new api.Box3();
  for (let i = 0; i < state.evaluated.length; i += 3)
    bounds.expandByPoint(new api.Vector3().fromArray(state.evaluated, i));
  const height = bounds.max.y - bounds.min.y;
  const mmPerUnit = 300 / height;

  return {
    api,
    model,
    fur,
    state,
    bounds,
    height,
    mmPerUnit,
    surface,
    bundleSha256: hash(archivedBundle),
    glbSha256: hash(source),
  };
}
