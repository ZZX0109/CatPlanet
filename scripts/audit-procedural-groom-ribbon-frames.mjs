/** Current programme geometry + recorded actual camera. Pure CPU, no renderer. */
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {loadArchivedGroom} from './cat-groom-audit-runtime.mjs';
const dir='artifacts/procedural-groom/ribbon-diagnosis';
const capture=JSON.parse(await fs.readFile('artifacts/procedural-groom/after-full-coat/capture-report.json','utf8'));
const frame=capture.frames.find(f=>f.view==='head')??capture.frames[0];
const actual=frame.actual;
const variant=process.argv[2]??'baseline';
if(!['baseline','no-wave','low-loft'].includes(variant))throw Error('Unknown CPU-only variant');
const runtime=await loadArchivedGroom(dir+'/model-probe.js',{transformBundle:source=>{
 if(variant==='no-wave')return source.replace(/const waveAmplitude = length \*[^;]+;/,'const waveAmplitude = 0;');
 if(variant==='low-loft')return source.replace('const normalGain = root.hairLift * outerLay * backLay * downDepthGain * appendageLay;','const normalGain = root.hairLift * outerLay * backLay * downDepthGain * appendageLay * (longCoat && region.name === "body" ? .6 : 1);');
 return source;
}});
const {api,model,fur,state}=runtime;
model.motion.setBreathing(false);model.motion.setIdleBlink(false);
const design=actual.design??actual.appearance;
if(!design)throw Error('Recorded full design missing.');
api.applyCreatorDesign(model,design);fur.refresh({full:true});
const camera=actual.camera;
const world=new THREE.Matrix4().fromArray(actual.modelWorld);
const cameraWorld=new THREE.Matrix4().lookAt(new THREE.Vector3(...camera.position),new THREE.Vector3(...camera.target),new THREE.Vector3(0,1,0)).setPosition(...camera.position);
const mvp=new THREE.Matrix4().fromArray(camera.projection).multiply(cameraWorld.clone().invert()).multiply(world);
const project=p=>new THREE.Vector3(...p).applyMatrix4(mvp);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const unit=v=>{const l=Math.hypot(...v);return v.map(x=>x/(l||1));};
const dist=a=>{a.sort((x,y)=>x-y);return a.length?{median:a[Math.floor((a.length-1)*.5)],p95:a[Math.floor((a.length-1)*.95)],p99:a[Math.floor((a.length-1)*.99)],max:a.at(-1)}:null;};
const groups=new Map();
for(const region of state.regions){
 const positions=region.mesh.geometry.attributes.position;
 for(let strand=0;strand<region.mesh.userData.strandCount;strand++){
  const root=region.roots[strand],key=region.name+'/'+root.hairKind;
  if(!groups.has(key))groups.set(key,{strands:0,turns:[],flipStrands:0,maxTurnOver30:0,maxTurnOver45:0});
  const g=groups.get(key),points=[],screenWidths=[];
  for(let node=0;node<=region.strandSegments;node++){
   const index=strand*region.strandVertices+node*2;
   const left=[0,1,2].map(a=>positions.getComponent(index,a)),right=[0,1,2].map(a=>positions.getComponent(index+1,a));
   const center=left.map((x,a)=>(x+right[a])/2);points.push(center);
   const c=project(center),r=project(right);screenWidths.push(unit([r.x-c.x,r.y-c.y]));
  }
  let maxTurn=0,flip=false;
  for(let n=1;n<region.strandSegments;n++){
   const a=unit(points[n].map((x,i)=>x-points[n-1][i])),b=unit(points[n+1].map((x,i)=>x-points[n][i]));
   const angle=Math.acos(Math.max(-1,Math.min(1,dot(a,b))))*180/Math.PI;g.turns.push(angle);maxTurn=Math.max(maxTurn,angle);
  }
  for(let n=1;n<screenWidths.length;n++)if(dot(screenWidths[n-1],screenWidths[n])<0)flip=true;
  g.strands++;g.flipStrands+=+flip;g.maxTurnOver30+=+(maxTurn>30);g.maxTurnOver45+=+(maxTurn>45);
 }
}
const report={variant,variantChanges:'Only in-memory audit bundle changes, no runtime or shader edits.',bundleSHA256:runtime.bundleSha256,modelSHA256:runtime.glbSha256,view:frame.view,sourceCamera:'after-full-coat/capture-report.json actual camera/modelWorld',groups:[...groups].map(([region,g])=>({region,strands:g.strands,chordTurnDegrees:dist(g.turns),strandsWithTurnOver30:g.maxTurnOver30,strandsWithTurnOver45:g.maxTurnOver45,strandsWithAdjacentProjectedSpanReversal:g.flipStrands})),limits:['CPU geometry attribution only; does not prove a particular visible pixel came from this fibre.','Projected span reversal diagnoses possible expanded ribbon fold; it is not proof that its affected segment is on screen or visible after opaque depth.','No browser, GPU, application or existing source file modified.']};
await fs.writeFile(dir+'/geometry-frame-'+variant+'.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.groups));
fur.dispose();model.scene.traverse(n=>{if(n.isMesh)n.geometry?.dispose();});
