import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { installNativeCoatInspection } from "../tests/fixtures/native-coat-inspection.mjs";

const phase = process.argv[2] ?? "round01";
if (!/^[a-z0-9-]+$/.test(phase)) throw Error("Invalid phase");
const output = path.resolve("artifacts/native-coat-optics", phase);
await mkdir(output, { recursive: true });
const sha = (b) => createHash("sha256").update(b).digest("hex");
const sourcePaths = ["lib/cat-native-coat-optics.ts", "lib/cat-native-coat-moments.ts", "public/models/creator/norwegian-cat.glb", "lib/cat-native-coat.ts", "components/CatCreatorScene.tsx"];
const hashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async (p) => [p, sha(await readFile(p))])));
const before = await hashes();
const field = await readFile("artifacts/native-coat-flow/blender_uv_ready.bin");
const bundled = await build({
  stdin: { contents: `import {createNativeCoatOpticsStudy} from './lib/cat-native-coat-optics';import {buildNativeCoatMomentMips} from './lib/cat-native-coat-moments';window.__surfaceApi={createNativeCoatOpticsStudy,buildNativeCoatMomentMips};`, resolveDir: process.cwd() },
  bundle: true, write: false, platform: "browser", format: "iife", target: "es2022",
});
await writeFile(path.join(output, "study.browser.js"), bundled.outputFiles[0].contents);
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const errors = [], frames = [];
const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, reducedMotion: "reduce", deviceScaleFactor: 1 });
const page = await context.newPage();
page.on("pageerror", (e) => errors.push({ type: "page", text: e.message }));
page.on("console", (m) => { if (m.type() === "error") errors.push({ type: "console", text: m.text() }); });
await page.route("**/__native-coat-line-field.bin", (route) => route.fulfill({ status: 200, contentType: "application/octet-stream", body: field }));
const variants = process.argv.includes("--form-diagnostic") ? [
  ["source", null],
  ["no-normal", { anisotropy: 0, sheen: 0, sheenRoughness: .85, roughnessAxis: "across", normalStrength: 0 }],
  ["flat-form", { anisotropy: 0, sheen: 0, sheenRoughness: .85, roughnessAxis: "across", normalStrength: 0, flatAlbedo: true }],
] : process.argv.includes("--normal-diagnostic") ? [
  ["source", null],
  ["physical-zero", { anisotropy: 0, sheen: 0, sheenRoughness: .85, roughnessAxis: "across" }],
  ["no-normal", { anisotropy: 0, sheen: 0, sheenRoughness: .85, roughnessAxis: "across", normalStrength: 0 }],
  ["half-normal", { anisotropy: 0, sheen: 0, sheenRoughness: .85, roughnessAxis: "across", normalStrength: .5 }],
] : [
  ["source", null],
  ["physical-zero", { anisotropy: 0, sheen: 0, sheenRoughness: .85, roughnessAxis: "across" }],
  ["anisotropy-across", { anisotropy: .45, sheen: 0, sheenRoughness: .85, roughnessAxis: "across" }],
  ["anisotropy-along", { anisotropy: .45, sheen: 0, sheenRoughness: .85, roughnessAxis: "along" }],
  ["sheen-only", { anisotropy: 0, sheen: .06, sheenRoughness: .85, roughnessAxis: "across" }],
  ["combined-across", { anisotropy: .45, sheen: .06, sheenRoughness: .85, roughnessAxis: "across" }],
  ["confidence", { anisotropy: .45, sheen: .06, sheenRoughness: .85, roughnessAxis: "across", diagnostic: true }],
];
const button = (name) => page.getByRole("button", { name, exact: true });
async function settle() {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))); });
}
async function view(name) {
  if (name === "head") await button("三分之四").click();
  else {
    await button("全身").click();
    await page.evaluate(() => {
      const { model } = window.__nativeStudy;
      const state = model.scene.__r3f.root.getState(), c = state.camera, t = state.controls.target;
      const r = c.position.clone().sub(t).length();
      c.position.set(t.x + r, t.y, t.z);
      c.lookAt(t); state.controls.update(); state.invalidate();
    });
  }
  await settle();
}
try {
  await page.goto("http://localhost:3000/studio/base");
  await page.locator('[data-creator-ready="true"][data-creator-coat-mode="source"]').waitFor({ timeout: 90000 });
  await page.evaluate(installNativeCoatInspection);
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  await page.evaluate(async () => {
    const canvas = document.querySelector("canvas");
    let f = canvas[Object.keys(canvas).find((k) => k.startsWith("__reactFiber"))];
    while (f && !f.memoizedProps?.model) f = f.return;
    const { model } = f.memoizedProps;
    while (!model.scene.__r3f?.root) await new Promise((r) => requestAnimationFrame(r));
    const data = new Float32Array(await (await fetch('/__native-coat-line-field.bin')).arrayBuffer());
    const { levels } = window.__surfaceApi.buildNativeCoatMomentMips({ data, width: 256, height: 256 });
    window.__nativeStudy = { model, levels, originals: new Map(model.materials), resource: null, sourceDispose: 0, replacementDispose: 0 };
    const watched = new Set();
    for (const m of model.materials.values()) for (const mat of Array.isArray(m) ? m : [m]) {
      for (const item of [mat, ...Object.values(mat).filter((v) => v?.isTexture)]) {
        if (watched.has(item)) continue; watched.add(item);
        item.addEventListener('dispose', () => window.__nativeStudy.sourceDispose++);
      }
    }
  });
  for (const [variant, settings] of variants) {
    await page.evaluate((settings) => {
      const s = window.__nativeStudy;
      if (s.resource) { s.resource.dispose(); s.resource = null; }
      if (settings) {
        s.resource = window.__surfaceApi.createNativeCoatOpticsStudy(s.model, s.levels, settings);
        for (const m of s.resource.materials) m.addEventListener('dispose', () => s.replacementDispose++);
      }
      s.model.scene.__r3f.root.getState().invalidate();
    }, settings);
    for (const shot of ["head", "side"]) {
      await view(shot);
      const actual = await page.evaluate(() => window.__nativeCoatCapture());
      const optics = await page.evaluate(() => {
        const s = window.__nativeStudy;
        const renderer = s.model.scene.__r3f.root.getState().gl, gl = renderer.getContext();
        const uniform = (m, name) => {
          const program = renderer.properties.get(m).currentProgram?.program;
          if (!program) return null;
          const location = gl.getUniformLocation(program, name);
          const value = location ? gl.getUniform(program, location) : null;
          return ArrayBuffer.isView(value) ? Array.from(value) : value;
        };
        return { materials: s.resource?.materials.map((m) => ({ name: m.name, uuid: m.uuid, settings: m.userData.nativeCoatOpticsStudy, normalScale: m.normalScale.toArray(), gpuNormalScale: uniform(m, "normalScale"), gpuDiffuse: uniform(m, "diffuse"), mapPresent: !!m.map, roughness: m.roughness, metalness: m.metalness, sheen: m.sheen, anisotropy: m.anisotropy, defines: m.defines })) ?? [], sourceDispose: s.sourceDispose, mipLevels: s.resource?.texture.mipmaps.length ?? 0 };
      });
      if (actual.preparedGroom !== false || Object.values(actual.stats).some((v) => v.capacity || v.strands) || actual.context.error || actual.context.programs.some((p) => !p.runnable) || optics.sourceDispose) throw Error("Actual surface study resource or shader failure");
      if (settings && optics.materials.length !== 1) throw Error("Study did not replace exactly the native body material");
      const file = `${variant}-${shot}.png`;
      await page.locator("canvas").screenshot({ path: path.join(output, file) });
      frames.push({ file, variant, shot, settings, actual, optics });
      console.log(JSON.stringify({ captured: file }));
      if (errors.length) throw Error(errors.at(-1).text);
    }
  }
  const cleanup = await page.evaluate(() => {
    const s = window.__nativeStudy; s.resource?.dispose(); s.resource?.dispose();
    return { sourceDispose: s.sourceDispose, replacementDispose: s.replacementDispose, registryRestored: [...s.originals].every(([mesh, mat]) => s.model.materials.get(mesh) === mat && mesh.material === mat) };
  });
  if (cleanup.sourceDispose || !cleanup.registryRestored) throw Error("Study disposal failed ownership check");
  const after = await hashes();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw Error("Study inputs changed during capture");
  await writeFile(path.join(output, "capture-report.json"), JSON.stringify({ phase, status: "experimental actual webpage comparison, not adopted", fieldSHA256: sha(field), before, after, frames, cleanup, errors }, null, 2));
  console.log(JSON.stringify({ output, frames: frames.length, cleanup, errors }));
} catch (error) {
  await writeFile(path.join(output, "failure-report.json"), JSON.stringify({ phase, error: error.stack, frames, errors, before, after: await hashes() }, null, 2));
  throw error;
} finally { await context.close(); await browser.close(); }
