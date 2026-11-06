import fs from "node:fs/promises";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as THREE from "three";

globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, options) {
    this.type = type;
    Object.assign(this, options);
  }
};
export async function loadGeometryGlb(path) {
  const bytes = await fs.readFile(path);
  const jsonSize = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonSize));
  const bin = bytes.subarray(28 + jsonSize);
  json.buffers[0].uri =
    "data:application/octet-stream;base64," + bin.toString("base64");
  json.materials = [];
  json.textures = [];
  json.images = [];
  for (const mesh of json.meshes ?? [])
    for (const primitive of mesh.primitives) delete primitive.material;
  return new GLTFLoader().parseAsync(JSON.stringify(json), "");
}

if (process.argv[1]?.endsWith("probe-cat-motion.mjs")) {
  await fs.mkdir("artifacts/table-refinement", { recursive: true });
  for (const base of ["norwegian", "sphynx"]) {
    const gltf = await loadGeometryGlb(`public/models/creator/${base}-cat.glb`);
    gltf.scene.updateMatrixWorld(true);
    const bones = [];
    gltf.scene.traverse((node) => {
      if (node.isBone)
        bones.push({
          name: node.name,
          parent: node.parent.name,
          p: node.getWorldPosition(new THREE.Vector3()).toArray(),
          local: node.position.toArray(),
          quaternion: node.quaternion.toArray(),
          children: node.children.filter((x) => x.isBone).map((x) => x.name),
        });
    });
    await fs.writeFile(
      `artifacts/table-refinement/${base}-bones.json`,
      JSON.stringify(bones, null, 2),
    );
    console.log(
      base,
      JSON.stringify(
        bones.filter((x) =>
          /Spine|Ribcage$|neck|^head$|Leg1|Leg2|Palm|HipSkin|Knee|Ankle|Toe|Belly|Spine|Chest|BackFoot/.test(
            x.name,
          ),
        ),
      ),
    );
  }
}
