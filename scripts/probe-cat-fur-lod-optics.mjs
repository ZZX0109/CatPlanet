/**
 * Production MRT optical LOD fixture. GPU runs only when explicitly invoked.
 * node scripts/probe-cat-fur-lod-optics.mjs --build-only
 * node scripts/probe-cat-fur-lod-optics.mjs --output=artifacts/procedural-groom/round5-lod-optics-gpu
 * No dev server, model files, studio state, or screenshots are required.
 */
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const args = process.argv.slice(2);
for (const arg of args)
  if (!arg.startsWith("--output=") && !arg.startsWith("--channel=") && !arg.startsWith("--archived-material=")
    && !["--build-only", "--headful"].includes(arg)) throw Error(`Unknown option: ${arg}`);
const output = path.resolve(args.find(a => a.startsWith("--output="))?.slice(9)
  ?? "artifacts/procedural-groom/round5-lod-optics-gpu");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const archivedMaterial = args.find(a => a.startsWith("--archived-material="))?.slice(20);
const activeMaterialPath = archivedMaterial ?? "lib/cat-fur-material.ts";
const activeMaterial = await readFile(activeMaterialPath, "utf8");
if (!activeMaterial.includes("catFurOpticalLodScale"))
  throw Error("Optical LOD is not enabled in the production material. Use --archived-material=artifacts/procedural-groom/round5-source/cat-fur-material.ts.optical-pilot to reproduce the rejected pilot.");
const paths = [...new Set(["tests/fixtures/fur-lod-optics.mjs", "lib/cat-fur-material.ts", activeMaterialPath])];
const sources = Object.fromEntries(await Promise.all(paths.map(async p => [p, sha(await readFile(p))])));
const bundle = await build({
  stdin: { resolveDir: process.cwd(), contents:
    "import{runFurLodOpticsFixture}from'./tests/fixtures/fur-lod-optics.mjs';window.runFurLodOpticsFixture=runFurLodOpticsFixture;" },
  bundle: true, platform: "browser", format: "iife", target: "es2022", write: false,
  plugins: archivedMaterial ? [{name:"archived-optical-material",setup(build) {
    build.onLoad({filter:/[/\\]lib[/\\]cat-fur-material\.ts$/}, async ({path:sourcePath}) => ({contents:activeMaterial,loader:"ts",resolveDir:path.dirname(sourcePath)}));
  }}] : [],
});
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "probe.browser.js"), bundle.outputFiles[0].contents);
const provenance = { sources, bundleSHA256: sha(bundle.outputFiles[0].contents),
  activeMaterial: {path:activeMaterialPath,SHA256:sha(Buffer.from(activeMaterial)),archived:!!archivedMaterial},
  runnerSHA256: sha(await readFile("scripts/probe-cat-fur-lod-optics.mjs")) };
await writeFile(path.join(output, "prepared.json"), JSON.stringify({
  status: "CPU-bundled-only-no-GPU-measurement-yet", preparedAtUTC: new Date().toISOString(),
  ...provenance, expectedMRTFrames: 14, expectedNonzeroMRTFrames: 12,
  instruction: "Run this script without --build-only after the production opticalLodCompensation API is ready and the shared GPU is free. It rebuilds from current source and does not reuse this bundle silently.",
}, null, 2) + "\n");
if (args.includes("--build-only")) {
  console.log(JSON.stringify({ prepared: true, gpuStarted: false, output, ...provenance }));
  process.exit(0);
}

const channel = args.find(a => a.startsWith("--channel="))?.slice(10);
const browser = await chromium.launch({
  headless: !args.includes("--headful"), ...(channel ? { channel } : {}),
  args: ["--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
const startedAtUTC = new Date().toISOString(), started = Date.now();
try {
  await page.setContent("<!doctype html><meta charset=utf-8><style>body{margin:0}canvas{display:block}</style>");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() => window.runFurLodOpticsFixture({ includeRaw: true }));
  await mkdir(path.join(output, "raw"), { recursive: true });
  for (const row of result.rows) {
    row.readbackFiles = [];
    for (let attachment = 0; attachment < row.rawHalfBase64.length; attachment++) {
      const bytes = Buffer.from(row.rawHalfBase64[attachment], "base64");
      const file = `raw/${row.id}-attachment${attachment}.rgba16f.bin`;
      await writeFile(path.join(output, file), bytes);
      row.readbackFiles.push({ attachment, file, bytes: bytes.length, SHA256: sha(bytes),
        shape: [256, 256, 4], scalar: `IEEE754 binary16 ${result.readbackByteOrder}`,
        origin: "WebGL readPixels lower-left; no image color transform" });
    }
    delete row.rawHalfBase64;
  }
  const after = Object.fromEntries(await Promise.all(paths.map(async p => [p, sha(await readFile(p))])));
  const sourcesUnchanged = JSON.stringify(sources) === JSON.stringify(after);
  const numericSanityPass = result.structuralChecksPass && !errors.length && sourcesUnchanged;
  const report = { ...result, ...provenance, sourcesAfter: after, sourcesUnchanged,
    browserVersion: browser.version(), startedAtUTC, elapsedMs: Date.now() - started,
    errors, numericSanityPass,
    acceptance: "No optical accuracy or real-cat quality pass assigned; inspect actual per-angle off/on biases, both attachments and raw readbacks before deciding.",
  };
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ output, numericSanityPass, actualMRTFrames: result.rows.length,
    errors, structuralFailures: result.structuralFailures, comparisons: result.comparisons }));
  if (!numericSanityPass) process.exitCode = 1;
} catch (error) {
  await writeFile(path.join(output, "failure.json"), JSON.stringify({
    status: "fixture-incomplete-no-optical-acceptance", error: String(error.stack ?? error),
    errors, ...provenance, startedAtUTC, elapsedMs: Date.now() - started,
  }, null, 2) + "\n");
  throw error;
} finally {
  await browser.close();
}
