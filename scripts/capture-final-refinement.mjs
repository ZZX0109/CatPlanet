// Capture the actual local studio, including the models served by its gzip route.
// Run after the final regression suite so concurrent WebGL work cannot affect it.
import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve("artifacts/table-refinement/final");
const profiles = [
  { id: "short", label: "短毛猫", base: "norwegian", restZoomOut: 1 },
  { id: "long", label: "长毛猫", base: "norwegian", restZoomOut: 1 },
  { id: "hairless", label: "无毛猫", base: "sphynx", restZoomOut: 2 },
];
const expected = {};
for (const base of ["norwegian", "sphynx"])
  expected[base] = JSON.parse(
    await readFile(`public/models/creator/${base}-manifest.json`, "utf8"),
  ).outputSha256;

process.env.NO_PROXY = "localhost,127.0.0.1,::1";
process.env.no_proxy = process.env.NO_PROXY;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader"],
});
const errors = [],
  responses = [],
  sourceAudits = [],
  shots = [],
  settings = [];

try {
  // Large decoded GLBs can be evicted from Chromium's inspector response cache.
  // Audit the same served URL through Playwright's HTTP client and record the
  // page's actual model response separately, without replacing its request.
  const auditContext = await browser.newContext();
  try {
    for (const base of ["norwegian", "sphynx"]) {
      const url = `http://localhost:3000/models/creator/${base}-cat.glb`;
      const response = await auditContext.request.get(url);
      const bytes = await response.body();
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      sourceAudits.push({
        base,
        url,
        status: response.status(),
        contentEncoding: response.headers()["content-encoding"] ?? null,
        decodedBytes: bytes.length,
        sha256,
        expectedSha256: expected[base],
        matchesPublishedModel: sha256 === expected[base],
      });
      if (response.status() !== 200 || sha256 !== expected[base])
        throw new Error(
          `The server did not provide the published ${base} model.`,
        );
    }
  } finally {
    await auditContext.close();
  }
  for (const profile of profiles) {
    const context = await browser.newContext({
      viewport: { width: 1365, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (error) =>
      errors.push({ profile: profile.id, message: error.message }),
    );
    page.on("response", (response) => {
      const match = response
        .url()
        .match(/\/models\/creator\/(norwegian|sphynx)-cat\.glb(?:\?|$)/);
      if (!match) return;
      responses.push({
        profile: profile.id,
        base: match[1],
        url: response.url(),
        status: response.status(),
        contentEncoding: response.headers()["content-encoding"] ?? null,
      });
    });
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const response = await page.goto("http://localhost:3000/studio/base");
          if (response && response.status() >= 500)
            throw new Error("Studio is restarting");
          break;
        } catch (error) {
          if (attempt >= 4) throw error;
          await page.waitForTimeout(1000);
        }
      }
      await page
        .locator('[data-creator-ready="true"]')
        .waitFor({ timeout: 90_000 });
      const button = (name) => page.getByRole("button", { name, exact: true });
      const preview = page.getByRole("region", {
        name: "结构猫头三维预览",
        exact: true,
      });
      const canvas = page.locator("canvas");
      const settle = async (milliseconds = 220) => {
        await page.waitForTimeout(milliseconds);
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
        });
      };
      const capture = async (name, fullUi = false) => {
        const ready = page.locator(
          `[data-creator-ready="true"][data-creator-coat="${profile.id}"][data-creator-base="${profile.base}"]`,
        );
        await ready.waitFor({ timeout: 90_000 });
        await page.evaluate(() => scrollTo(0, 0));
        await settle();
        await ready.waitFor({ timeout: 90_000 });
        await canvas.waitFor({ state: "visible" });
        const filename = `${profile.id}-${name}.png`;
        if (fullUi)
          await page.screenshot({
            path: path.join(output, filename),
            fullPage: true,
          });
        else await canvas.screenshot({ path: path.join(output, filename) });
        shots.push(filename);
      };

      await button(profile.label).click();
      await page
        .locator(
          `[data-creator-ready="true"][data-creator-coat="${profile.id}"][data-creator-base="${profile.base}"]`,
        )
        .waitFor({ timeout: 90_000 });
      await button("自然脸").click();
      await button("材质预览").click();
      const face = {};
      for (const part of ["头型", "眼睛", "鼻口", "耳朵"]) {
        await button(part).click();
        for (const slider of await page
          .locator('input[id^="creator-"]')
          .all()) {
          const key = (await slider.getAttribute("id")).replace("creator-", "");
          const value = Number(await slider.inputValue());
          face[key] = value;
          if (value !== (["headRound", "headWedge"].includes(key) ? 0 : 50))
            throw new Error(
              `Capture must use a neutral face: ${profile.id}.${key}=${value}`,
            );
        }
      }
      const living = button("呼吸与眨眼");
      if ((await living.getAttribute("aria-pressed")) !== "false")
        throw new Error(
          "Static review must leave breathing and automatic blinking off.",
        );
      settings.push({
        profile: profile.id,
        face,
        headCapturePose: "stand",
        restingCapturePose: "rest",
        restingOrbitSteps: 3,
        restingZoomOutSteps: profile.restZoomOut,
        automaticMotion: false,
      });

      await button("头型").click();
      await button("三分之四").click();
      await capture("head-open-three");
      await button("闭眼预览").click();
      await capture("head-closed-three");
      await button("闭眼预览").click();

      await button("趴卧").click();
      await settle(400);
      await button("全身").click();
      await settle();
      await preview.focus();
      for (let i = 0; i < 3; i++) {
        await preview.press("ArrowRight");
        await settle(80);
      }
      // Refit the manually orbited resting silhouette, including fur and paws.
      for (let i = 0; i < profile.restZoomOut; i++) {
        await preview.press("-");
        await settle(80);
      }
      await capture("rest-whole-three");
      if (profile.id === "short") await capture("rest-ui", true);
    } finally {
      await context.close();
    }
  }
  const report = {
    capturedAt: new Date().toISOString(),
    renderer:
      "Actual localhost:3000 studio WebGL; no image edits or offline renders",
    freshContexts: true,
    storagePreloaded: false,
    reducedMotion: true,
    automaticMotion: false,
    materialPreview: true,
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
  if (
    !responses.some((x) => x.base === "norwegian") ||
    !responses.some((x) => x.base === "sphynx")
  )
    throw new Error("Both final model responses must be recorded.");
  console.log(
    JSON.stringify({
      output,
      screenshots: shots,
      decodedHttpModels: sourceAudits,
      modelResponses: responses,
      errors,
    }),
  );
} finally {
  await browser.close();
}
