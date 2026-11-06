// Reproducible actual-WebGL fur review, plus isolated CPU geometry timings.
// Usage: node scripts/capture-coat-anatomy.mjs before|after|probe (CPU only)
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";

const phase = process.argv[2];
if (!["before", "after", "probe"].includes(phase))
  throw new Error("Choose before, after or probe as the first argument.");
const output = path.resolve("artifacts/coat-anatomy", phase);
if (phase === "before") {
  try {
    await access(path.join(output, "capture-report.json"));
    throw new Error("Preserve the existing anatomy baseline.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const origin = "http://localhost:3000";
process.env.NO_PROXY = "localhost,127.0.0.1,::1";
process.env.no_proxy = process.env.NO_PROXY;
await mkdir(output, { recursive: true });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceFiles = [
  "lib/norwegian-fur.ts",
  "lib/cat-coat-profiles.ts",
  "lib/cat-groom-details.ts",
  "lib/cat-creator-model.ts",
  "lib/cat-creator-motion.ts",
  "components/CatCreatorScene.tsx",
  "lib/cat-fur-flow.ts",
  "lib/cat-coat-anatomy.ts",
  "lib/cat-creator-design.ts",
  "components/CatCreator.tsx",
  "components/CatCreator.module.css",
];
const sources = {};
const missingSources = [];
for (const file of sourceFiles) {
  try {
    sources[file] = sha(await readFile(file));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    missingSources.push(file);
  }
}
const bundled = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "ts",
    contents: `
    import * as THREE from 'three';
    import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
    import {ownCreatorModel,applyCreatorDesign} from './lib/cat-creator-model';
    import {defaultCreatorDesign} from './lib/cat-creator-design';
    import {getCatCoatProfile} from './lib/cat-coat-profiles';
    import {createNorwegianFur} from './lib/norwegian-fur';
    const clock=()=>performance.now();
    window.__furFlowPerformance=async()=>{
      const loadStart=clock(),g=await new GLTFLoader().loadAsync('/models/creator/norwegian-cat.glb');
      const model=ownCreatorModel(g.scene,g.animations,'norwegian'),loadMs=clock()-loadStart;
      const surface=model.meshes.filter(m=>m.isSkinnedMesh).sort((a,b)=>b.geometry.attributes.position.count-a.geometry.attributes.position.count)[0];
      const start=clock(),fur=await createNorwegianFur(model.scene,surface),createMs=clock()-start;
      model.fur=fur;model.scene.add(...fur.meshes);
      const result={loadMs,createMs,profiles:[]};
      try {
        let tick=0;
        for(const coatType of ['short','long']){
          const design={...defaultCreatorDesign,coatType,shape:{...defaultCreatorDesign.shape,...getCatCoatProfile(coatType).defaults}};
          const applyStart=clock();applyCreatorDesign(model,design);const applyMs=clock()-applyStart;
          const rows=[];
          model.motion.setBreathing(true);
          for(const detail of [1,.25]){
            fur.setDetail(detail);
            for(const full of [false,true]){
              const times=[];
              for(let i=0;i<7;i++){
                tick+=.371;model.motion.update(tick);
                const t=clock();fur.refresh(full?{full:true}:{});const ms=clock()-t;
                if(i>=2)times.push(ms);
              }
              rows.push({detail,mode:full?'full':'visible-prefix',timesMs:times,medianMs:[...times].sort((a,b)=>a-b)[2]});
            }
          }
          model.motion.setBreathing(false);model.motion.setPose('rest',true);model.motion.update(++tick);
          fur.refresh();
          const s=clock(),snapshots=fur.snapshotMeshes(),snapshotMs=clock()-s;
          const snapshotTriangles=snapshots.reduce((sum,m)=>sum+(m.geometry.index?.count??m.geometry.attributes.position.count)/3,0);
          snapshots.forEach(m=>m.geometry.dispose());
          result.profiles.push({coatType,shape:design.shape,applyMs,stats:fur.stats(),rows,snapshotMs,snapshotTriangles});
          model.motion.setPose('stand',true);model.motion.update(++tick);
        }
        return result;
      } finally { model.dispose(); }
    };`,
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
});
const probeBundle = bundled.outputFiles[0].text;
await writeFile(path.join(output, "performance-probe.js"), probeBundle);
const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader"],
});
const errors = [],
  responses = [],
  shots = [],
  settings = [],
  sourceAudits = [];
try {
  const context = await browser.newContext();
  try {
    const manifest = JSON.parse(
      await readFile("public/models/creator/norwegian-manifest.json", "utf8"),
    );
    const response = await context.request.get(
      `${origin}/models/creator/norwegian-cat.glb`,
    );
    const bytes = await response.body(),
      digest = sha(bytes);
    sourceAudits.push({
      base: "norwegian",
      status: response.status(),
      contentEncoding: response.headers()["content-encoding"] ?? null,
      decodedBytes: bytes.length,
      sha256: digest,
      expectedSha256: manifest.outputSha256,
    });
    if (response.status() !== 200 || digest !== manifest.outputSha256)
      throw new Error("Model audit failed");
    const page = await context.newPage();
    page.on("pageerror", (e) =>
      errors.push({ profile: "performance", message: e.message }),
    );
    await page.route("**/__fur-flow-performance", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: "<!doctype html><body></body>",
      }),
    );
    await page.goto(`${origin}/__fur-flow-performance`);
    await page.addScriptTag({ content: probeBundle });
    const performance = await page.evaluate(() =>
      window.__furFlowPerformance(),
    );
    await writeFile(
      path.join(output, "performance.json"),
      JSON.stringify(
        {
          phase,
          capturedAt: new Date().toISOString(),
          method:
            "Single isolated Chromium context; CPU geometry only, no renderer. Seven alternating breath poses per mode, discard first two, median remaining five. Does not measure device FPS.",
          probeSha256: sha(probeBundle),
          sources,
          ...performance,
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
  }
  for (const profile of phase === "probe"
    ? []
    : [
        { id: "short", label: "短毛猫" },
        { id: "long", label: "长毛猫" },
        { id: "long-max", label: "长毛猫" },
      ]) {
    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (e) =>
      errors.push({ profile: profile.id, message: e.message }),
    );
    page.on("response", (r) => {
      if (/\/models\/creator\/norwegian-cat\.glb(?:\?|$)/.test(r.url()))
        responses.push({
          profile: profile.id,
          url: r.url(),
          status: r.status(),
          contentEncoding: r.headers()["content-encoding"] ?? null,
        });
    });
    try {
      await page.goto(`${origin}/studio/base`);
      await page
        .locator('[data-creator-ready="true"]')
        .waitFor({ timeout: 90000 });
      const button = (name) => page.getByRole("button", { name, exact: true });
      const preview = page.getByRole("region", {
        name: "结构猫头三维预览",
        exact: true,
      });
      const coat = profile.id.startsWith("long") ? "long" : "short";
      const ready = page.locator(
        `[data-creator-ready="true"][data-creator-coat="${coat}"][data-creator-base="norwegian"]`,
      );
      const settle = async () => {
        await ready.waitFor({ timeout: 90000 });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((r) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            ),
          );
        });
      };
      const capture = async (name, fullUi = false) => {
        await page.evaluate(() => scrollTo(0, 0));
        await settle();
        const filename = `${profile.id}-${name}.png`;
        if (fullUi)
          await page.screenshot({
            path: path.join(output, filename),
            fullPage: true,
          });
        else
          await page
            .locator("canvas")
            .screenshot({ path: path.join(output, filename) });
        shots.push(filename);
      };
      await button(profile.label).click();
      await settle();
      await button("自然脸").click();
      await button("材质预览").click();
      const values = {};
      for (const part of ["头型", "眼睛", "鼻口", "耳朵", "毛发"]) {
        await button(part).click();
        if (profile.id === "long-max" && part === "毛发") {
          for (const name of ["头部毛长", "胸颈毛长", "身体毛长"]) {
            await page.getByRole("slider", { name, exact: true }).press("End");
            await settle();
          }
        }
        for (const slider of await page
          .locator('input[id^="creator-"]')
          .all()) {
          const key = (await slider.getAttribute("id")).replace("creator-", "");
          values[key] = Number(await slider.inputValue());
        }
      }
      for (const [key, value] of Object.entries(values))
        if (
          !key.includes("Fur") &&
          value !== (["headRound", "headWedge"].includes(key) ? 0 : 50)
        )
          throw new Error(`Non-neutral face ${profile.id}.${key}`);
      if ((await button("呼吸与眨眼").getAttribute("aria-pressed")) !== "false")
        throw new Error("Motion must be off");
      settings.push({
        profile: profile.id,
        coat,
        shape: values,
        headView: "三分之四",
        wholeView: "全身 then ArrowRight ×3 then - ×1",
        poseTransition: "reduced-motion immediate",
        automaticMotion: false,
      });
      await button("头型").click();
      await button("三分之四").click();
      await capture("head-three");
      const whole = async () => {
        await button("全身").click();
        await settle();
        await preview.focus();
        for (let i = 0; i < 3; i++) {
          await preview.press("ArrowRight");
          await settle();
        }
        await preview.press("-");
        await settle();
      };
      await whole();
      await capture("whole-three");
      await button("趴卧").click();
      await settle();
      await whole();
      await capture("rest-three");
      if (profile.id === "long") await capture("rest-ui", true);
    } finally {
      await context.close();
    }
  }
  const changedSources = [];
  for (const [file, digest] of Object.entries(sources))
    if (sha(await readFile(file)) !== digest) changedSources.push(file);
  for (const file of missingSources) {
    try {
      await access(file);
      changedSources.push(file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const report = {
    phase,
    missingSources,
    capturedAt: new Date().toISOString(),
    renderer: "Actual localhost studio WebGL, unedited canvas images",
    sources,
    unchangedSourcesThroughoutCapture: changedSources.length === 0,
    changedSources,
    probeSha256: sha(probeBundle),
    freshContexts: true,
    storagePreloaded: false,
    reducedMotion: true,
    viewport: { width: 1365, height: 900, deviceScaleFactor: 1 },
    settings,
    decodedHttpModels: sourceAudits,
    modelResponses: responses,
    screenshots: shots,
    errors,
  };
  await writeFile(
    path.join(output, "capture-report.json"),
    JSON.stringify(report, null, 2),
  );
  if (errors.length) throw new Error(errors.map((x) => x.message).join("\n"));
  if (changedSources.length)
    throw new Error(
      `Sources changed while capturing: ${changedSources.join(", ")}`,
    );
  if (
    phase !== "probe" &&
    (responses.length !== 3 || responses.some((r) => r.status !== 200))
  )
    throw new Error("Missing actual page model responses");
  console.log(
    JSON.stringify({ output, screenshots: shots, errors, sourceAudits }),
  );
} finally {
  await browser.close();
}
