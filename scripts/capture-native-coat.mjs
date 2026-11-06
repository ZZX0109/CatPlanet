import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { installNativeCoatInspection } from "../tests/fixtures/native-coat-inspection.mjs";

const phase = process.argv[2] ?? "source-round01";
if (!/^[a-z0-9-]+$/.test(phase) || phase === "before")
  throw Error("Use a new phase");
const output = path.resolve("artifacts/native-coat", phase);
const overrideArgument = process.argv.find((arg) => arg.startsWith("--asset="));
const overridePath = overrideArgument ? path.resolve(overrideArgument.slice(8)) : null;
const overrideBytes = overridePath ? await readFile(overridePath) : null;
await mkdir(output, { recursive: true });
const digest = (data) => createHash("sha256").update(data).digest("hex");
const paths = [
  "lib/norwegian-fur.ts",
  "components/RoomCreatorCat.tsx",
  ...(await readdir("lib"))
    .filter((name) => /^cat-.*(coat|fur|creator).*\.ts$/.test(name))
    .map((name) => `lib/${name}`),
  "components/CatCreator.tsx",
  "components/CatCreatorScene.tsx",
  "components/CatCreator.module.css",
  "components/useCatCreatorDesign.ts",
];
const sourceHashes = async () =>
  Object.fromEntries(
    await Promise.all(
      paths.map(async (file) => [file, digest(await readFile(file))]),
    ),
  );
const sources = await sourceHashes(),
  frames = [],
  errors = [];
const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader"],
});
let modelSHA = null;
try {
  for (const mobile of process.argv.includes("--quick")
    ? [false]
    : [false, true]) {
    const viewport = mobile
      ? { width: 390, height: 844 }
      : { width: 1365, height: 900 };
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      ...(mobile ? { hasTouch: true, isMobile: true } : {}),
    });
    const page = await context.newPage();
    let servedOverride = false;
    if (overrideBytes)
      await page.route("**/models/creator/norwegian-cat.glb", async (route) => {
        servedOverride = true;
        await route.fulfill({ status: 200, contentType: "model/gltf-binary", body: overrideBytes });
      });
    page.on("pageerror", (e) =>
      errors.push({ mobile, type: "page", message: e.message }),
    );
    page.on("console", (m) => {
      if (m.type() === "error")
        errors.push({ mobile, type: "console.error", message: m.text() });
    });
    try {
      await page.goto("http://localhost:3000/studio/base");
      await page
        .locator(
          '[data-creator-ready="true"][data-creator-coat="long"][data-creator-coat-mode="source"]',
        )
        .waitFor({ timeout: 90000 });
      let loadedBytes = overrideBytes;
      if (loadedBytes) {
        if (!servedOverride) throw Error("Candidate asset was not served to the page");
      } else {
        const response = await context.request.get("http://localhost:3000/models/creator/norwegian-cat.glb");
        if (!response.ok()) throw Error("Source asset unavailable");
        loadedBytes = await response.body();
      }
      const assetSHA = digest(loadedBytes);
      if (modelSHA && modelSHA !== assetSHA)
        throw Error("Source asset changed");
      modelSHA = assetSHA;
      await page.evaluate(installNativeCoatInspection);
      const button = (name) => page.getByRole("button", { name, exact: true });
      const settle = async () => {
        await page
          .locator(
            '[data-creator-ready="true"][data-creator-coat-mode="source"]',
          )
          .waitFor();
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((r) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            ),
          );
        });
        if (errors.length) throw Error(errors.at(-1).message);
      };
      const capture = async (view) => {
        await settle();
        const actual = await page.evaluate(() => window.__nativeCoatCapture());
        if (actual.mode !== "source" || actual.preparedGroom !== false)
          throw Error("Source mode did not use lightweight resource");
        if (
          Object.values(actual.stats).some(
            (region) =>
              region.strands !== 0 ||
              region.capacity !== 0 ||
              region.previewStrands !== 0,
          )
        )
          throw Error("Source mode allocated/drew procedural coat");
        if (
          actual.draws.some(
            (draw) =>
              draw.furRegion ||
              draw.undercoat ||
              draw.volumeRegion ||
              /EarTufts/.test(draw.name),
          )
        )
          throw Error("Unexpected procedural coat draw in source mode");
        if (!actual.draws.some((draw) => draw.native))
          throw Error("No native mesh actually drew");
        if (
          actual.context.error !== 0 ||
          actual.context.programs.some((p) => !p.runnable)
        )
          throw Error("Native WebGL failure");
        const name = `${mobile ? "phone" : "desktop"}-${view}.png`;
        await page
          .locator("canvas")
          .screenshot({ path: path.join(output, name) });
        frames.push({ file: name, viewport: page.viewportSize(), actual });
        console.log(JSON.stringify({ captured: name }));
      };
      const whole = async () => {
        await button("全身").click();
        await settle();
        const region = page.getByRole("region", {
          name: "结构猫头三维预览",
          exact: true,
        });
        await region.focus();
        for (let i = 0; i < 3; i++) {
          await region.press("ArrowRight");
          await settle();
        }
        await region.press("-");
        await settle();
      };
      const yaw = async (degrees) => {
        await page.evaluate((degrees) => {
          const canvas = document.querySelector("canvas");
          let fiber =
            canvas[
              Object.keys(canvas).find((key) => key.startsWith("__reactFiber"))
            ];
          while (fiber && !fiber.memoizedProps?.model) fiber = fiber.return;
          const state = fiber.memoizedProps.model.scene.__r3f.root.getState(),
            camera = state.camera,
            controls = state.controls;
          const delta = camera.position.clone().sub(controls.target),
            radius = delta.length(),
            phi = Math.acos(delta.y / radius),
            theta = (degrees * Math.PI) / 180;
          camera.position.set(
            controls.target.x + radius * Math.sin(phi) * Math.sin(theta),
            controls.target.y + radius * Math.cos(phi),
            controls.target.z + radius * Math.sin(phi) * Math.cos(theta),
          );
          camera.lookAt(controls.target);
          controls.update();
          state.invalidate();
        }, degrees);
        await settle();
      };
      await button("三分之四").click();
      await capture("head");
      if (mobile) {
        await button("毛发").tap();
        await page.screenshot({
          path: path.join(output, "phone-page.png"),
          fullPage: true,
        });
        await page.setViewportSize({ width: 844, height: 390 });
        await button("三分之四").tap();
        await capture("landscape-head");
        await page.screenshot({
          path: path.join(output, "phone-landscape-page.png"),
          fullPage: true,
        });
        continue;
      }
      await whole();
      await yaw(90);
      await capture("side");
      if (process.argv.includes("--quick")) continue;
      await button("趴卧").click();
      await whole();
      await capture("rest-whole");
      await yaw(180);
      await capture("rest-rear");
    } finally {
      await context.close();
    }
  }
  const sourcesAfter = await sourceHashes();
  const changed = paths.filter((file) => sources[file] !== sourcesAfter[file]);
  await writeFile(
    path.join(output, "capture-report.json"),
    JSON.stringify(
      {
        phase,
        assetOverride: overridePath,
        method:
          "Unedited actual studio source-coat images; native Object3D draw callbacks observed; lightweight preparedGroom:false and zero procedural capacities verified.",
        sources,
        sourcesAfter,
        changed,
        modelSHA,
        frames,
        errors,
      },
      null,
      2,
    ),
  );
  if (changed.length || errors.length)
    throw Error("Sources changed or renderer errors");
  console.log(
    JSON.stringify({
      output,
      images: frames.length,
      modelSHA,
      changed,
      errors,
    }),
  );
} catch (error) {
  await writeFile(
    path.join(output, "partial-failure-report.json"),
    JSON.stringify(
      {
        phase,
        complete: false,
        assetOverride: overridePath,
        failure: error.stack,
        sources,
        sourcesAfter: await sourceHashes(),
        modelSHA,
        frames,
        errors,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
