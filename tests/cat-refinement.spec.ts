import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import sharp from "sharp";

const ARTIFACTS = "artifacts/table-refinement/verification";
let bundled: Promise<string> | undefined;
function bundle() {
  return (bundled ??= build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "ts",
      contents: `
      import * as THREE from 'three';
      import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
      import {createCreatorMotion} from './lib/cat-creator-motion';
      import {ownCreatorModel,applyCreatorDesign} from './lib/cat-creator-model';
      import {defaultCreatorDesign as currentDefaultCreatorDesign,creatorControls} from './lib/cat-creator-design';
      import {createNorwegianFur} from './lib/norwegian-fur';
      import {getCatCoatProfile} from './lib/cat-coat-profiles';
      // These regressions intentionally exercise the pre-existing procedural groom.
      const defaultCreatorDesign={...currentDefaultCreatorDesign,coatMode:'groom',coatType:'short',shape:{...currentDefaultCreatorDesign.shape,...getCatCoatProfile('short').defaults}};
      async function load(base){const gltf=await new GLTFLoader().loadAsync('/models/creator/'+base+'-cat.glb');return ownCreatorModel(gltf.scene,gltf.animations,base);}
      function positions(model,only){model.scene.updateMatrixWorld(true);const result=[],p=new THREE.Vector3();
        for(const mesh of model.meshes){if(only&&!only(mesh))continue;if(mesh.isSkinnedMesh)mesh.skeleton.update();
          for(let i=0;i<mesh.geometry.attributes.position.count;i++){mesh.getVertexPosition(i,p).applyMatrix4(mesh.matrixWorld);result.push(p.x,p.y,p.z);}}
        return result;}
      function difference(a,b){let changed=0,max=0;for(let i=0;i<a.length;i+=3){const d=Math.hypot(a[i]-b[i],a[i+1]-b[i+1],a[i+2]-b[i+2]);if(d>1e-6)changed++;max=Math.max(max,d);}return{changed,max};}
      function bounds(a){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<a.length;i++) {const axis=i%3;min[axis]=Math.min(min[axis],a[i]);max[axis]=Math.max(max[axis],a[i]);}return{min,max};}
      window.__refinementMotion=async(base)=>{const model=await load(base),motion=createCreatorMotion(model.scene,base);
        try{const stand=positions(model);motion.setPose('rest',true);motion.update(1);const rest=positions(model);
          motion.setPose('stand',true);motion.update(2);const returned=positions(model);
          motion.setBreathing(true);motion.update(0);const inhale=positions(model);motion.update(.9);const exhale=positions(model);
          motion.update(1,{reducedMotion:true});const reduced=positions(model);motion.setBreathing(false);motion.update(2);const quiet=positions(model);motion.setPose('rest');let transitionMin=Infinity;for(let i=1;i<=35;i++){motion.update(2+i*.05);transitionMin=Math.min(transitionMin,bounds(positions(model)).min[1]);}motion.setPose('stand');let transitionBackMin=Infinity;for(let i=1;i<=35;i++){motion.update(4+i*.05);transitionBackMin=Math.min(transitionBackMin,bounds(positions(model)).min[1]);}
          return{base,stand:bounds(stand),rest:bounds(rest),pose:difference(stand,rest),return:difference(stand,returned),breath:difference(inhale,exhale),reduced:difference(stand,reduced),quiet:difference(stand,quiet),transitionMin,transitionBackMin,breathMin:Math.min(bounds(inhale).min[1],bounds(exhale).min[1]),finite:[...stand,...rest,...returned,...inhale,...exhale].every(Number.isFinite)};
        }finally{motion.dispose();model.dispose();}};
      const materialFor=hit=>Array.isArray(hit.object.material)?hit.object.material[hit.face.materialIndex||0]:hit.object.material;
      const eyeRole=mesh=>(Array.isArray(mesh.material)?mesh.material:[mesh.material]).some(m=>m.userData.creatorRole==='eye-globe'||/EyeOptics/.test(m.name));
      function eyeSamples(model){const samples=[],ray=new THREE.Raycaster(),p=new THREE.Vector3();model.scene.updateMatrixWorld(true);
        for(const eye of model.meshes.filter(eyeRole)){const box=new THREE.Box3();if(eye.isSkinnedMesh)eye.skeleton.update();
          for(let i=0;i<eye.geometry.attributes.position.count;i++){eye.getVertexPosition(i,p).applyMatrix4(eye.matrixWorld);box.expandByPoint(p);}
          const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
          for(const [x,y]of [[0,0],[-.12,0],[.12,0],[0,-.12],[0,.12]]){
            const origin=center.clone().add(new THREE.Vector3(x*size.x,y*size.y,2));ray.set(origin,new THREE.Vector3(0,0,-1));
            const hit=ray.intersectObjects(model.meshes,false)[0],material=hit?materialFor(hit):null;
            samples.push({eye:eye.name,hit:hit?.object.name||null,visible:!!material&&(material.userData.creatorRole==='eye-globe'||/EyeOptics/.test(material.name))});
          }}return samples;}
      window.__refinementBlink=async(base)=>{const model=await load(base);const design={...defaultCreatorDesign,coatType:base==='sphynx'?'hairless':'short',shape:{...defaultCreatorDesign.shape}};
        try{const cases=[];const endpoints=creatorControls.filter(c=>c.group!=='fur').flatMap(c=>[{[c.key]:0},{[c.key]:100}]);for(const combination of [{},...endpoints,{headWidth:100,eyeSize:100,eyeSpacing:0,muzzle:100},{headWidth:0,eyeSize:0,eyeTilt:100,earSize:100,muzzleWidth:0}]){
          const d={...design,shape:{...design.shape,...combination}};applyCreatorDesign(model,d,0);const open=eyeSamples(model),eyes=positions(model,eyeRole);
          applyCreatorDesign(model,d,1);const closed=eyeSamples(model),eyesClosed=positions(model,eyeRole),all=positions(model);
          cases.push({combination,open,closed,eyeShape:difference(eyes,eyesClosed),finite:all.every(Number.isFinite)});}
          const motion=model.motion;applyCreatorDesign(model,design,0);motion.setPose('rest',true);motion.update(1);const restOpen=eyeSamples(model),restEyes=positions(model,eyeRole);applyCreatorDesign(model,design,1);const restClosed=eyeSamples(model),restEyesClosed=positions(model,eyeRole),restAll=positions(model);cases.push({combination:{pose:'rest'},open:restOpen,closed:restClosed,eyeShape:difference(restEyes,restEyesClosed),finite:restAll.every(Number.isFinite)});motion.dispose();
          return{base,supportsBlink:model.supportsBlink,cases};
        }finally{model.dispose();}};
      window.__refinementLod=async()=>{const model=await load('norwegian');const design={...defaultCreatorDesign,coatType:'long',shape:{...defaultCreatorDesign.shape}};
        try{const surface=model.meshes.filter(m=>m.isSkinnedMesh).sort((a,b)=>b.geometry.attributes.position.count-a.geometry.attributes.position.count)[0];const fur=await createNorwegianFur(model.scene,surface);model.fur=fur;model.scene.add(...fur.meshes);applyCreatorDesign(model,design);
          fur.setDetail(1);const close=fur.meshes.filter(m=>m.userData.furRegion).map(m=>m.geometry.drawRange.count),stats=fur.stats();
          fur.setDetail(.25);const far=fur.meshes.filter(m=>m.userData.furRegion).map(m=>m.geometry.drawRange.count);
          function disposeSnapshots(meshes){const ownedMaterials=new Set();for(const mesh of meshes){mesh.geometry.dispose();if(mesh.userData.ownedFurExportMaterial)for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])ownedMaterials.add(material);}ownedMaterials.forEach(m=>m.dispose());}
          function strideFor(mesh){const stride=mesh.userData.strandVertices,segments=mesh.userData.strandSegments;if(!Number.isInteger(stride)||stride!==2*(segments+1)||mesh.geometry.attributes.position.count%stride!==0)throw new Error('Invalid fur strand layout');return stride;}
          const snapshots=fur.snapshotMeshes(),saved=snapshots.filter(m=>m.userData.furRegion).map(m=>m.geometry.index.count),topology=snapshots.filter(m=>m.userData.furRegion).map(m=>({region:m.userData.furRegion,stride:strideFor(m),segments:m.userData.strandSegments,indexStride:m.userData.strandIndices,strands:m.userData.strandCount,vertices:m.geometry.attributes.position.count,indices:m.geometry.index.count}));
          disposeSnapshots(snapshots);
          function roots(){const values=[];for(const mesh of fur.meshes.filter(m=>m.userData.furRegion)){const a=mesh.geometry.attributes.position,stride=strideFor(mesh);for(let strand=0;strand<Math.min(3,a.count/stride);strand++){const i=strand*stride;for(let k=0;k<3;k++)values.push((a.getComponent(i,k)+a.getComponent(i+1,k))/2);}}return values;}

          function rootDistance(samples){model.scene.updateMatrixWorld(true);const triangles=[],p=new THREE.Vector3();for(const mesh of model.meshes){if(mesh.isSkinnedMesh)mesh.skeleton.update();const a=mesh.geometry.attributes.position,index=mesh.geometry.index,points=[];for(let i=0;i<a.count;i++){mesh.getVertexPosition(i,p).applyMatrix4(mesh.matrixWorld);points.push(p.clone());}for(let i=0;i<(index?.count??a.count);i+=3)triangles.push(new THREE.Triangle(points[index?.getX(i)??i],points[index?.getX(i+1)??i+1],points[index?.getX(i+2)??i+2]));}const near=new THREE.Vector3();let max=0;const r=samples||roots();for(let i=0;i<r.length;i+=3){p.fromArray(r,i);let min=Infinity;for(const triangle of triangles)min=Math.min(min,triangle.closestPointToPoint(p,near).distanceTo(p));max=Math.max(max,min);}return max;}
          const before=roots(),motion=createCreatorMotion(model.scene,'norwegian');motion.setPose('rest',true);motion.update(1);fur.refresh();const restSnapshots=fur.snapshotMeshes(),lastRoots=[];for(const mesh of restSnapshots.filter(m=>m.userData.furRegion)){const a=mesh.geometry.attributes.position,stride=strideFor(mesh);for(const i of [a.count-stride,a.count-stride*2,a.count-stride*3])for(let k=0;k<3;k++)lastRoots.push((a.getComponent(i,k)+a.getComponent(i+1,k))/2);}const hiddenRootDistance=rootDistance(lastRoots);disposeSnapshots(restSnapshots);const rest=roots(),restRootDistance=rootDistance();motion.setBreathing(true);motion.update(.9);fur.refresh({full:true});const breathRootDistance=rootDistance();motion.dispose();fur.update({...design,shape:{...design.shape,headFurDensity:0}});const zeroHead=fur.snapshotMeshes(),earTuftsAtZero=zeroHead.some(m=>m.userData.groomDetail==='earTufts'),whiskersIndependent=zeroHead.some(m=>m.userData.groomDetail==='whiskers'&&m.geometry.attributes.position.count>0);disposeSnapshots(zeroHead);
          return{close,far,saved,stats,topology,rootMovement:difference(before,rest),restRootDistance,breathRootDistance,hiddenRootDistance,earTuftsAtZero,whiskersIndependent};
        }finally{model.dispose();}};
      window.__refinementExport=async(url)=>{const g=await new GLTFLoader().loadAsync(url);g.scene.updateMatrixWorld(true);const values=[],p=new THREE.Vector3();g.scene.traverse(m=>{if(!m.isMesh)return;if(m.isSkinnedMesh)m.skeleton.update();for(let i=0;i<m.geometry.attributes.position.count;i++){m.getVertexPosition(i,p).applyMatrix4(m.matrixWorld);values.push(p.x,p.y,p.z);}});return{bounds:bounds(values),clips:g.animations.length,finite:values.every(Number.isFinite)};};
    `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
  }).then((result) => result.outputFiles[0].text));
}

async function runner(page: import("@playwright/test").Page) {
  await page.route("**/__refinement-runner", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><body></body>",
    }),
  );
  await page.goto("http://localhost:3000/__refinement-runner");
  await page.addScriptTag({ content: await bundle() });
  await mkdir(ARTIFACTS, { recursive: true });
}

test("resting pose folds actual limbs, breathes without drift and returns exactly to standing", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await runner(page);
  const reports = [];
  for (const base of ["norwegian", "sphynx"]) {
    const result = await page.evaluate(
      (base) => (window as any).__refinementMotion(base),
      base,
    );
    reports.push(result);
    expect(result.finite).toBe(true);
    expect(result.pose.changed).toBeGreaterThan(1000);
    expect(result.pose.max).toBeGreaterThan(0.35);
    expect(result.rest.max[1]).toBeLessThan(result.stand.max[1] - 0.3);
    expect(result.rest.min[1]).toBeGreaterThan(-0.005);
    expect(result.transitionMin).toBeGreaterThan(-0.005);
    expect(result.transitionBackMin).toBeGreaterThan(-0.005);
    expect(result.breathMin).toBeGreaterThan(-0.005);
    expect(result.return.max).toBeLessThan(1e-5);
    expect(result.breath.max).toBeGreaterThan(1e-4);
    expect(result.reduced.max).toBeLessThan(1e-5);
    expect(result.quiet.max).toBeLessThan(1e-5);
  }
  await writeFile(`${ARTIFACTS}/motion.json`, JSON.stringify(reports, null, 2));
});

test("real eyelids cover unchanged eyes under neutral and combined face parameters", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await runner(page);
  const reports = [];
  for (const base of ["norwegian", "sphynx"]) {
    const result = await page.evaluate(
      (base) => (window as any).__refinementBlink(base),
      base,
    );
    reports.push(result);
    await writeFile(
      `${ARTIFACTS}/blink.json`,
      JSON.stringify(reports, null, 2),
    );
    expect(result.supportsBlink).toBe(true);
    for (const sample of result.cases) {
      expect(sample.open.length).toBeGreaterThanOrEqual(10);
      expect(
        sample.open.filter((x: any) => x.visible).length,
      ).toBeGreaterThanOrEqual(sample.open.length * 0.8);
      expect(sample.closed.filter((x: any) => x.visible)).toHaveLength(0);
      expect(sample.eyeShape.max).toBeLessThan(1e-6);
      expect(sample.finite).toBe(true);
    }
  }
  await writeFile(`${ARTIFACTS}/blink.json`, JSON.stringify(reports, null, 2));
});

test("preview detail reduces real hair triangles while export keeps the complete selected coat", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await runner(page);
  const result = await page.evaluate(() => (window as any).__refinementLod());
  expect(result.close).toHaveLength(3);
  expect(result.topology).toHaveLength(3);
  for (const region of result.topology) {
    expect(region.stride).toBe(18);
    expect(region.segments).toBe(8);
    expect(region.indexStride).toBe(96);
    expect(region.vertices).toBe(region.strands * region.stride);
    expect(region.indices).toBe(region.strands * region.indexStride);
  }
  for (let i = 0; i < 3; i++) {
    expect(result.close[i]).toBeGreaterThan(0);
    expect(result.far[i]).toBeLessThan(result.close[i] * 0.4);
    expect(result.saved[i]).toBe(result.close[i]);
  }
  expect(result.rootMovement.max).toBeGreaterThan(0.3);
  expect(result.restRootDistance).toBeLessThan(0.006);
  expect(result.hiddenRootDistance).toBeLessThan(0.006);
  expect(result.earTuftsAtZero).toBe(false);
  expect(result.whiskersIndependent).toBe(true);
  expect(result.breathRootDistance).toBeLessThan(0.006);
  await writeFile(`${ARTIFACTS}/lod.json`, JSON.stringify(result, null, 2));
});

test("room studio switches actual stand/rest views and exports the current static resting pose", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await mkdir(ARTIFACTS, { recursive: true });
  await page.goto("/studio/base");
  await expect(page.locator('[data-creator-ready="true"]')).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "短毛猫", exact: true }).click();
  await page.getByRole("button", { name: "毛发", exact: true }).click();
  await page
    .getByRole("button", { name: "附加毛层（实验）", exact: true })
    .click();
  await expect(
    page.locator('[data-creator-ready="true"][data-creator-coat-mode="groom"]'),
  ).toBeVisible({ timeout: 60_000 });
  for (const name of ["头部毛量", "胸颈毛量", "身体毛量"])
    await page.getByRole("slider", { name, exact: true }).press("Home");
  await page.getByRole("button", { name: "灰模", exact: true }).click();
  await page.getByRole("button", { name: "全身", exact: true }).click();
  const canvas = page.locator("canvas");
  const stand = await canvas.screenshot({
    path: `${ARTIFACTS}/ui-standing.png`,
  });
  await page.getByRole("button", { name: "趴卧", exact: true }).click();
  await page.waitForTimeout(1800);
  const rest = await canvas.screenshot({ path: `${ARTIFACTS}/ui-resting.png` });
  const a = await sharp(stand).ensureAlpha().raw().toBuffer(),
    b = await sharp(rest).ensureAlpha().raw().toBuffer();
  let pixels = 0;
  for (let i = 0; i < a.length; i += 4)
    if (
      Math.max(
        Math.abs(a[i] - b[i]),
        Math.abs(a[i + 1] - b[i + 1]),
        Math.abs(a[i + 2] - b[i + 2]),
      ) > 8
    )
      pixels++;
  expect(pixels).toBeGreaterThan(3000);
  const summary = page.locator("summary").filter({ hasText: "备份与导出" });
  await summary.click();
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出 3D 模型（GLB）", exact: true })
    .click();
  const download = await pending,
    path = info.outputPath("resting.glb");
  await download.saveAs(path);
  const bytes = await readFile(path);
  const server = createServer((request, response) => {
    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "model/gltf-binary",
    });
    response.end(bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing local probe");
  try {
    await page.addScriptTag({ content: await bundle() });
    const result = await page.evaluate(
      (url) => (window as any).__refinementExport(url),
      `http://127.0.0.1:${address.port}/resting.glb`,
    );
    expect(result.finite).toBe(true);
    expect(result.clips).toBe(0);
    expect(result.bounds.max[1]).toBeLessThan(2.3);
    expect(result.bounds.min[1]).toBeGreaterThan(-0.005);
    await writeFile(
      `${ARTIFACTS}/ui-resting-export.json`,
      JSON.stringify({ pixels, ...result }, null, 2),
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  const standingButton = page.getByRole("button", {
    name: "站立",
    exact: true,
  });
  await standingButton.focus();
  await standingButton.press("Enter");
  await page.waitForTimeout(1800);
  await expect(standingButton).toHaveAttribute("aria-pressed", "true");
  const returned = await sharp(await canvas.screenshot())
    .ensureAlpha()
    .raw()
    .toBuffer();
  let keyboardPixels = 0;
  for (let i = 0; i < returned.length; i += 4)
    if (
      Math.max(
        Math.abs(returned[i] - b[i]),
        Math.abs(returned[i + 1] - b[i + 1]),
        Math.abs(returned[i + 2] - b[i + 2]),
      ) > 8
    )
      keyboardPixels++;
  expect(keyboardPixels).toBeGreaterThan(3000);
});

test("phone touch can change the rendered pose and reach motion controls in both orientations", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await mkdir(ARTIFACTS, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("http://localhost:3000/studio/base");
    await expect(page.locator('[data-creator-ready="true"]')).toBeVisible({
      timeout: 60_000,
    });
    const canvas = page.locator("canvas");
    await canvas.scrollIntoViewIfNeeded();
    const stand = await canvas.screenshot();
    await page.getByRole("button", { name: "趴卧", exact: true }).tap();
    await page.waitForTimeout(250);
    const rest = await canvas.screenshot({
      path: `${ARTIFACTS}/phone-rest.png`,
    });
    const a = await sharp(stand).ensureAlpha().raw().toBuffer(),
      b = await sharp(rest).ensureAlpha().raw().toBuffer();
    let pixels = 0;
    for (let i = 0; i < a.length; i += 4)
      if (
        Math.max(
          Math.abs(a[i] - b[i]),
          Math.abs(a[i + 1] - b[i + 1]),
          Math.abs(a[i + 2] - b[i + 2]),
        ) > 8
      )
        pixels++;
    expect(pixels).toBeGreaterThan(500);
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      for (const name of ["站立", "趴卧", "呼吸与眨眼"]) {
        const button = page.getByRole("button", { name, exact: true });
        await button.scrollIntoViewIfNeeded();
        expect(
          await button.evaluate((node) => {
            const r = node.getBoundingClientRect(),
              p = document.elementFromPoint(
                r.x + r.width / 2,
                r.y + r.height / 2,
              );
            return p === node || node.contains(p);
          }),
        ).toBe(true);
      }
    }
    await page.getByRole("button", { name: "站立", exact: true }).tap();
    await expect(
      page.getByRole("button", { name: "站立", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "呼吸与眨眼", exact: true }).tap();
    await expect(
      page.getByRole("button", { name: "呼吸与眨眼", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await writeFile(
      `${ARTIFACTS}/phone-motion.json`,
      JSON.stringify(
        {
          touchRenderedPixelChange: pixels,
          portraitAndLandscapeControlsReachable: true,
          reducedMotion: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
  }
});
