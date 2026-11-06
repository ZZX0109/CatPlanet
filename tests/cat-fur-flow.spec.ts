import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";

const output = "artifacts/fur-flow-research/verification";
let source: Promise<string> | undefined;
function bundle() {
  return (source ??= build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "ts",
      contents: `
      import * as THREE from 'three';
      import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
      import {createCatFurFlow,bindSurfaceVector,transportSurfaceVector} from './lib/cat-fur-flow';
      import {ownCreatorModel,applyCreatorDesign} from './lib/cat-creator-model';
      import {defaultCreatorDesign as currentDefaultCreatorDesign} from './lib/cat-creator-design';
      import {getCatCoatProfile} from './lib/cat-coat-profiles';
      import {createNorwegianFur} from './lib/norwegian-fur';
      // These regressions intentionally exercise the pre-existing procedural groom.
      const defaultCreatorDesign={...currentDefaultCreatorDesign,coatMode:'groom',coatType:'short',shape:{...currentDefaultCreatorDesign.shape,...getCatCoatProfile('short').defaults}};
      const v=a=>new THREE.Vector3(...a),arr=v=>v.toArray(),distance=(a,b)=>Math.hypot(...a.map((x,i)=>x-b[i]));
      async function load(){const g=await new GLTFLoader().loadAsync('/models/creator/norwegian-cat.glb');return ownCreatorModel(g.scene,g.animations,'norwegian');}
      window.__flowFieldValidation=async()=>{
        const model=await load();
        try {
          const field=createCatFurFlow({...model.landmarks,headBounds:{min:arr(model.bounds.min),max:arr(model.bounds.max)},bodyBounds:{min:arr(model.wholeBounds.min),max:arr(model.wholeBounds.max)}});
          const eyes=model.landmarks.eyeCenters,cx=(eyes[0][0]+eyes[1][0])/2,ey=(eyes[0][1]+eyes[1][1])/2,ez=(eyes[0][2]+eyes[1][2])/2,muzzle=model.landmarks.muzzleCenter,span=Math.abs(eyes[0][0]-eyes[1][0]);
          const semantic=[
            {name:'forehead',point:[cx,ey+.22,ez-.06],normal:[0,.7,.71414284],weights:{head:1},expected:[0,1,-1]},
            {name:'upper nose bridge',point:[cx,muzzle[1]+(ey-muzzle[1])*.85,ez+.14],normal:[0,0,1],weights:{head:1},expected:[0,1,0]},
            {name:'lower nose bridge',point:[cx,muzzle[1]+.06,muzzle[2]+.03],normal:[0,0,1],weights:{head:1},expected:[0,-1,0]},
            {name:'right bridge wing',point:[cx+span*.3,muzzle[1]+.17,ez+.17],normal:[0,0,1],weights:{head:1},expected:[1,.2,0]},
            {name:'right inner eye',point:[cx+span*.24,ey-.025,ez+.055],normal:[0,0,1],weights:{head:1},expected:[1,0,0]},
            {name:'right whisker pad',point:[cx+span*.5,muzzle[1]+.02,muzzle[2]+.02],normal:[0,0,1],weights:{head:1},expected:[1,-.25,0]},
            {name:'right cheek',point:[cx+.38,ey-.13,ez-.03],normal:[.85,.1,.5172],weights:{head:1},expected:[1,-.5,-1]},
            {name:'left cheek',point:[cx-.38,ey-.13,ez-.03],normal:[-.85,.1,.5172],weights:{head:1},expected:[-1,-.5,-1]},
            {name:'back',point:[cx,1.9,0],normal:[0,1,0],weights:{},expected:[0,0,-1]},
            {name:'flank',point:[cx+.6,1.15,.2],normal:[1,0,0],weights:{},expected:[0,-1,-.3]},
            {name:'foreleg',point:[cx+.3,.55,1.3],normal:[1,0,0],weights:{limb:1,axis:[0,-1,0]},expected:[0,-1,0]},
            {name:'tail',point:[cx+.3,.8,-1.2],normal:[1,0,0],weights:{tail:1,axis:[0,-.2,-1]},expected:[0,-.2,-1]},
          ].map(p=>{
            const normal=v(p.normal).normalize(),s=field.sample(p.point,arr(normal),p.weights),t=v(s.tangent);
            const expected=v(p.expected).addScaledVector(normal,-v(p.expected).dot(normal)).normalize();
            return{name:p.name,tangent:s.tangent,alignment:t.dot(expected),normalDot:Math.abs(t.dot(normal)),magnitude:t.length(),finite:Object.values(s).flat().every(Number.isFinite)};
          });
          let maxLocalDirectionDelta=0,maxGuideDirectionDelta=0,maxLocalGuideDelta=0,maxWeightDelta=0,nearGather=0,farGather=0,repeatError=0;
          const normal=arr(v([1,.1,.2]).normalize());
          for(let i=0;i<801;i++){
            const point=[cx+.42,1.55+i*.00125,ez-.35],weights={head:Math.max(0,Math.min(1,(point[1]-1.9)/.5))};
            const s=field.sample(point,normal,weights),near=field.sample([point[0],point[1]+1e-5,point[2]],normal,weights);
            maxLocalDirectionDelta=Math.max(maxLocalDirectionDelta,distance(s.tangent,near.tangent));
            maxGuideDirectionDelta=Math.max(maxGuideDirectionDelta,distance(s.guideTangent,near.guideTangent));
            maxLocalGuideDelta=Math.max(maxLocalGuideDelta,distance(s.gather,near.gather));
            const far=field.sample([point[0],point[1]+.04,point[2]+.025],normal,weights);
            nearGather+=distance(s.gather,near.gather);farGather+=distance(s.gather,far.gather);
            const t=field.sample(point,normal,{head:Math.min(1,weights.head+.0001)});
            maxWeightDelta=Math.max(maxWeightDelta,distance(s.tangent,t.tangent));
            const repeated=field.sample(point,normal,weights);
            for(const key of Object.keys(s))repeatError=Math.max(repeatError,...(Array.isArray(s[key])?s[key].map((x,k)=>Math.abs(x-repeated[key][k])):[Math.abs(s[key]-repeated[key])]));
          }
          const transport=[];
          const vector=[.6,.8,0],ab=[1,0,0],ac=[.2,2,0],binding=bindSurfaceVector(vector,ab,ac);
          for(const axis of [[1,0,0],[0,1,0],[0,0,1],[1,2,3]])for(const angle of [-2.3,-.7,.6,2.7]){
            const q=new THREE.Quaternion().setFromAxisAngle(v(axis).normalize(),angle),rot=a=>arr(v(a).applyQuaternion(q));
            const actual=transportSurfaceVector(binding,rot(ab),rot(ac),rot([0,0,1])),expected=rot(vector);
            transport.push({axis,angle,error:distance(actual,expected),normalDot:Math.abs(v(actual).dot(v(rot([0,0,1]))))});
          }
          // This planar affine example has a known independent result: initial
          // vector (.6,.8) = .52*AB + .4*AC, then preserve its unit length.
          const stretched=transportSurfaceVector(binding,[2,0,0],[.5,1.2,0],[0,0,1]);
          const affineExpected=arr(v([1.24,.48,0]).normalize());
          return{semantic,maxLocalDirectionDelta,maxGuideDirectionDelta,maxLocalGuideDelta,maxWeightDelta,nearGatherMean:nearGather/801,farGatherMean:farGather/801,repeatError,transport,affineError:distance(stretched,affineExpected)};
        }finally{model.dispose();}
      };
      window.__flowAttachmentValidation=async()=>{
        const model=await load();
        try{
          const surface=model.meshes.filter(m=>m.isSkinnedMesh).sort((a,b)=>b.geometry.attributes.position.count-a.geometry.attributes.position.count)[0];
          const fur=await createNorwegianFur(model.scene,surface);model.fur=fur;model.scene.add(...fur.meshes);
          const design={...defaultCreatorDesign,coatType:'long',shape:{...defaultCreatorDesign.shape,...getCatCoatProfile('long').defaults}};
          applyCreatorDesign(model,design);fur.setDetail(1);
          const meshes=fur.meshes.filter(m=>m.userData.furRegion);
          function surfacePoints(){model.scene.updateMatrixWorld(true);surface.skeleton.update();const matrix=model.scene.matrixWorld.clone().invert().multiply(surface.matrixWorld),points=[];for(let i=0;i<surface.geometry.attributes.position.count;i++)points.push(surface.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(matrix));return points;}
          const index=surface.geometry.index,points=surfacePoints(),triangle=new THREE.Triangle(),closest=new THREE.Vector3(),bary=new THREE.Vector3();
          const samples=[];
          for(const mesh of meshes){
            const count=fur.stats()[mesh.userData.furRegion].strands,stride=mesh.userData.strandVertices;
            for(const strand of [0,1,Math.floor(count*.31),Math.floor(count*.69),count-2,count-1]){
              const a=mesh.geometry.attributes.position,i=strand*stride,root=new THREE.Vector3().fromBufferAttribute(a,i).add(new THREE.Vector3().fromBufferAttribute(a,i+1)).multiplyScalar(.5);
              let min=Infinity,best;
              for(let k=0;k<index.count;k+=3){const ids=[index.getX(k),index.getX(k+1),index.getX(k+2)];triangle.set(...ids.map(id=>points[id]));triangle.closestPointToPoint(root,closest);const d=root.distanceToSquared(closest);if(d<min){min=d;triangle.getBarycoord(closest,bary);best={ids,bary:arr(bary)};}}
              samples.push({mesh,strand,stride,...best,initialDistance:Math.sqrt(min)});
            }
          }
          const initial=meshes.map(m=>m.geometry.attributes.position.array.slice()),cases=[];
          const configurations=[
            {name:'neutral rest',pose:'rest',shape:{}},
            {name:'round wide rest',pose:'rest',shape:{headRound:100,headWidth:100,cheeks:100,eyeSize:100,eyeSpacing:0,muzzle:100,earSize:100}},
            {name:'wedge narrow stand',pose:'stand',shape:{headWedge:100,headWidth:0,headDepth:100,jaw:0,muzzleWidth:0,eyeTilt:100,earTilt:100}},
            {name:'wedge narrow rest',pose:'rest',shape:{headWedge:100,headWidth:0,headDepth:100,jaw:0,muzzleWidth:0,eyeTilt:100,earTilt:100}},
          ];
          for(const config of configurations){
            applyCreatorDesign(model,{...design,shape:{...design.shape,...config.shape}});
            model.motion.setPose(config.pose,true);model.motion.update(1,{reducedMotion:true});
            fur.setDetail(.25);fur.refresh();const snapshots=fur.snapshotMeshes();snapshots.forEach(m=>{m.geometry.dispose();if(m.userData.ownedFurExportMaterial)for(const material of Array.isArray(m.material)?m.material:[m.material])material.dispose();});
            const current=surfacePoints();let maxDistance=0;const regions={};
            for(const sample of samples){
              const {mesh,strand,stride,ids,bary}=sample,a=mesh.geometry.attributes.position,i=strand*stride;
              const root=new THREE.Vector3().fromBufferAttribute(a,i).add(new THREE.Vector3().fromBufferAttribute(a,i+1)).multiplyScalar(.5),expected=new THREE.Vector3();
              ids.forEach((id,k)=>expected.addScaledVector(current[id],bary[k]));const d=root.distanceTo(expected);
              maxDistance=Math.max(maxDistance,d);regions[mesh.userData.furRegion]=Math.max(regions[mesh.userData.furRegion]??0,d);
            }
            cases.push({name:config.name,maxDistance,regions,finite:meshes.every(m=>m.geometry.attributes.position.array.every(Number.isFinite))});
          }
          model.motion.setPose('stand',true);model.motion.update(2,{reducedMotion:true});applyCreatorDesign(model,design);fur.setDetail(1);fur.refresh({full:true});
          let returnError=0;meshes.forEach((m,k)=>{const a=m.geometry.attributes.position.array;for(let i=0;i<a.length;i++)returnError=Math.max(returnError,Math.abs(a[i]-initial[k][i]));});
          // Rotate the actual head relative to its stationary torso. A global
          // scene turn would also rotate incorrectly world-combed hair, so it
          // cannot expose a missing surface-direction binding. Scene Y keeps
          // gravity invariant and isolates the transported geometric groom.
          const head=model.scene.getObjectByName('head'),headBones=new Set();head?.traverse(b=>headBones.add(b));
          const skinIndex=surface.geometry.attributes.skinIndex,skinWeight=surface.geometry.attributes.skinWeight;
          const headWeight=id=>{let sum=0;for(let k=0;k<4;k++)if(headBones.has(surface.skeleton.bones[skinIndex.getComponent(id,k)]))sum+=skinWeight.getComponent(id,k);return sum;};
          const rigid=samples.filter(s=>s.mesh.userData.furRegion==='head'&&s.ids.every(id=>headWeight(id)>.995));
          function segment(sample,pair){const a=sample.mesh.geometry.attributes.position,i=sample.strand*sample.stride;const center=p=>new THREE.Vector3().fromBufferAttribute(a,i+p).add(new THREE.Vector3().fromBufferAttribute(a,i+p+1)).multiplyScalar(.5);return center(pair).sub(center(0));}
          const vectors=rigid.map(s=>({first:segment(s,2),tip:segment(s,s.stride-2)})),rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.45),headQuaternion=head?.quaternion.clone();
          if(!head||!head.parent)throw new Error('Head rig unavailable');
          const sceneRotation=model.scene.getWorldQuaternion(new THREE.Quaternion()),worldAxis=new THREE.Vector3(0,1,0).applyQuaternion(sceneRotation),worldTurn=new THREE.Quaternion().setFromAxisAngle(worldAxis,.45),headWorld=head.getWorldQuaternion(new THREE.Quaternion()),parentWorld=head.parent.getWorldQuaternion(new THREE.Quaternion());
          head.quaternion.copy(parentWorld.invert().multiply(worldTurn.multiply(headWorld)));model.scene.updateMatrixWorld(true);fur.refresh({full:true});
          const rotationSamples=rigid.map((s,k)=>{const first=segment(s,2),tip=segment(s,s.stride-2),expectedFirst=vectors[k].first.clone().applyQuaternion(rotation),expectedTip=vectors[k].tip.clone().applyQuaternion(rotation);return{strand:s.strand,firstAngle:first.angleTo(expectedFirst),tipAngle:tip.angleTo(expectedTip),relativeFirstError:first.distanceTo(expectedFirst)/Math.max(1e-8,expectedFirst.length())};});
          head.quaternion.copy(headQuaternion);model.scene.updateMatrixWorld(true);fur.refresh({full:true});
          return{samples:samples.map(s=>({region:s.mesh.userData.furRegion,strand:s.strand,initialDistance:s.initialDistance})),cases,returnError,rotationSamples,stats:fur.stats()};
        }finally{model.dispose();}
      };`,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
  }).then((result) => result.outputFiles[0].text));
}
async function runner(page: Page) {
  await page.route("**/__fur-flow-validation", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><body></body>",
    }),
  );
  await page.goto("http://localhost:3000/__fur-flow-validation");
  await page.addScriptTag({ content: await bundle() });
  await mkdir(output, { recursive: true });
}

test("groom follows feline anatomy continuously and transports with the skin", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await runner(page);
  const result = await page.evaluate(() =>
    (window as any).__flowFieldValidation(),
  );
  await writeFile(`${output}/field.json`, JSON.stringify(result, null, 2));
  for (const sample of result.semantic) {
    expect(sample.finite, sample.name).toBe(true);
    expect(sample.normalDot, sample.name).toBeLessThan(1e-5);
    expect(sample.magnitude, sample.name).toBeCloseTo(1, 4);
    expect(sample.alignment, sample.name).toBeGreaterThan(0.6);
  }
  const face = Object.fromEntries(result.semantic.map((sample: any) => [sample.name, sample.tangent]));
  expect(face["upper nose bridge"][1]).toBeGreaterThan(0.5);
  expect(face["lower nose bridge"][1]).toBeLessThan(-0.5);
  expect(face["right bridge wing"][1]).toBeGreaterThan(0.05);
  expect(face["right inner eye"][0]).toBeGreaterThan(0.6);
  expect(face["right whisker pad"][0]).toBeGreaterThan(0.5);
  expect(result.maxLocalDirectionDelta).toBeLessThan(0.02);
  expect(result.maxGuideDirectionDelta).toBeLessThan(0.02);
  expect(result.maxLocalGuideDelta).toBeLessThan(0.0001);
  expect(result.maxWeightDelta).toBeLessThan(0.005);
  expect(result.nearGatherMean).toBeLessThan(result.farGatherMean * 0.02);
  expect(result.repeatError).toBe(0);
  for (const sample of result.transport) {
    expect(sample.error).toBeLessThan(1e-5);
    expect(sample.normalDot).toBeLessThan(1e-5);
  }
  expect(result.affineError).toBeLessThan(1e-5);
});

test("full groom retains its original skin binding through combined morphs and resting poses", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await runner(page);
  const result = await page.evaluate(() =>
    (window as any).__flowAttachmentValidation(),
  );
  await writeFile(`${output}/attachment.json`, JSON.stringify(result, null, 2));
  expect(result.samples).toHaveLength(18);
  for (const sample of result.samples)
    expect(sample.initialDistance).toBeLessThan(0.002);
  for (const sample of result.cases) {
    expect(sample.finite, sample.name).toBe(true);
    expect(sample.maxDistance, sample.name).toBeLessThan(0.006);
  }
  expect(result.returnError).toBeLessThan(1e-5);
  expect(result.rotationSamples.length).toBeGreaterThanOrEqual(3);
  for (const sample of result.rotationSamples) {
    expect(sample.firstAngle).toBeLessThan(0.08);
    expect(sample.tipAngle).toBeLessThan(0.08);
    expect(sample.relativeFirstError).toBeLessThan(0.08);
  }
});
