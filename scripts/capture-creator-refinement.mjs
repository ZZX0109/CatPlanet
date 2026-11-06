// Actual local browser captures for the five art passes, independent of tests.
import { chromium } from "@playwright/test";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { createServer } from "node:http";
import path from "node:path";

const label = process.argv[2];
if (!label || !/^[0-9]+-[a-z0-9-]+$/.test(label))
  throw new Error("Pass a checkpoint such as 00-before or 01-eyelids");
const output = path.resolve(process.env.CAT_CAPTURE_ROOT ?? "artifacts/creator-refinement-5", label);
await mkdir(output, { recursive: true });
const assetPath = process.argv[3] ?? "public/models/creator/structural-cat.glb";
const asset = await readFile(assetPath);
await writeFile(path.join(output, "structural-cat.glb.gz"), gzipSync(asset));
const sceneCode = await readFile("components/CatCreatorScene.tsx");
const manifest = JSON.parse(
  await readFile(path.join(path.dirname(assetPath), "manifest.json"), "utf8"),
);
await copyFile(
  "scripts/build-structural-cat.py",
  path.join(output, "build-structural-cat.py"),
);
await copyFile(
  path.join(path.dirname(assetPath), "manifest.json"),
  path.join(output, "asset-manifest.json"),
);
await writeFile(path.join(output, "CatCreatorScene.tsx"), sceneCode);
try {
  await copyFile(
    "scripts/creator-coat.py",
    path.join(output, "creator-coat.py"),
  );
} catch {}
for (const helper of ["creator-iris.py", "creator-orbital-fur.py", "refine-creator-normals.mjs", "build-cat-creator.mjs"]) {
  try {
    await copyFile(path.join("scripts", helper), path.join(output, helper));
  } catch {}
}
if (label === "00-before") {
  await copyFile(
    "public/models/creator/structural-cat.glb",
    path.join(output, "structural-cat.glb"),
  );
  await copyFile(
    "assets/authored/structural-cat.blend",
    path.join(output, "structural-cat.blend"),
  );
}
process.env.NO_PROXY = "localhost,127.0.0.1,::1";
const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader"],
});
const errors = [];
// Freeze large assets through HTTP rather than base64 inside the browser
// control protocol; the captured model still matches the recorded file hash.
const assetServer = createServer((request, response) => {
  if (request.url !== "/structural-cat.glb") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "Content-Type": "model/gltf-binary",
    "Content-Length": asset.length,
    "Access-Control-Allow-Origin": "http://localhost:3000",
  });
  response.end(asset);
});
try {
  await new Promise((resolve, reject) => {
    assetServer.once("error", reject);
    assetServer.listen(0, "127.0.0.1", resolve);
  });
  const address = assetServer.address();
  if (!address || typeof address === "string") throw new Error("Missing capture asset server");
  const page = await browser.newPage({
    viewport: { width: 1365, height: 900 },
    deviceScaleFactor: 1,
  });
  // Freeze the exact bytes whose hash is recorded below. The authoring process
  // may start preparing the next pass while this browser finishes its captures.
  await page.route("**/models/creator/structural-cat.glb", (route) =>
    route.fulfill({
      status: 307,
      headers: { location: `http://127.0.0.1:${address.port}/structural-cat.glb` },
    }),
  );
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("http://localhost:3000/studio/base");
  await page.locator('[data-creator-ready="true"]').waitFor({ timeout: 60000 });
  await page.locator("canvas").waitFor();
  const button = (name) => page.getByRole("button", { name, exact: true });
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  const capture = async (name) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle();
    await page
      .locator("canvas")
      .screenshot({ path: path.join(output, `${name}.png`) });
  };
  await button("灰模").click();
  await button("正面").click();
  for (const [preset, name] of [
    ["自然脸", "natural"],
    ["圆润脸", "round"],
    ["楔形脸", "wedge"],
  ]) {
    await button(preset).click();
    await capture(`${name}-clay-front`);
  }
  await button("自然脸").click();
  await button("三分之四").click();
  await capture("natural-clay-three");
  await button("侧面").click();
  await capture("natural-clay-side");
  await button("正面").click();
  await button("闭眼预览").click();
  await capture("natural-clay-closed");
  await button("闭眼预览").click();
  for (const [key, name] of [
    ["Home", "extreme-low"],
    ["End", "extreme-high"],
  ]) {
    await button("自然脸").click();
    for (const part of ["头型", "眼睛", "鼻口", "耳朵"]) {
      await button(part).click();
      for (const slider of await page.getByRole("slider").all()) {
        const id = await slider.getAttribute("id");
        if (id === "creator-headRound" || id === "creator-headWedge") continue;
        await slider.press(key);
      }
    }
    await button("头型").click();
    await capture(`${name}-clay-front`);
    await button("侧面").click();
    await capture(`${name}-clay-side`);
    await button("正面").click();
  }
  await button("自然脸").click();
  await page
    .getByRole("button", { name: /^(眼部材质|材质预览|皮毛预览)$/ })
    .click();
  await capture("natural-material-front");
  const cameraTools = page.locator("details").filter({ has: page.locator("summary", { hasText: "旋转与缩放按钮" }) });
  await cameraTools.locator("summary").click();
  await button("放大").click();
  await button("放大").click();
  await capture("natural-material-detail");
  await cameraTools.locator("summary").click();
  await button("正面").click();
  await button("三分之四").click();
  await capture("natural-material-three");
  await button("侧面").click();
  await capture("natural-material-side");
  await button("正面").click();
  await button("闭眼预览").click();
  await capture("natural-material-closed");
  await button("闭眼预览").click();
  for (const [preset, name] of [["圆润脸", "round"], ["楔形脸", "wedge"]]) {
    await button(preset).click();
    await capture(`${name}-material-front`);
  }
  await button("自然脸").click();
  await button("三分之四").click();
  await button("自然脸").scrollIntoViewIfNeeded();
  await settle();
  await page.screenshot({ path: path.join(output, "desktop.png") });
  await writeFile(
    path.join(output, "checkpoint.json"),
    JSON.stringify(
      {
        checkpoint: label,
        sourceAsset: path.resolve(assetPath),
        assetSha256: createHash("sha256").update(asset).digest("hex"),
        sceneSha256: createHash("sha256").update(sceneCode).digest("hex"),
        assetBytes: asset.byteLength,
        template: manifest.templateId,
        screenshots:
          "Actual WebGL renderer, same viewport and camera buttons; fresh browser state.",
        errors,
      },
      null,
      2,
    ),
  );
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    JSON.stringify({
      checkpoint: label,
      sourceAsset: assetPath,
      output,
      bytes: asset.byteLength,
      errors,
    }),
  );
} finally {
  assetServer.closeAllConnections();
  await new Promise((resolve) => assetServer.close(resolve));
  await browser.close();
}
