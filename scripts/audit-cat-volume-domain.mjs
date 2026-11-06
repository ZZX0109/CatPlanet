/** Read-only attribution of the current shell/fin anatomical boundary. */
import fs from 'node:fs/promises';
import { loadArchivedGroom } from './cat-groom-audit-runtime.mjs';
const directory='artifacts/fur-volume/draw-diagnostics';
const bundle='artifacts/fur-filter/volume-r14-draw-isolation-body/model-probe.js';
const runtime=await loadArchivedGroom(bundle,{transformBundle(source){const marker='    return {\n      meshes: regions.flatMap((region) => [region.mesh, region.finMesh]),';if(!source.includes(marker))throw Error('Volume closure marker not found');return source.replace(marker,'    globalThis.__volumeDomain = {regions,input};\n'+marker);}});
const {api,model,fur}=runtime;
model.motion.setBreathing(false);model.motion.setIdleBlink(false);
api.applyCreatorDesign(model,{...api.defaultCreatorDesign,coatType:'long',shape:{...api.defaultCreatorDesign.shape,...api.getCatCoatProfile('long').defaults,headFurDensity:80,ruffFurDensity:80,bodyFurDensity:80}});
fur.setVolume(true);fur.setVolumeGeometry({envelopeScale:1.4,sweepScale:0});fur.setDetail(1);
model.motion.setPose('rest',true);model.motion.update(1,{reducedMotion:true});fur.refresh({full:true});
const region=globalThis.__volumeDomain.regions.find(r=>r.name==='body');
const summary=values=>{values.sort((a,b)=>a-b);const at=p=>values[Math.floor((values.length-1)*p)];return{n:values.length,min:at(0),median:at(.5),p95:at(.95),max:at(1)}};
const vertexBins=[];
for(const[lo,hi]of[[-1e-6,0],[0,.01],[.01,.05],[.05,.2],[.2,.5],[.5,.9],[.9,1.001]]){
  const heights=[];for(let i=0;i<region.vertices.length;i++)if(region.weights[i]>lo&&region.weights[i]<=hi)heights.push(region.posedHeight[i]);
  vertexBins.push({weight:[lo,hi],heights:summary(heights)});
}
const geometry=region.finMesh.geometry,a=geometry.attributes,segments=region.finSegments,perEdge=(segments+1)*2;
const finBins={boundary:[],interior:[]},ratioBins={boundary:[],interior:[]};
for(let i=0;i<region.edges.length;i++){
  const e=region.edges[i],boundary=Math.min(region.weights[e.a],region.weights[e.b])<.05&&Math.max(region.weights[e.a],region.weights[e.b])>0;
  const group=boundary?'boundary':'interior';
  for(let node=0;node<=segments;node++)for(let side=0;side<2;side++){
    const v=i*perEdge+node*2+side,spacing=a.furVolumeThickness.getX(v),height=a.furVolumeEnvelope.getX(v);
    finBins[group].push(spacing);if(height>1e-8)ratioBins[group].push(spacing/(height/region.layers));
  }
}
const faceGradients=[];let mixedFaces=0,zeroFaces=0;
for(let i=0;i<region.indices.length;i+=3){const ids=Array.from(region.indices.subarray(i,i+3));const min=Math.min(...ids.map(v=>region.weights[v])),max=Math.max(...ids.map(v=>region.weights[v]));if(max<=0){zeroFaces++;continue;}if(min<.001&&max>.001){mixedFaces++;for(let j=0;j<3;j++){const a=ids[j],b=ids[(j+1)%3];const distance=Math.hypot(...[0,1,2].map(axis=>region.posedPositions[a*3+axis]-region.posedPositions[b*3+axis]));if(distance>1e-8)faceGradients.push(Math.abs(region.posedHeight[a]-region.posedHeight[b])/distance);}}}
const report={capturedAt:new Date().toISOString(),source:{bundle,bundleSHA:runtime.bundleSha256,assetSHA:runtime.glbSha256},pose:'rest',geometryScales:{envelopeScale:1.4,sweepScale:0},vertexBins,mixedBoundaryFaces:mixedFaces,zeroFaces,boundaryHeightSlope:summary(faceGradients),finPhysicalSpacing:Object.fromEntries(Object.entries(finBins).map(([k,v])=>[k,summary(v)])),finSpacingOverShellStep:Object.fromEntries(Object.entries(ratioBins).map(([k,v])=>[k,summary(v)])),notes:['Source fields are unchanged; no renderer or geometry edits.','A large fin/shell-step ratio is not by itself an optical bug: fins integrate a different direction. Overlap/appearance must be isolated in actual rendering.','At mask0 the envelope is zero; near-positive masks retain full statistical envelope, creating a steep wedge into zero-mask neighbouring vertices.']};
await fs.writeFile(directory+'/volume-domain-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));fur.dispose();
