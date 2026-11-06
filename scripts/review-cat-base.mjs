import { chromium } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";

const folder = "artifacts/cat-base-review";
await mkdir(folder, { recursive: true });
const binary = await readFile("public/models/review/tabby-web.glb");
assert.equal(binary.readUInt32LE(0), 0x46546c67);
const asset = JSON.parse(
  binary.subarray(20, 20 + binary.readUInt32LE(12)).toString(),
);
assert.ok(
  binary.length < 5 * 1024 * 1024,
  "The CC0 web preview must stay below 5 MiB",
);
assert.ok(asset.images.every((image) => Number.isInteger(image.bufferView)));
const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader"],
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 920 },
    reducedMotion: "reduce",
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://localhost:3000/studio/base?compare=1");
  const ready = page.locator('[data-review-ready="true"]');
  await ready.waitFor({ timeout: 60_000 });
  assert.equal(await ready.getAttribute("data-review-cat"), "tabby");
  async function capture(name) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${folder}/${name}.png`, fullPage: true });
  }
  await capture("tabby-three");
  await page.getByRole("button", { name: "脸部近看", exact: true }).click();
  await capture("tabby-face");
  const colored = await page.locator("canvas").screenshot();
  await page.getByRole("checkbox", { name: /灰材质/ }).check();
  const grey = await page.locator("canvas").screenshot();
  assert.ok(
    !colored.equals(grey),
    "Grey view must change actual rendered pixels",
  );
  await capture("tabby-grey");
  await page.getByRole("checkbox", { name: /灰材质/ }).uncheck();
  await page.getByRole("button", { name: "侧面", exact: true }).click();
  await capture("tabby-side");
  const before = await page.locator("canvas").screenshot();
  await ready.focus();
  await page.keyboard.press("ArrowRight");
  const after = await page.locator("canvas").screenshot();
  assert.ok(
    !before.equals(after),
    "Keyboard rotation must change rendered geometry",
  );
  const region = await page.locator("canvas").boundingBox();
  await page.mouse.move(
    region.x + region.width * 0.45,
    region.y + region.height * 0.5,
  );
  await page.mouse.down();
  await page.mouse.move(
    region.x + region.width * 0.6,
    region.y + region.height * 0.48,
    { steps: 8 },
  );
  await page.mouse.up();
  assert.ok(
    !(await page.locator("canvas").screenshot()).equals(after),
    "Mouse drag must rotate the model",
  );

  await page.getByRole("button", { name: /橘猫.*站立体型/ }).click();
  await ready.waitFor({ timeout: 60_000 });
  assert.equal(await ready.getAttribute("data-review-cat"), "ginger");
  await capture("ginger-three");
  await page.getByRole("button", { name: "脸部近看", exact: true }).click();
  await capture("ginger-face");
  await page.getByRole("button", { name: /虎斑猫.*完整站姿/ }).click();
  await ready.waitFor();
  await page.route("**/api/studio-preview/ginger", (route) => route.abort());
  await page.getByRole("button", { name: /橘猫.*站立体型/ }).click();
  await page.getByRole("heading", { name: "这只猫暂时没有加载成功" }).waitFor();
  await page.unroute("**/api/studio-preview/ginger");
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await ready.waitFor({ timeout: 60_000 });
  assert.equal(await ready.getAttribute("data-review-cat"), "ginger");

  await page.goto("http://localhost:3000/studio/base");
  await ready.waitFor({ timeout: 60_000 });
  assert.equal(
    await page.getByRole("button", { name: /橘猫.*站立体型/ }).count(),
    0,
  );
  await page.getByRole("button", { name: "脸部近看", exact: true }).click();
  await capture("default-face");

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: "reduce",
  });
  mobile.on("pageerror", (error) => errors.push(error.message));
  await mobile.goto("http://localhost:3000/studio/base");
  await mobile
    .locator('[data-review-ready="true"]')
    .waitFor({ timeout: 60_000 });
  await mobile.getByRole("button", { name: "脸部近看", exact: true }).tap();
  await mobile.screenshot({
    path: `${folder}/mobile-face.png`,
    fullPage: true,
  });
  assert.ok(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await mobile.setViewportSize({ width: 844, height: 390 });
  await mobile.getByRole("button", { name: "侧面", exact: true }).tap();
  await mobile.screenshot({
    path: `${folder}/mobile-landscape.png`,
    fullPage: true,
  });
  assert.ok(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  assert.deepEqual(errors, []);
  await writeFile(
    `${folder}/review.json`,
    JSON.stringify(
      {
        errors,
        tabbyBytes: binary.length,
        checked: [
          "two real model loads",
          "grey rendered pixels",
          "keyboard and mouse rotation",
          "failed load and retry",
          "mobile touch and orientation",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "Actual model loading, grey view, keyboard/mouse rotation, recovery and mobile layout passed.",
  );
} finally {
  await browser.close();
}
