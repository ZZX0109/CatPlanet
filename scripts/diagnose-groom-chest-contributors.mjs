/** Temporary layer masks inside a private browser, never persisted or shipped. */
import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { installNativeCoatInspection } from "../tests/fixtures/native-coat-inspection.mjs";

const kindsFile = process.argv.find(arg => arg.startsWith("--kinds="))?.slice(8);
const kinds = kindsFile ? Array.from(await readFile(kindsFile)) : null;
const kindMetadata = kindsFile ? JSON.parse(await readFile(kindsFile.replace(/\.u8$/, "-metadata.json"), "utf8")) : null;
const normalRatioArg = process.argv.find(arg => arg.startsWith("--undercoat-normal-ratio="));
const normalRatio = normalRatioArg ? Number(normalRatioArg.slice(25)) : null;
const skinShadow = process.argv.includes("--skin-shadow");
if (normalRatio !== null && (!Number.isFinite(normalRatio) || normalRatio < 0 || normalRatio > 6)) throw Error("Invalid relative normal strength");
const namedOutput = process.argv.find(arg => arg.startsWith("--output="))?.slice(9);
if (namedOutput && !/^[a-z0-9-]+$/.test(namedOutput)) throw Error("Use a named diagnostic phase");
const folder = namedOutput ? `artifacts/procedural-groom/${namedOutput}` : kinds ? "artifacts/procedural-groom/round2-chest-kinds" : "artifacts/procedural-groom/round2-chest-contributors";
await mkdir(folder, { recursive: true });
const baselinePath = process.argv.find(arg => arg.startsWith("--baseline="))?.slice(11) ?? "artifacts/procedural-groom/round2-ruff-long/capture-report.json";
const view = process.argv.find(arg => arg.startsWith("--view="))?.slice(7) ?? "chest";
const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const reference = baseline.frames.find(frame => frame.view === view)?.actual;
if (!reference) throw Error("Reference view missing");
const paths = ["lib/norwegian-fur.ts", "lib/cat-groom-guides.ts", "lib/cat-fur-material.ts", "lib/cat-coat-profiles.ts"];
const hashes = async () => Object.fromEntries(await Promise.all(paths.map(async file => [file, createHash("sha256").update(await readFile(file)).digest("hex")])));
const sources = await hashes(), frames = [], errors = [];
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
try {
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.addInitScript(design => localStorage.setItem("miaoxing.cat-creator.foundation.v1", JSON.stringify(design)), reference.design);
  await page.goto("http://localhost:3000/studio/base");
  await page.locator('[data-creator-ready="true"][data-creator-coat-mode="groom"]').waitFor({ timeout: 90000 });
  await page.evaluate(installNativeCoatInspection);
  // Creator-ready may precede the Object3D's actual R3F attachment by a frame.
  await page.evaluate(() => window.__nativeCoatCapture());
  await page.evaluate(({reference,kindMetadata}) => {
    const canvas = document.querySelector("canvas");
    let fiber = canvas[Object.keys(canvas).find(key => key.startsWith("__reactFiber"))];
    while (fiber && !fiber.memoizedProps?.model) fiber = fiber.return;
    const model = fiber.memoizedProps.model;
    const state = model.scene.__r3f.root.getState();
    state.camera.position.fromArray(reference.camera.position);
    state.controls.target.fromArray(reference.camera.target);
    state.camera.lookAt(state.controls.target); state.controls.update();
    state.camera.projectionMatrix.fromArray(reference.camera.projection);
    state.camera.projectionMatrixInverse.copy(state.camera.projectionMatrix).invert();
    const ruff = model.fur.meshes.find(mesh => mesh.userData.furRegion === 'ruff');
    if(kindMetadata){
      if(ruff.geometry.getAttribute('position').count!==kindMetadata.geometry.positionVertices||ruff.geometry.index.count!==kindMetadata.geometry.indexCount)throw Error('CPU kind map capacity/stride mismatch');
      for(const root of kindMetadata.firstThreeRoots){const p=ruff.geometry.getAttribute('position'),base=root.vertexBlockStart;
        for(let axis=0;axis<3;axis++)if(Math.abs((p.getComponent(base,axis)+p.getComponent(base+1,axis))*.5-root.t0Center[axis])>1e-6)throw Error('CPU/browser root order identity mismatch');}
    }
    window.__contributorProbe = { model, state, ruff, originalIndex:ruff.geometry.index, originalRange:{...ruff.geometry.drawRange}, original: model.fur.meshes.flatMap(mesh => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => ({ mesh, material, visible: material.visible, normalScale:material.normalScale?.clone(), receiveShadow:mesh.receiveShadow }))) };
    state.invalidate();
  }, {reference,kindMetadata});
  for (const mask of skinShadow ? ["full", "skin-shadow"] : normalRatio !== null ? ["full", "undercoat-normal"] : kinds ? ["full", "down-only", "outer-only"] : process.argv.includes("--only-undercoat") ? ["full", "undercoat"] : ["full", "head", "ruff", "body", "undercoat"]) {
    const hidden = await page.evaluate(({mask,kinds,kindMetadata,normalRatio}) => {
      const probe = window.__contributorProbe;
      const hidden = [];
      for (const item of probe.original) {
        const matches = mask === "undercoat" ? !!item.mesh.userData.undercoat : item.mesh.userData.furRegion === mask;
        item.material.visible = matches ? false : item.visible;
        item.mesh.receiveShadow = mask === "skin-shadow" && item.mesh.userData.furRegion
          ? true : item.receiveShadow;
        if (item.normalScale) {
          item.material.normalScale.copy(item.normalScale);
          if (mask === "undercoat-normal" && item.mesh.userData.undercoat)
            item.material.normalScale.multiplyScalar(normalRatio);
        }
        if (matches) hidden.push(item.mesh.name);
      }
      probe.ruff.geometry.setIndex(probe.originalIndex);
      probe.ruff.geometry.setDrawRange(probe.originalRange.start,probe.originalRange.count);
      if(kinds && mask!=='full'){
        const source=probe.originalIndex.array,stride=kindMetadata.strandIndices,count=kindMetadata.geometry.intendedStrands;
        const selected=[];for(let i=0;i<count;i++)if(mask==='down-only'?kinds[i]===0:kinds[i]!==0)selected.push(i);
        const indices=new Uint32Array(selected.length*stride);selected.forEach((root,j)=>indices.set(source.subarray(root*stride,(root+1)*stride),j*stride));
        probe.ruff.geometry.setIndex(new probe.originalIndex.constructor(indices,1));probe.ruff.geometry.setDrawRange(0,indices.length);
        hidden.push('Ruff index-mask '+mask+': selected '+selected.length+' original hairs');
      }
      probe.state.invalidate();
      return hidden;
    }, {mask,kinds,kindMetadata,normalRatio});
    const actual = await page.evaluate(() => window.__nativeCoatCapture());
    const undercoatMaterials = await page.evaluate(() => window.__contributorProbe.original.filter(item => item.mesh.userData.undercoat).map(item => ({name:item.material.name,normalScale:item.material.normalScale?.toArray(),originalNormalScale:item.normalScale?.toArray()})));
    const shadowState = skinShadow ? await page.evaluate(() => {
      const p=window.__contributorProbe, lights=[];
      p.state.scene.traverse(o => {if(o.isDirectionalLight)lights.push({castShadow:o.castShadow,mapPresent:!!o.shadow.map,intensity:o.intensity,matrix:o.shadow.matrix.toArray()});});
      return {meshes:p.original.filter(x=>x.mesh.userData.furRegion).map(x=>({name:x.mesh.name,receiveShadow:x.mesh.receiveShadow,castShadow:x.mesh.castShadow})),lights};
    }) : undefined;
    await page.locator("canvas").screenshot({ path: `${folder}/${mask === "full" || kinds || mask === "undercoat-normal" || mask === "skin-shadow" ? mask : `without-${mask}`}.png` });
    frames.push({ mask, hidden, actual, undercoatMaterials, shadowState });
    if (actual.context.error || actual.context.programs.some(program => !program.runnable)) throw Error("Diagnostic GPU failure");
  }
  await page.evaluate(() => { const p=window.__contributorProbe;for (const item of p.original) {item.material.visible = item.visible;item.mesh.receiveShadow=item.receiveShadow;if(item.normalScale)item.material.normalScale.copy(item.normalScale);}p.ruff.geometry.setIndex(p.originalIndex);p.ruff.geometry.setDrawRange(p.originalRange.start,p.originalRange.count);p.state.invalidate(); });
  const after = await hashes(), changed = paths.filter(file => after[file] !== sources[file]);
  await writeFile(`${folder}/report.json`, JSON.stringify({ status: "temporary visual layer attribution only; no default/user settings changed", sources, sourcesAfter: after, changed,kindMetadata, reference: `${baselinePath} ${view}`, frames, errors }, null, 2));
  if (changed.length || errors.length) throw Error("Diagnostic input changed or browser error");
  console.log(JSON.stringify({ folder, frames: frames.length, errors, changed }));
} finally { await browser.close(); }
