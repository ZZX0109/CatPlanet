// Actual local studio captures; no image edits or offline renders.
// Usage: node scripts/capture-face-presets.mjs before|after|after-long
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";

const phase = process.argv[2];
if (!["before", "after", "after-long"].includes(phase))
  throw new Error("Choose before, after or after-long");
const output = path.resolve("artifacts/face-preset-refinement", phase);
if (phase === "before") {
  try {
    await access(path.join(output, "capture-report.json"));
    throw new Error("Preserve the existing before baseline.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
await mkdir(output, { recursive: true });
process.env.NO_PROXY = "localhost,127.0.0.1,::1";
process.env.no_proxy = process.env.NO_PROXY;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceFiles = [
  "lib/cat-creator-design.ts",
  "lib/cat-creator-model.ts",
  "components/useCatCreatorDesign.ts",
  "components/CatCreator.tsx",
  "components/CatCreatorScene.tsx",
  "lib/norwegian-fur.ts",
  "lib/cat-fur-flow.ts",
];
const sources = Object.fromEntries(
  await Promise.all(
    sourceFiles.map(async (file) => [file, sha(await readFile(file))]),
  ),
);
const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader"],
});
const origin = "http://localhost:3000",
  errors = [],
  screenshots = [],
  settings = [],
  models = [];
const profiles =
  phase === "after-long"
    ? [{ id: "long", label: "长毛猫", base: "norwegian" }]
    : [
        { id: "short", label: "短毛猫", base: "norwegian" },
        { id: "hairless", label: "无毛猫", base: "sphynx" },
      ];
const presets = [
  { id: "round", label: "圆润脸" },
  { id: "natural", label: "自然脸" },
  { id: "wedge", label: "楔形脸" },
];
const views = [
  { id: "front", label: "正面" },
  { id: "three", label: "三分之四" },
  { id: "side", label: "侧面" },
];
try {
  const audit = await browser.newContext();
  try {
    for (const profile of profiles) {
      const response = await audit.request.get(
          `${origin}/models/creator/${profile.base}-cat.glb`,
        ),
        bytes = await response.body();
      const manifest = JSON.parse(
        await readFile(
          `public/models/creator/${profile.base}-manifest.json`,
          "utf8",
        ),
      );
      const digest = sha(bytes);
      models.push({
        base: profile.base,
        status: response.status(),
        decodedBytes: bytes.length,
        sha256: digest,
        expectedSha256: manifest.outputSha256,
      });
      if (response.status() !== 200 || digest !== manifest.outputSha256)
        throw new Error("Unexpected model response");
    }
  } finally {
    await audit.close();
  }
  for (const profile of profiles) {
    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (e) =>
      errors.push({ profile: profile.id, message: e.message }),
    );
    const button = (label) =>
      page.getByRole("button", { name: label, exact: true });
    try {
      await page.goto(`${origin}/studio/base`);
      await page
        .locator('[data-creator-ready="true"]')
        .waitFor({ timeout: 90000 });
      await button(profile.label).click();
      const ready = page.locator(
        `[data-creator-ready="true"][data-creator-coat="${profile.id}"][data-creator-base="${profile.base}"]`,
      );
      const settle = async () => {
        await ready.waitFor({ timeout: 90000 });
        await page.waitForTimeout(200);
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          );
        });
      };
      await settle();
      await button("材质预览").click();
      if ((await button("呼吸与眨眼").getAttribute("aria-pressed")) !== "false")
        throw new Error("Static captures must not play motion");
      for (const preset of presets) {
        await button(preset.label).click();
        await settle();
        const shape = {};
        for (const group of ["头型", "眼睛", "鼻口", "耳朵", "毛发"]) {
          await button(group).click();
          for (const slider of await page
            .locator('input[id^="creator-"]')
            .all())
            shape[(await slider.getAttribute("id")).replace("creator-", "")] =
              Number(await slider.inputValue());
        }
        settings.push({
          profile: profile.id,
          preset: preset.id,
          shape,
          pose: "stand",
          automaticMotion: false,
          views: views.map((v) => v.label),
        });
        await button("头型").click();
        for (const view of views) {
          await button(view.label).click();
          await settle();
          await page.evaluate(() => scrollTo(0, 0));
          const filename = `${profile.id}-${preset.id}-${view.id}.png`;
          await page
            .locator("canvas")
            .screenshot({ path: path.join(output, filename) });
          screenshots.push(filename);
        }
      }
    } finally {
      await context.close();
    }
  }
  const changedSources = [];
  for (const [file, digest] of Object.entries(sources))
    if (sha(await readFile(file)) !== digest) changedSources.push(file);
  const report = {
    phase,
    capturedAt: new Date().toISOString(),
    renderer: "Actual localhost studio WebGL",
    freshContexts: true,
    storagePreloaded: false,
    reducedMotion: true,
    viewport: { width: 1365, height: 900, deviceScaleFactor: 1 },
    sources,
    models,
    settings,
    screenshots,
    errors,
    unchangedSourcesThroughoutCapture: changedSources.length === 0,
    changedSources,
  };
  await writeFile(
    path.join(output, "capture-report.json"),
    JSON.stringify(report, null, 2),
  );
  if (errors.length || changedSources.length)
    throw new Error(JSON.stringify({ errors, changedSources }));
  console.log(
    JSON.stringify({
      output,
      count: screenshots.length,
      errors,
      sourcesStable: true,
    }),
  );
} finally {
  await browser.close();
}
