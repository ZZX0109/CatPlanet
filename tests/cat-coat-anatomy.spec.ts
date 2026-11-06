import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";

const output = "artifacts/coat-anatomy/verification";
let compiled: Promise<string> | undefined;
function bundle() {
  return (compiled ??= build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "ts",
      contents: `
      import * as THREE from 'three';
      import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
      import {createCatCoatAnatomy,coatHairProfile} from './lib/cat-coat-anatomy';
      import {ownCreatorModel,applyCreatorDesign} from './lib/cat-creator-model';
      import {defaultCreatorDesign as currentDefaultCreatorDesign} from './lib/cat-creator-design';
      import {getCatCoatProfile} from './lib/cat-coat-profiles';
      import {createNorwegianFur} from './lib/norwegian-fur';
      // These regressions intentionally exercise the pre-existing procedural groom.
      const defaultCreatorDesign={...currentDefaultCreatorDesign,coatMode:'groom',coatType:'short',shape:{...currentDefaultCreatorDesign.shape,...getCatCoatProfile('short').defaults}};
      const v=a=>new THREE.Vector3(...a),arr=p=>p.toArray();
      const mean=a=>a.reduce((s,v)=>s+v,0)/Math.max(1,a.length);
      const quantile=(a,t)=>{const b=[...a].sort((x,y)=>x-y);return b[Math.floor((b.length-1)*t)]};
      const finite=o=>typeof o==='number'?Number.isFinite(o):typeof o==='string'||typeof o==='boolean'?true:o==null?false:Array.isArray(o)?o.every(finite):Object.values(o).every(finite);
      const load=async()=>{const g=await new GLTFLoader().loadAsync('/models/creator/norwegian-cat.glb');return ownCreatorModel(g.scene,g.animations,'norwegian')};
      window.__coatAnatomyField=async()=>{
        const model=await load();
        try {
          const config={...model.landmarks,headBounds:{min:arr(model.bounds.min),max:arr(model.bounds.max)},bodyBounds:{min:arr(model.wholeBounds.min),max:arr(model.wholeBounds.max)}};
          const anatomy=createCatCoatAnatomy(config),eyes=model.landmarks.eyeCenters,cx=(eyes[0][0]+eyes[1][0])/2,ey=(eyes[0][1]+eyes[1][1])/2,ez=(eyes[0][2]+eyes[1][2])/2,lo=model.wholeBounds.min.y,h=model.wholeBounds.max.y-lo;
          const probes=[
            {name:'dorsum',point:[cx,lo+h*.63,ez-1.45],normal:[0,1,0],weights:{}},
            {name:'belly',point:[cx,lo+h*.31,ez-1.45],normal:[0,-1,0],weights:{}},
            {name:'cheek',point:[cx+.30,ey-.13,ez+.055],normal:[.6,0,.8],weights:{head:1}},
            {name:'ear back',point:[...model.landmarks.earBases[0]],normal:[0,.2,-.98],weights:{head:1}},
            {name:'distal limb',point:[cx+.32,lo+h*.10,ez-.65],normal:[1,0,0],weights:{limb:1}},
            {name:'ruff',point:[cx+.28,ey-.55,ez-.30],normal:[.6,-.2,.77],weights:{}},
          ].map(p=>({...p,sample:anatomy.sample(p.point,arr(v(p.normal).normalize()),p.weights)}));
          const by=Object.fromEntries(probes.map(p=>[p.name,p.sample]));
          const family=[];
          for(const coat of ['short','long']){
            const groups={down:[],awn:[],guard:[]};
            for(let i=0;i<4096;i++){const s=coatHairProfile((i+.5)/4096,by.dorsum,coat);if(!groups[s.kind])throw Error('Unknown hair family');groups[s.kind].push(s);}
            family.push({coat,kinds:Object.fromEntries(Object.entries(groups).map(([name,items])=>[name,{count:items.length,length:mean(items.map(s=>s.lengthScale)),width:mean(items.map(s=>s.widthScale)),crimp:mean(items.map(s=>s.crimp)),lift:mean(items.map(s=>s.liftScale)),finite:items.every(finite)}]))});
          }
          let repeatError=0,maxStep=0;
          const fields=['density','lengthScale','widthScale','liftScale','crimp','downShare','awnShare'];
          for(let i=0;i<401;i++){
            const p=[cx+.4,lo+h*(.20+i*.0015),ez-.6],normal=arr(v([1,(i/400)*2-1,.15]).normalize()),weights={head:Math.max(0,Math.min(1,(p[1]-ey+.6)/.6))};
            const a=anatomy.sample(p,normal,weights),b=anatomy.sample([p[0],p[1]+1e-5,p[2]],normal,weights),c=anatomy.sample(p,normal,weights);
            for(const key of fields){maxStep=Math.max(maxStep,Math.abs(a[key]-b[key]));repeatError=Math.max(repeatError,Math.abs(a[key]-c[key]));}
          }
          return{probes,family,maxStep,repeatError,allFinite:probes.every(p=>finite(p.sample))};
        }finally{model.dispose();}
      };
      window.__coatAnatomyGeometry=async()=>{
        const model=await load();
        try{
          const surface=model.meshes.filter(m=>m.isSkinnedMesh).sort((a,b)=>b.geometry.attributes.position.count-a.geometry.attributes.position.count)[0],fur=await createNorwegianFur(model.scene,surface);model.fur=fur;model.scene.add(...fur.meshes);
          const design={...defaultCreatorDesign,coatType:'long',shape:{...defaultCreatorDesign.shape,...getCatCoatProfile('long').defaults,headFurDensity:100,ruffFurDensity:100,bodyFurDensity:100}};
          applyCreatorDesign(model,design);fur.setDetail(1);
          const body=fur.meshes.find(m=>m.userData.furRegion==='body'),index=surface.geometry.index,skin=[],point=new THREE.Vector3(),inverse=model.scene.matrixWorld.clone().invert(),matrix=inverse.multiply(surface.matrixWorld);
          surface.skeleton.update();for(let i=0;i<surface.geometry.attributes.position.count;i++)skin.push(surface.getVertexPosition(i,point).applyMatrix4(matrix).clone());
          const ez=(model.landmarks.eyeCenters[0][2]+model.landmarks.eyeCenters[1][2])/2,zMin=ez-1.8,zMax=ez-1.1;
          const band=skin.filter(p=>p.z>zMin&&p.z<zMax),ys=band.map(p=>p.y),bottom=quantile(ys,.05),top=quantile(ys,.95),dorsalY=bottom+(top-bottom)*.72,ventralY=bottom+(top-bottom)*.28;
          const area={all:0,dorsal:0,ventral:0},ab=new THREE.Vector3(),ac=new THREE.Vector3(),cross=new THREE.Vector3();
          const skinIndex=surface.geometry.attributes.skinIndex,skinWeight=surface.geometry.attributes.skinWeight;
          const appendage=skin.map((_,id)=>{let w=0;for(let k=0;k<4;k++)if(/Leg|Palm|Digit|Tail/.test(surface.skeleton.bones[skinIndex.getComponent(id,k)].name))w+=skinWeight.getComponent(id,k);return w});
          const triGrid=new Map(),triangles=[],triCell=.08,tkey=(x,y,z)=>x+','+y+','+z;
          for(let k=0;k<index.count;k+=3){
            const ids=[index.getX(k),index.getX(k+1),index.getX(k+2)],a=skin[ids[0]],b=skin[ids[1]],c=skin[ids[2]],z=(a.z+b.z+c.z)/3;
            const n=cross.crossVectors(ab.subVectors(b,a),ac.subVectors(c,a)).clone(),s=n.length()*.5; n.normalize();
            const limbWeight=mean(ids.map(i=>appendage[i])),tag=limbWeight<.15?(n.y>.45?'dorsal':n.y<-.45?'ventral':null):null;
            const record={a,b,c,tag};triangles.push(record);
            const lower=[Math.min(a.x,b.x,c.x),Math.min(a.y,b.y,c.y),Math.min(a.z,b.z,c.z)].map(v=>Math.floor((v-.002)/triCell));
            const upper=[Math.max(a.x,b.x,c.x),Math.max(a.y,b.y,c.y),Math.max(a.z,b.z,c.z)].map(v=>Math.floor((v+.002)/triCell));
            for(let x=lower[0];x<=upper[0];x++)for(let y=lower[1];y<=upper[1];y++)for(let z=lower[2];z<=upper[2];z++){const key=tkey(x,y,z),items=triGrid.get(key)||[];items.push(record);triGrid.set(key,items);}
            if(z>zMin&&z<zMax){area.all+=s;if(tag)area[tag]+=s;}
          }
          const nearestTriangle=new THREE.Triangle(),closest=new THREE.Vector3();let unmatchedRoots=0;
          const rootZone=p=>{const candidates=triGrid.get(tkey(Math.floor(p.x/triCell),Math.floor(p.y/triCell),Math.floor(p.z/triCell)))||[];let distance=Infinity,best=null;for(const t of candidates){nearestTriangle.set(t.a,t.b,t.c).closestPointToPoint(p,closest);const d=closest.distanceToSquared(p);if(d<distance){distance=d;best=t;}}if(!best)unmatchedRoots++;return best?.tag;};
          const stride=body.userData.strandVertices,count=fur.stats().body.strands,positions=body.geometry.attributes.position,roots=[],fibers=[];
          const pair=(a,i)=>new THREE.Vector3().fromBufferAttribute(a,i).add(new THREE.Vector3().fromBufferAttribute(a,i+1)).multiplyScalar(.5);
          for(let strand=0;strand<count;strand++){
            const offset=strand*stride,root=pair(positions,offset);if(root.z<=zMin||root.z>=zMax)continue;
            roots.push(root);let previous=root,length=0;for(let s=2;s<stride;s+=2){const p=pair(positions,offset+s);length+=p.distanceTo(previous);previous=p;}
            const width=new THREE.Vector3().fromBufferAttribute(positions,offset).distanceTo(new THREE.Vector3().fromBufferAttribute(positions,offset+1));
            const zone=rootZone(root);fibers.push({strand,root:arr(root),length,width,dorsal:zone==='dorsal',ventral:zone==='ventral'});
          }
          const counts={all:roots.length,dorsal:fibers.filter(s=>s.dorsal).length,ventral:fibers.filter(s=>s.ventral).length},rates={dorsal:counts.dorsal/area.dorsal,ventral:counts.ventral/area.ventral};
          // Nearest-neighbour distances from the actual geometric roots. A
          // 2D homogeneous Poisson reference is only an engineering baseline,
          // not an estimate of real cat follicle spacing.
          const cell=.02,grid=new Map(),key=(x,y,z)=>x+','+y+','+z;
          roots.forEach((p,i)=>{const k=key(Math.floor(p.x/cell),Math.floor(p.y/cell),Math.floor(p.z/cell));const ids=grid.get(k)||[];ids.push(i);grid.set(k,ids)});
          const nearest=[];
          for(let i=0;i<roots.length;i+=3){const p=roots[i],x=Math.floor(p.x/cell),y=Math.floor(p.y/cell),z=Math.floor(p.z/cell);let d=Infinity;
            for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(let c=-1;c<=1;c++)for(const j of grid.get(key(x+a,y+b,z+c))||[])if(i!==j)d=Math.min(d,p.distanceTo(roots[j]));if(Number.isFinite(d))nearest.push(d);}
          const referenceNearest=.5/Math.sqrt(counts.all/area.all),neighborRatio=mean(nearest)/referenceNearest;
          const dorsal=fibers.filter(s=>s.dorsal),width10=quantile(dorsal.map(s=>s.width),.10),width50=quantile(dorsal.map(s=>s.width),.50),width95=quantile(dorsal.map(s=>s.width),.95),width99=quantile(dorsal.map(s=>s.width),.99);
          const thin=dorsal.filter(s=>s.width<=width50),thick=dorsal.filter(s=>s.width>=width95);
          const familyCut=[width10*1.35,width99*.72],hist=items=>{const n=[0,0,0];for(const f of items)n[f.width<familyCut[0]?0:f.width<familyCut[1]?1:2]++;return n.map(v=>v/Math.max(1,items.length));};
          const fullMix=hist(fibers);fur.setDetail(.25);const previewCount=fur.stats().body.previewStrands,previewMix=hist(fibers.filter(f=>f.strand<previewCount));
          const eyeBoxes=model.meshes.filter(m=>(Array.isArray(m.material)?m.material:[m.material]).some(a=>a.userData.creatorRole==='eye-globe')).map(mesh=>{const b=new THREE.Box3();for(let i=0;i<mesh.geometry.attributes.position.count;i++)b.expandByPoint(mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));return{center:b.getCenter(new THREE.Vector3()),half:b.getSize(new THREE.Vector3()).multiplyScalar(.5)}});
          let insideEyes=0,pinkFaceHairs=0,belowGroundRoots=0;
          for(const mesh of fur.meshes.filter(m=>m.userData.furRegion)){const a=mesh.geometry.attributes.position,colors=mesh.geometry.attributes.color,stride=mesh.userData.strandVertices,n=fur.stats()[mesh.userData.furRegion].strands;
            for(let i=0;i<n;i++){const p=pair(a,i*stride);if(p.y<model.wholeBounds.min.y-.001)belowGroundRoots++;if(mesh.userData.furRegion!=='head')continue;for(const eye of eyeBoxes){const d=p.clone().sub(eye.center).divide(eye.half);if(d.lengthSq()<.75)insideEyes++;}if(p.z>ez-.3&&colors.getX(i*stride)>colors.getY(i*stride)*1.5&&colors.getX(i*stride)>colors.getZ(i*stride)*1.2)pinkFaceHairs++;}}
          model.motion.setPose('rest',true);model.motion.update(1,{reducedMotion:true});applyCreatorDesign(model,{...design,shape:{...design.shape,headRound:100,headWidth:75,headDepth:35,cheeks:80,jaw:75,muzzle:30,muzzleWidth:60}});fur.refresh();const snapshots=fur.snapshotMeshes();
          const snapshotCounts=snapshots.filter(m=>m.userData.furRegion).map(m=>({region:m.userData.furRegion,strands:m.geometry.index.count/m.userData.strandIndices,intended:fur.stats()[m.userData.furRegion].strands,finite:m.geometry.attributes.position.array.every(Number.isFinite)}));snapshots.forEach(m=>{m.geometry.dispose();if(m.userData.ownedFurExportMaterial)for(const material of Array.isArray(m.material)?m.material:[m.material])material.dispose();});
          applyCreatorDesign(model,{...design,shape:{...design.shape,headFurDensity:0,ruffFurDensity:0,bodyFurDensity:0}});const zero=fur.snapshotMeshes(),zeroRegions=zero.filter(m=>m.userData.furRegion&&m.geometry.index.count>0).length,zeroUndercoat=zero.some(m=>m.userData.undercoat),whiskersRemain=zero.some(m=>m.userData.groomDetail==='whiskers'&&m.geometry.attributes.position.count>0);zero.forEach(m=>m.geometry.dispose());
          return{band:{zMin,zMax,bottom,top,classification:'Actual skin face normals: Y>0.45/Y<-0.45, leg/palm/digit/tail mean weight<0.15; geometric root assigned by closest indexed skin triangle',unmatchedRoots},area,counts,rates,neighbor:{mean:mean(nearest),reference:referenceNearest,ratio:neighborRatio,samples:nearest.length},layers:{samples:dorsal.length,width10,width50,width95,width99,thinMeanLength:mean(thin.map(s=>s.length)),thickMeanLength:mean(thick.map(s=>s.length))},fullMix,previewMix,insideEyes,pinkFaceHairs,belowGroundRoots,snapshotCounts,zeroRegions,zeroUndercoat,whiskersRemain};
        }finally{model.dispose();}
      };
    `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
  }).then((r) => r.outputFiles[0].text));
}
async function runner(page: Page) {
  await page.route("**/__coat-anatomy", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<!doctype html><body></body>",
    }),
  );
  await page.goto("http://localhost:3000/__coat-anatomy");
  await page.addScriptTag({ content: await bundle() });
  await mkdir(output, { recursive: true });
}

test("regional coat anatomy is continuous and produces distinct down, awn and guard hairs", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await runner(page);
  const report = await page.evaluate(() =>
    (window as any).__coatAnatomyField(),
  );
  await writeFile(`${output}/field.json`, JSON.stringify(report, null, 2));
  expect(report.allFinite).toBe(true);
  expect(report.repeatError).toBe(0);
  expect(report.maxStep).toBeLessThan(0.01);
  const by = Object.fromEntries(
    report.probes.map((p: any) => [p.name, p.sample]),
  );
  expect(by.dorsum.density).toBeGreaterThan(by.belly.density);
  expect(by.cheek.lengthScale).toBeLessThan(by.dorsum.lengthScale);
  expect(by["distal limb"].lengthScale).toBeLessThan(by.ruff.lengthScale);
  for (const family of report.family) {
    const { down, awn, guard } = family.kinds;
    for (const row of [down, awn, guard]) {
      expect(row.count).toBeGreaterThan(10);
      expect(row.finite).toBe(true);
    }
    expect(down.length).toBeLessThan(awn.length);
    expect(awn.length).toBeLessThan(guard.length);
    expect(down.width).toBeLessThan(awn.width);
    expect(awn.width).toBeLessThan(guard.width);
    expect(down.crimp).toBeGreaterThan(guard.crimp);
  }
});

test("real roots show regional planting and grouping while layered geometry survives LOD and export", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await runner(page);
  const report = await page.evaluate(() =>
    (window as any).__coatAnatomyGeometry(),
  );
  await writeFile(`${output}/geometry.json`, JSON.stringify(report, null, 2));
  expect(report.counts.all).toBeGreaterThan(500);
  expect(report.area.dorsal).toBeGreaterThan(0.01);
  expect(report.area.ventral).toBeGreaterThan(0.01);
  expect(report.band.unmatchedRoots).toBe(0);
  // The current editable regional model intentionally reduces ventral planting;
  // this validates that choice, not a universal biological cat-density claim.
  expect(report.rates.dorsal).toBeGreaterThan(report.rates.ventral * 1.02);
  expect(report.neighbor.samples).toBeGreaterThan(100);
  expect(report.neighbor.ratio).toBeLessThan(0.8);
  expect(report.layers.samples).toBeGreaterThan(200);
  expect(report.layers.width99 / report.layers.width10).toBeGreaterThan(1.8);
  expect(report.layers.thickMeanLength).toBeGreaterThan(
    report.layers.thinMeanLength * 1.3,
  );
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(report.previewMix[i] - report.fullMix[i])).toBeLessThan(
      0.04,
    );
    expect(report.previewMix[i]).toBeGreaterThan(report.fullMix[i] * 0.45);
  }
  expect(report.insideEyes).toBe(0);
  expect(report.pinkFaceHairs).toBe(0);
  expect(report.belowGroundRoots).toBe(0);
  expect(report.snapshotCounts).toHaveLength(3);
  for (const row of report.snapshotCounts) {
    expect(row.strands).toBe(row.intended);
    expect(row.finite).toBe(true);
  }
  expect(report.zeroRegions).toBe(0);
  expect(report.zeroUndercoat).toBe(false);
  expect(report.whiskersRemain).toBe(true);
});
