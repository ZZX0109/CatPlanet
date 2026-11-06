/** Immutable canonical-root labels for temporary draw-index attribution. No UI. */
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadArchivedGroom } from './cat-groom-audit-runtime.mjs';

const directory='artifacts/fur-volume/draw-diagnostics';
const bundle='artifacts/fur-filter/volume-round02/model-probe.js';
await fs.mkdir(directory,{recursive:true});
const runtime=await loadArchivedGroom(bundle);
const {api,model,fur,state}=runtime;
model.motion.setBreathing(false);
model.motion.setIdleBlink(false);
model.motion.setPose('stand',true);
model.motion.update(0,{reducedMotion:true});
const design={...api.defaultCreatorDesign,coatType:'long',shape:{...api.defaultCreatorDesign.shape,...api.getCatCoatProfile('long').defaults,headFurDensity:100,ruffFurDensity:100,bodyFurDensity:100}};
api.applyCreatorDesign(model,design);
fur.setVolume(true);
fur.setDetail(1);
fur.refresh({full:true});
const region=state.regions.find(r=>r.name==='body');
const count=region.roots.length;
if(count!==70000)throw Error('Expected body capacity70000, got '+count);
const kind=new Uint8Array(count),hairKind=new Uint8Array(count),trunkWeight=new Float32Array(count),downDepth=new Float32Array(count);
const sourceTriangles=new Uint32Array(count*3),rootBarycentric=new Float32Array(count*3),rootPositions=new Float32Array(count*3);
const byKind={0:0,1:0,2:0},byHairKind={0:0,1:0,2:0},jointCounts={},weightCounts={zero:0,partial:0,one:0};
const hairIds={down:0,awn:1,guard:2};
for(let i=0;i<count;i++){
  const r=region.roots[i];
  if(![0,1,2].includes(r.kind)||!(r.hairKind in hairIds))throw Error('Unknown root category at '+i);
  kind[i]=r.kind;hairKind[i]=hairIds[r.hairKind];trunkWeight[i]=r.trunkWeight;downDepth[i]=r.downDepth;
  sourceTriangles.set([r.a,r.b,r.c],i*3);rootBarycentric.set([r.u,r.v,r.w],i*3);
  for(let axis=0;axis<3;axis++)rootPositions[i*3+axis]=state.evaluated[r.a*3+axis]*r.u+state.evaluated[r.b*3+axis]*r.v+state.evaluated[r.c*3+axis]*r.w;
  byKind[r.kind]++;byHairKind[hairKind[i]]++;
  const key=`kind${r.kind}/${r.hairKind}`;jointCounts[key]=(jointCounts[key]??0)+1;
  weightCounts[r.trunkWeight===0?'zero':r.trunkWeight===1?'one':'partial']++;
}
for(const a of[trunkWeight,downDepth,rootPositions,rootBarycentric])if(!a.every(Number.isFinite))throw Error('Nonfinite root data');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const arrays={};
for(const[name,array,itemSize]of[['kind',kind,1],['hairKind',hairKind,1],['trunkWeight',trunkWeight,1],['downDepth',downDepth,1],['sourceTriangles',sourceTriangles,3],['rootBarycentric',rootBarycentric,3],['rootPositions',rootPositions,3]]){
  const bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength),file=`${name}.bin`;
  await fs.writeFile(`${directory}/${file}`,bytes);
  arrays[name]={file,type:array.constructor.name,itemSize,count:array.length/itemSize,byteLength:array.byteLength,sha256:hash(bytes),endianness:'little'};
}
const rawHash=array=>hash(Buffer.from(array.buffer,array.byteOffset,array.byteLength));
const geometry=region.mesh.geometry;
const schema={schemaVersion:1,capturedAt:new Date().toISOString(),source:{bundle,bundleSHA:runtime.bundleSha256,assetSHA:runtime.glbSha256,immutable:true},pose:'canonical',configuration:{motionPose:'stand',breathing:false,blink:false,coat:'long',detail:1,densityPercent:100,volumeEnabled:true},rootIndexing:{region:'body',capacity:count,rootIndex:'Array index i is production region.roots[i]; no sorting/filtering/reseeding.',strandSegments:region.strandSegments,strandVertices:region.strandVertices,strandIndices:region.strandIndices,drawRange:geometry.drawRange,sourceGeometryPositionSHA:rawHash(geometry.attributes.position.array),sourceGeometryIndexSHA:rawHash(geometry.index.array)},labels:{kind:{0:'non-appendage classification (not identical to trunkWeight=1)',1:'limb',2:'tail'},hairKind:{0:'down',1:'awn',2:'guard'},trunkWeight:'Smooth neutral-space exclusion of head, limb, tail, in [0,1]; not a hair-kind label.',downDepth:'Stable 0..1 position within the representative hair class; meaningful for all labels, used for down bulk split.',sourceTriangles:'Source skin vertex IDs (a,b,c) for stable barycentric binding.',rootBarycentric:'Barycentric weights (u,v,w), serialized Float32.',rootPositions:'Canonical skin root from actual evaluated surface and original double-precision barycentrics, then serialized Float32; not displaced fibre endpoints.'},counts:{byKind,byHairKind,jointCounts,trunkWeight:weightCounts},arrays,notes:['Read-only labels and counts. No renderer or visual acceptance.','The body render region includes trunk, limb and tail roots. Do not equate body mesh with anatomical trunk.','Hair-kind and root ordering come from the immutable round02 implementation. Verify source/binding hashes before applying to a later runtime.']};
await fs.writeFile(`${directory}/schema.json`,JSON.stringify(schema,null,2));
console.log(JSON.stringify({directory,capacity:count,source:schema.source,counts:schema.counts,bindings:{triangles:arrays.sourceTriangles.sha256,barycentric:arrays.rootBarycentric.sha256,rootPositions:arrays.rootPositions.sha256},geometry:schema.rootIndexing},null,2));
fur.dispose();
