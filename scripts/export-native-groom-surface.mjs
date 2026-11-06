/** Freeze the actual neutral, standing web surface for authoring correspondences. */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";

const output = process.argv[2] ?? "artifacts/native-coat-study/web-reference";
await fs.mkdir(output, { recursive: true });
const asset = "public/models/creator/norwegian-cat.glb";
const bytes = await fs.readFile(asset);
const sha = (data) => createHash("sha256").update(data).digest("hex");
const jsonLength = bytes.readUInt32LE(12);
const original = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
const json = structuredClone(original);
// Only this transient decoder copy omits pictures, so a Node geometry audit
// does not invent a DOM/image decoder. Public and authoring assets stay intact.
function stripTextureReferences(value) {
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value))
    if (key.endsWith("Texture")) delete value[key];
    else stripTextureReferences(value[key]);
}
for (const material of json.materials ?? []) stripTextureReferences(material);
delete json.images;
delete json.textures;
delete json.samplers;
const encoded = Buffer.from(JSON.stringify(json));
const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20);
encoded.copy(padded);
const binChunk = bytes.subarray(20 + jsonLength);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(20 + padded.length + binChunk.length, 8);
header.writeUInt32LE(padded.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);
const transient = Buffer.concat([header, padded, binChunk]);

const modulePath = path.resolve(output, "surface-runtime.mjs");
const bundled = await build({
  stdin: {
    resolveDir: process.cwd(), loader: "ts",
    contents: `export * as THREE from 'three';
export {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
export {ownCreatorModel,applyCreatorDesign} from './lib/cat-creator-model';
export {defaultCreatorDesign} from './lib/cat-creator-design';`,
  },
  bundle: true, platform: "node", format: "esm", write: false,
});
await fs.writeFile(modulePath, bundled.outputFiles[0].text);
const api = await import(pathToFileURL(modulePath).href);
const gltf = await new api.GLTFLoader().parseAsync(
  transient.buffer.slice(transient.byteOffset, transient.byteOffset + transient.byteLength), "",
);
const model = api.ownCreatorModel(gltf.scene, gltf.animations, "norwegian");
const design = {...api.defaultCreatorDesign, coatMode:"source", coatType:"long"};
model.motion.setBreathing(false);
model.motion.setIdleBlink(false);
model.motion.setPose("stand", true);
model.motion.update(0, {reducedMotion:true});
api.applyCreatorDesign(model, design, 0);
try {
  const mesh = model.meshes.filter(m=>m.isSkinnedMesh)
    .sort((a,b)=>b.geometry.attributes.position.count-a.geometry.attributes.position.count)[0];
  if (!mesh) throw Error("No authored skin");
  const geometry = mesh.geometry, count = geometry.attributes.position.count;
  model.scene.updateMatrixWorld(true); mesh.skeleton.update();
  const matrix = new api.THREE.Matrix4().multiplyMatrices(
    model.scene.matrixWorld.clone().invert(), mesh.matrixWorld,
  );
  const positions = new Float32Array(count*3), point = new api.THREE.Vector3();
  for(let i=0;i<count;i++) mesh.getVertexPosition(i,point).applyMatrix4(matrix).toArray(positions,i*3);
  const uv = new Float32Array(count*2);
  for(let i=0;i<count;i++) {uv[i*2]=geometry.attributes.uv.getX(i);uv[i*2+1]=geometry.attributes.uv.getY(i);}
  const index = Uint32Array.from(geometry.index.array);
  const normalGeometry = new api.THREE.BufferGeometry();
  normalGeometry.setAttribute('position',new api.THREE.BufferAttribute(positions,3));
  normalGeometry.setIndex(new api.THREE.BufferAttribute(index,1));
  normalGeometry.computeVertexNormals();
  const normals = normalGeometry.attributes.normal.array;
  const skinIndex = Uint16Array.from(geometry.attributes.skinIndex.array);
  const skinWeight = Float32Array.from(geometry.attributes.skinWeight.array);
  const arrays = {positions,normals,uv,index,skinIndex,skinWeight}, files={};
  for(const [name,array] of Object.entries(arrays)) {
    if(Array.from(array).some(n=>!Number.isFinite(n))) throw Error('Nonfinite '+name);
    const data=Buffer.from(array.buffer,array.byteOffset,array.byteLength), file=name+'.bin';
    await fs.writeFile(path.join(output,file),data);
    files[name]={file,type:array.constructor.name,elements:array.length,bytes:data.length,sha256:sha(data)};
  }
  const bounds = new api.THREE.Box3().setFromBufferAttribute(normalGeometry.attributes.position);
  const manifest={schemaVersion:1,createdAt:new Date().toISOString(),source:{asset,sha256:sha(bytes)},
    runtimeSource:{'lib/cat-creator-model.ts':sha(await fs.readFile('lib/cat-creator-model.ts')),'lib/cat-creator-motion.ts':sha(await fs.readFile('lib/cat-creator-motion.ts'))},
    scope:'Actual evaluated default standing skin only. Source topology and UV; area-weighted vertex normals without extra seam smoothing. No new fur or app changes.',
    design,mesh:mesh.name,vertexCount:count,triangleCount:index.length/3,files,
    coordinates:{space:'Web model.scene-local, right-handed X right/Y up/Z front',blenderWorldFromWeb:'[x,-z,y]',webFromBlenderWorld:'[x,z,-y]',bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},assumedMillimetresPerUnit:300/(bounds.max.y-bounds.min.y),calibration:'Assumed 300 mm skin height, not an author supplied measurement.'},
    bones:mesh.skeleton.bones.map(b=>b.name),
    bindingCaveat:'Blender importer can merge/reorder vertices. Preserve root UV plus world position/normal; never treat imported Blender face IDs as web GLB face IDs.'};
  await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  normalGeometry.dispose();
  console.log(JSON.stringify({output,vertices:count,triangles:index.length/3,sourceSHA:manifest.source.sha256,bounds:manifest.coordinates.bounds}));
} finally {model.dispose();}
