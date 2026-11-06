/** CPU-only analytic and optional actual-cat swept-curve bake audit. */
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const outDir = 'artifacts/fur-volume/bake-verification';
await fs.mkdir(outDir, { recursive: true });
const built = await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:"import {createCatFurVolumeMapper,bakeCatFurVolume} from './lib/cat-fur-volume-bake';globalThis.__bakeAudit={createCatFurVolumeMapper,bakeCatFurVolume};"},bundle:true,write:false,platform:'node',format:'iife'});
vm.runInThisContext(built.outputFiles[0].text);
const { createCatFurVolumeMapper, bakeCatFurVolume } = globalThis.__bakeAudit;
const checks=[];
const check=(name,pass,details)=>{checks.push({name,pass:!!pass,details});if(!pass)throw Error(name+': '+JSON.stringify(details));};
const mesh={positions:new Float32Array([0,0,0,1,0,0,1,1,0,0,1,0]),radial:new Float32Array([0,0,.2,0,0,.2,0,0,.2,0,0,.2]),sweep:new Float32Array([.1,0,0,.1,0,0,.1,0,0,.1,0,0]),uv:new Float32Array([0,0,1,0,1,1,0,1]),index:new Uint32Array([0,1,2,0,2,3])};
const point=(u,v,h)=>[u+.1*h*h,v,.2*h];
const mapper=createCatFurVolumeMapper(mesh,{tolerance:1e-9});
const exact=mapper.mapPoint(point(.35,.4,.7),{face:0});
check('inverse polynomial and cross-face transport',exact.ok&&Math.abs(exact.location.h-.7)<1e-6&&Math.hypot(exact.location.uv[0]-.35,exact.location.uv[1]-.4)<1e-6,exact);
const outside=mapper.mapPoint(point(.4,.4,1.2),{face:0});
check('out-of-envelope points are reported',!outside.ok&&outside.reason==='outside-height',outside);
mapper.dispose();

// Same geometric edge split into two UV islands. Seed crossing must be explicit.
const seamMesh={positions:new Float32Array([0,0,0,1,0,0,1,1,0,0,0,0,1,1,0,0,1,0]),radial:new Float32Array(18),sweep:new Float32Array(18),uv:new Float32Array([0,0,.4,0,.4,1,.6,0,1,1,.6,1]),index:new Uint32Array([0,1,2,3,4,5])};
for(let i=2;i<18;i+=3)seamMesh.radial[i]=.2;
const seamMapper=createCatFurVolumeMapper(seamMesh,{tolerance:1e-9});
const crossSeam=seamMapper.mapPoint([.1,.8,.1],{face:0});
check('matching skin edge connects across a UV seam',crossSeam.ok&&crossSeam.location.seamCrossings===1&&seamMapper.stats.seamConnections===1,crossSeam);
seamMapper.dispose();

const points=[];
for(const h of [0,.25,.5,.75,1])points.push(...point(.1+.7*h,.2+.4*h,h));
const strands={points:new Float32Array(points),count:1,pointsPerStrand:5,radii:new Float32Array([.002]),colors:new Float32Array([.2,.4,.8]),representedChildren:4,weights:new Float32Array([.5]),seedFaces:new Int32Array([0])};
const bake=bakeCatFurVolume({mesh,strands,resolution:[32,32,16],samplesPerVoxel:2});
let length=0;for(let i=3;i<points.length;i+=3)length+=Math.hypot(points[i]-points[i-3],points[i+1]-points[i-2],points[i+2]-points[i-1]);
const expected=.004*length*4*.5, totalVolume=bake.voxelVolumes.reduce((a,b)=>a+b,0);
check('physical mass integrates the actual swept polyline',Math.abs(bake.stats.inputMass/expected-1)<1e-7,{expected,...bake.stats});
check('physical voxel volumes include the mapping Jacobian',Math.abs(totalVolume-.2)<1e-7,totalVolume);
check('mass accounting includes every uncovered/invalid contribution',Math.abs(bake.stats.accountingError)<1e-12,bake.stats);
check('F32 kappa reconstructs stored physical mass',Math.abs(bake.stats.massReconstructionError)<1e-8,bake.stats.massReconstructionError);
check('in-domain h-boundary weights are clamped without loss',bake.stats.uncoveredMass===0&&bake.stats.invalidVoxelMass<1e-12,bake.stats);
let occupiedX=new Set(), colorError=0, nonfinite=0;
for(let i=0;i<bake.rgba.length;i+=4){if(!Number.isFinite(bake.rgba[i+3]))nonfinite++;if(bake.rgba[i+3]>0){occupiedX.add((i/4)%32);for(let k=0;k<3;k++)colorError=Math.max(colorError,Math.abs(bake.rgba[i+k]-strands.colors[k]));}}
check('swept curve deposits across UV rather than a root column',occupiedX.size>20,{occupiedX:occupiedX.size});
check('linear unpremultiplied RGB is preserved',colorError<1e-7&&nonfinite===0,{colorError,nonfinite});

// Left/right reversed UV handedness must not discard a valid physical volume.
const negative={...mesh,uv:new Float32Array(mesh.uv)};for(let i=0;i<negative.uv.length;i+=2)negative.uv[i]=1-negative.uv[i];
const reflected=bakeCatFurVolume({mesh:negative,strands,resolution:[16,16,8]});
check('negative UV handedness is valid, not a fold',reflected.stats.foldCells===0&&Math.abs(reflected.stats.storedMass/expected-1)<1e-6,reflected.stats);

const singular={...mesh,radial:new Float32Array(mesh.radial.length),sweep:new Float32Array(mesh.sweep.length)};
const singularMapper=createCatFurVolumeMapper(singular);
const singularResult=singularMapper.mapPoint([.3,.2,.01],{face:0});
check('zero physical depth is reported singular',!singularResult.ok&&singularResult.reason==='singular',singularResult);
singularMapper.dispose();
const folded={...mesh,sweep:new Float32Array(mesh.sweep.length)};
for(let i=2;i<folded.sweep.length;i+=3)folded.sweep[i]=-.2;
const foldMapper=createCatFurVolumeMapper(folded);
const foldResult=foldMapper.mapPoint([.4,.2,.032],{face:0,h:.8,bary:[.6,.2,.2]});
check('reversed physical Jacobian is reported as fold',!foldResult.ok&&foldResult.reason==='fold',foldResult);
foldMapper.dispose();

const edgeMesh={...mesh,index:new Uint32Array([0,1,2])};
const edgePoints=[];for(const h of [0,.5,1])edgePoints.push(...point(.1+.7*h,.1+.7*h-1e-7,h));
const edgeBake=bakeCatFurVolume({mesh:edgeMesh,strands:{...strands,points:new Float32Array(edgePoints),pointsPerStrand:3},resolution:[16,16,8]});
check('zero-volume UV-edge targets are lost explicitly, never redistributed',edgeBake.stats.invalidVoxelMass>0&&Math.abs(edgeBake.stats.accountingError)<1e-12&&edgeBake.stats.storedMass<edgeBake.stats.mappedMass,edgeBake.stats);

const analytic={sourceSHA:createHash('sha256').update(await fs.readFile('lib/cat-fur-volume-bake.ts')).digest('hex'),checks,stats:bake.stats,physicalVolume:totalVolume,notes:['No renderer or procedural density field used.','Physical voxel volumes use clipped-UV centroid and h-midpoint quadrature; this is approximate for nonuniform polynomial fields.']};
await fs.writeFile(path.join(outDir,'analytic.json'),JSON.stringify(analytic,null,2));
console.log(JSON.stringify({analyticChecks:checks.length,stats:bake.stats}));

if(process.argv.includes('--actual')){
  const inputDir='artifacts/fur-volume/bake-inputs';
  const manifest=JSON.parse(await fs.readFile(path.join(inputDir,'manifest.json'),'utf8'));
  const arrays={};
  for(const [name,entry]of Object.entries(manifest.arrays)){const bytes=await fs.readFile(path.join(inputDir,entry.file));if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Input hash mismatch '+name);arrays[name]=new globalThis[entry.type](bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));}
  const m={positions:arrays.P,radial:arrays.R,sweep:arrays.T,uv:arrays.uv,index:arrays.index,mask:arrays.mask,sourceVertexIds:arrays.sourceVertexIds};
  const radialScale=Number(process.argv.find(a=>a.startsWith('--radial-scale='))?.split('=')[1]??1);
  const sweepScale=Number(process.argv.find(a=>a.startsWith('--sweep-scale='))?.split('=')[1]??1);
  m.radial=m.radial.map(value=>value*radialScale);
  m.sweep=m.sweep.map(value=>value*sweepScale);
  // Crop UV only. This is an affine coordinate change; no geometry/groom changes.
  let minU=Infinity,minV=Infinity,maxU=-Infinity,maxV=-Infinity;
  for(let i=0;i<m.uv.length;i+=2){minU=Math.min(minU,m.uv[i]);minV=Math.min(minV,m.uv[i+1]);maxU=Math.max(maxU,m.uv[i]);maxV=Math.max(maxV,m.uv[i+1]);}
  m.uv=m.uv.map((value,i)=>(value-(i%2?minV:minU))/(i%2?maxV-minV:maxU-minU));
  const count=Number(process.argv.find(a=>a.startsWith('--parents='))?.split('=')[1]??1000), indices=Array.from({length:Math.min(count,manifest.strands.count)},(_,i)=>Math.floor(i*manifest.strands.count/Math.min(count,manifest.strands.count)));
  const take=(a,itemSize)=>{const out=new a.constructor(indices.length*itemSize);indices.forEach((j,i)=>out.set(a.subarray(j*itemSize,(j+1)*itemSize),i*itemSize));return out;};
  const s={points:take(arrays.points,27),count:indices.length,pointsPerStrand:9,radii:take(arrays.radii,1),colors:take(arrays.colors,3),weights:take(arrays.bulkFraction,1),seedFaces:take(arrays.seedFaces,1),representedChildren:64};
  const started=performance.now();
  const actual=bakeCatFurVolume({mesh:m,strands:s,resolution:[256,256,16],samplesPerVoxel:2});
  const layers=Array.from({length:16},(_,z)=>{let mass=0,occupied=0,volume=0,maximumKappa=0;for(let i=z*256*256;i<(z+1)*256*256;i++){const kappa=actual.rgba[i*4+3];mass+=kappa*actual.voxelVolumes[i];volume+=actual.voxelVolumes[i];if(kappa>0)occupied++;maximumKappa=Math.max(maximumKappa,kappa);}return {z,h:(z+.5)/16,mass,massFraction:mass/actual.stats.storedMass,occupied,volume,maximumKappa};});
  const result={sourceSHA:analytic.sourceSHA,inputSource:manifest.source,parents:indices.length,totalParents:manifest.strands.count,representedChildren:64,weights:'bulkFraction only; trunkWeights are not multiplied',geometryScales:{radialScale,sweepScale},uvCrop:{minU,minV,maxU,maxV},resolution:actual.resolution,elapsedMS:performance.now()-started,stats:actual.stats,layers,finite:actual.rgba.every(Number.isFinite),notes:['No visual quality claim. Radius/represented children are illustrative inputs, not measured biological counts.','Uncovered and invalid-voxel mass is reported and not silently redistributed.']};
  const suffix=radialScale===1&&sweepScale===1?'':`-radial${radialScale}-sweep${sweepScale}`;
  await fs.writeFile(path.join(outDir,`actual-${indices.length}${suffix}.json`),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
}
