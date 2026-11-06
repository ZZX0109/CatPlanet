import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const output = "artifacts/face-preset-refinement/verification";
const storageKey = "miaoxing.cat-creator.foundation.v1";
let compiled: Promise<string> | undefined;
const bundle = () =>
  (compiled ??= build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "ts",
      contents: `
    import * as THREE from 'three';
    import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
    import {ownCreatorModel,applyCreatorDesign} from './lib/cat-creator-model';
    import {creatorPresets} from './lib/cat-creator-design';
    const eyeRole=m=>(Array.isArray(m.material)?m.material:[m.material]).some(m=>m.userData.creatorRole==='eye-globe'||/EyeOptics/.test(m.name));
    function vertices(model){model.scene.updateMatrixWorld(true);const inverse=model.scene.matrixWorld.clone().invert();return model.meshes.map(mesh=>{if(mesh.isSkinnedMesh)mesh.skeleton.update();const mat=inverse.clone().multiply(mesh.matrixWorld),result=[],p=new THREE.Vector3();for(let i=0;i<mesh.geometry.attributes.position.count;i++)result.push(mesh.getVertexPosition(i,p).applyMatrix4(mat).clone());return result;});}
    function eyes(model){const result=[],ray=new THREE.Raycaster(),p=new THREE.Vector3();model.scene.updateMatrixWorld(true);
      for(const mesh of model.meshes.filter(eyeRole)){if(mesh.isSkinnedMesh)mesh.skeleton.update();const box=new THREE.Box3();for(let i=0;i<mesh.geometry.attributes.position.count;i++)box.expandByPoint(mesh.getVertexPosition(i,p).applyMatrix4(mesh.matrixWorld));const size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
        for(const [x,y]of [[0,0],[-.12,0],[.12,0],[0,-.12],[0,.12]]){ray.set(center.clone().add(new THREE.Vector3(size.x*x,size.y*y,2)),new THREE.Vector3(0,0,-1));const hit=ray.intersectObjects(model.meshes,false)[0];const m=hit?(Array.isArray(hit.object.material)?hit.object.material[hit.face.materialIndex||0]:hit.object.material):null;result.push(!!m&&(m.userData.creatorRole==='eye-globe'||/EyeOptics/.test(m.name)));}}
      return result;}
    window.__facePresets=async(base)=>{const g=await new GLTFLoader().loadAsync('/models/creator/'+base+'-cat.glb'),model=ownCreatorModel(g.scene,g.animations,base);
      try {const natural=creatorPresets.find(p=>p.id==='natural').design;applyCreatorDesign(model,natural);const reference=vertices(model),uv=model.meshes.map(m=>Array.from(m.geometry.attributes.uv.array));
        const [a,b]=model.landmarks.eyeCenters,cx=(a[0]+b[0])/2,ey=(a[1]+b[1])/2,ez=(a[2]+b[2])/2,mz=model.landmarks.muzzleCenter[1],span=Math.abs(a[0]-b[0]);
        const masks={cheek:[],jaw:[],muzzle:[],head:[],body:[]};
        reference.forEach((points,mi)=>points.forEach((p,i)=>{if(p.y<model.wholeBounds.max.y*.35)masks.body.push([mi,i]);if(p.y>model.bounds.min.y&&p.z>model.bounds.min.z)masks.head.push([mi,i]);if(eyeRole(model.meshes[mi]))return;
          if(p.y>mz-.035&&p.y<ey+.025&&p.z>ez-.35)masks.cheek.push([mi,i]);
          if(p.y>model.bounds.min.y+.025&&p.y<mz+.015&&p.z>ez-.25)masks.jaw.push([mi,i]);
          if(Math.abs(p.x-cx)<span*.34&&Math.abs(p.y-mz)<.075&&p.z>ez+.025)masks.muzzle.push([mi,i]);}));
        const rows=[];const delta=(points,mask)=>{let sum=0,max=0;for(const [m,i]of mask){const d=points[m][i].distanceTo(reference[m][i]);sum+=d*d;max=Math.max(max,d);}return{rms:Math.sqrt(sum/Math.max(1,mask.length)),max};};
        const oldPresets=[{id:'old-round',design:{...natural,shape:{...natural.shape,headRound:100}}},{id:'old-wedge',design:{...natural,shape:{...natural.shape,headWedge:100}}}];
        for(const preset of [...creatorPresets,...oldPresets]){const design={...preset.design,coatType:base==='sphynx'?'hairless':'short'};applyCreatorDesign(model,design,0);const points=vertices(model);
          const width=name=>{const xs=masks[name].map(([m,i])=>points[m][i].x);return Math.max(...xs)-Math.min(...xs);};const front=masks.muzzle.map(([m,i])=>points[m][i].z).sort((a,b)=>a-b);
          const open=eyes(model);applyCreatorDesign(model,design,1);const closed=eyes(model);applyCreatorDesign(model,design,0);
          let inverted=0;const oldNormal=new THREE.Vector3(),newNormal=new THREE.Vector3(),e1=new THREE.Vector3(),e2=new THREE.Vector3();
          model.meshes.forEach((mesh,mi)=>{if(eyeRole(mesh))return;const index=mesh.geometry.index;for(let k=0;k<(index?.count??points[mi].length);k+=3){const ids=[index?.getX(k)??k,index?.getX(k+1)??k+1,index?.getX(k+2)??k+2];const old=ids.map(i=>reference[mi][i]),next=ids.map(i=>points[mi][i]);oldNormal.crossVectors(e1.subVectors(old[1],old[0]),e2.subVectors(old[2],old[0]));newNormal.crossVectors(e1.subVectors(next[1],next[0]),e2.subVectors(next[2],next[0]));if(oldNormal.lengthSq()>1e-16&&newNormal.lengthSq()>1e-16&&oldNormal.dot(newNormal)<0)inverted++;}});
          rows.push({id:preset.id,cheekWidth:width('cheek'),jawWidth:width('jaw'),muzzleFront:front[Math.floor((front.length-1)*.95)],headChange:delta(points,masks.head),bodyChange:delta(points,masks.body),open,closed,inverted,finite:points.every(ps=>ps.every(p=>Number.isFinite(p.x+p.y+p.z))),uvUnchanged:model.meshes.every((m,i)=>m.geometry.attributes.uv.array.every((n,k)=>n===uv[i][k]))});
        }
        applyCreatorDesign(model,natural);const reset=delta(vertices(model),masks.head);
        return{base,rows,reset,masks:Object.fromEntries(Object.entries(masks).map(([k,v])=>[k,v.length])),neutralHeadDepth:model.bounds.max.z-model.bounds.min.z};
      }finally{model.dispose();}};
  `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
  }).then((r) => r.outputFiles[0].text));

async function runner(page: Page) {
  await page.route("**/__face-presets", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<!doctype html><body></body>",
    }),
  );
  await page.goto("http://localhost:3000/__face-presets");
  await page.addScriptTag({ content: await bundle() });
  await mkdir(output, { recursive: true });
}

test("face presets create distinct real cheek and profile shapes while preserving lids and body", async ({
  page,
}) => {
  test.setTimeout(120000);
  await runner(page);
  const reports = [];
  for (const base of ["norwegian", "sphynx"])
    reports.push(
      await page.evaluate((base) => (window as any).__facePresets(base), base),
    );
  await writeFile(`${output}/geometry.json`, JSON.stringify(reports, null, 2));
  for (const report of reports) {
    const round = report.rows.find((r: any) => r.id === "round"),
      neutral = report.rows.find((r: any) => r.id === "natural"),
      wedge = report.rows.find((r: any) => r.id === "wedge");
    const oldRound = report.rows.find((r: any) => r.id === "old-round"),
      oldWedge = report.rows.find((r: any) => r.id === "old-wedge");
    expect(report.masks.cheek).toBeGreaterThan(50);
    expect(report.masks.muzzle).toBeGreaterThan(5);
    expect(round.cheekWidth).toBeGreaterThan(neutral.cheekWidth * 1.035);
    expect(wedge.cheekWidth).toBeLessThan(neutral.cheekWidth * 0.965);
    // Require an observable improvement over the former single-target presets,
    // measured from the same fixed anatomical vertex sets in both base cats.
    expect(round.cheekWidth - wedge.cheekWidth).toBeGreaterThan(
      neutral.cheekWidth * 0.08,
    );
    expect(round.cheekWidth - wedge.cheekWidth).toBeGreaterThan(
      (oldRound.cheekWidth - oldWedge.cheekWidth) * 1.6,
    );
    expect(wedge.muzzleFront - round.muzzleFront).toBeGreaterThan(
      (oldWedge.muzzleFront - oldRound.muzzleFront) * 1.6,
    );
    expect(wedge.muzzleFront - round.muzzleFront).toBeGreaterThan(
      report.neutralHeadDepth * 0.025,
    );
    expect(round.headChange.rms).toBeGreaterThan(0.01);
    expect(wedge.headChange.rms).toBeGreaterThan(0.01);
    expect(neutral.headChange.max).toBeLessThan(1e-6);
    expect(report.reset.max).toBeLessThan(1e-6);
    for (const row of report.rows) {
      expect(row.finite, row.id).toBe(true);
      expect(row.uvUnchanged, row.id).toBe(true);
      expect(row.bodyChange.max, row.id).toBeLessThan(1e-6);
      expect(row.inverted, row.id).toBe(0);
      expect(row.open.filter(Boolean).length, row.id).toBeGreaterThanOrEqual(8);
      expect(row.closed.filter(Boolean).length, row.id).toBe(0);
    }
  }
});

async function pixelDifference(a: Buffer, b: Buffer) {
  const x = await sharp(a).ensureAlpha().raw().toBuffer(),
    y = await sharp(b).ensureAlpha().raw().toBuffer();
  expect(x.length).toBe(y.length);
  let changed = 0;
  for (let i = 0; i < x.length; i += 4)
    if (
      Math.abs(x[i] - y[i]) +
        Math.abs(x[i + 1] - y[i + 1]) +
        Math.abs(x[i + 2] - y[i + 2]) >
      40
    )
      changed++;
  return changed;
}

test("phone presets visibly change the face, focus the head, and preserve coat, undo and JSON", async ({
  browser,
}, info) => {
  test.setTimeout(120000);
  await mkdir(output, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const preset = (name: string) =>
    page.getByRole("button", { name: new RegExp(`^${name}`) });
  const settle = async () => {
    await page.waitForTimeout(220);
    await page.evaluate(
      () =>
        new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
    );
  };
  try {
    await page.goto("http://localhost:3000/studio/base");
    await page
      .locator('[data-creator-ready="true"]')
      .waitFor({ timeout: 90000 });
    await button("短毛猫").tap();
    await button("毛发").tap();
    await button("附加毛层（实验）").tap();
    await page
      .locator('[data-creator-ready="true"][data-creator-coat-mode="groom"]')
      .waitFor({ timeout: 90000 });
    for (const [name, key] of [
      ["头部毛长", "End"],
      ["身体毛量", "Home"],
    ] as const) {
      const slider = page.getByRole("slider", { name, exact: true });
      await slider.press(key);
    }
    await button("头型").tap();
    await button("全身").tap();
    await settle();
    const whole = await page.locator("canvas").screenshot();
    await preset("圆润脸").tap();
    await expect(button("正面")).toHaveAttribute("aria-pressed", "true");
    await settle();
    const round = await page
      .locator("canvas")
      .screenshot({ path: `${output}/phone-round.png` });
    await button("侧面").tap();
    await preset("自然脸").tap();
    await expect(button("侧面")).toHaveAttribute("aria-pressed", "true");
    await button("正面").tap();
    await settle();
    const natural = await page
      .locator("canvas")
      .screenshot({ path: `${output}/phone-natural.png` });
    await preset("楔形脸").tap();
    await settle();
    const wedge = await page
      .locator("canvas")
      .screenshot({ path: `${output}/phone-wedge.png` });
    const pixels = {
      wholeToHead: await pixelDifference(whole, round),
      roundToNatural: await pixelDifference(round, natural),
      roundToWedge: await pixelDifference(round, wedge),
    };
    expect(pixels.wholeToHead).toBeGreaterThan(5000);
    expect(pixels.roundToNatural).toBeGreaterThan(400);
    expect(pixels.roundToWedge).toBeGreaterThan(800);
    await button("撤销").tap();
    await expect(preset("自然脸")).toHaveAttribute("aria-pressed", "true");
    await button("重做").tap();
    await expect(preset("楔形脸")).toHaveAttribute("aria-pressed", "true");
    await button("保存外观").tap();
    const saved = await page.evaluate(
      (key) => localStorage.getItem(key),
      storageKey,
    );
    expect(saved).not.toBeNull();
    const design = JSON.parse(saved!);
    expect(design.coatType).toBe("short");
    expect(design.coatMode).toBe("groom");
    expect(design.shape).toMatchObject({
      headFurLength: 100,
      bodyFurDensity: 0,
      headWedge: 100,
      headRound: 0,
    });
    await page.getByText("备份与导出", { exact: true }).tap();
    const waiting = page.waitForEvent("download");
    await button("导出外观 JSON").tap();
    const download = await waiting,
      path = info.outputPath("preset.json");
    await download.saveAs(path);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(design);
    await preset("圆润脸").tap();
    await page.getByLabel("导入外观 JSON", { exact: true }).setInputFiles({
      name: "preset.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(design)),
    });
    await expect(preset("楔形脸")).toHaveAttribute("aria-pressed", "true");
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await settle();
      const layout = await page.evaluate(() => ({
        viewport: innerWidth,
        width: document.documentElement.scrollWidth,
      }));
      expect(layout.width).toBeLessThanOrEqual(layout.viewport);
      for (const name of ["圆润脸", "自然脸", "楔形脸"]) {
        const box = await preset(name).boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    }
    await page.screenshot({
      path: `${output}/phone-320-ui.png`,
      fullPage: true,
    });
    await writeFile(
      `${output}/phone.json`,
      JSON.stringify({ pixels, saved: design, errors }, null, 2),
    );
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
