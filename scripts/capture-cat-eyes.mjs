// Fixed-camera inspection of the actual local WebGL eye, not an offline render.
import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import path from "node:path";
const label = process.argv[2],
  assetPath = process.argv[3] ?? "public/models/creator/structural-cat.glb";
if (!label || !/^\d+-[a-z0-9-]+$/.test(label))
  throw new Error("Supply an inspection label");
const output = path.resolve("artifacts/eye-optics-refinement", label);
await mkdir(output, { recursive: true });
const bytes = await readFile(assetPath),
  errors = [];
process.env.NO_PROXY = "localhost,127.0.0.1,::1";
const server = createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "model/gltf-binary",
    "Access-Control-Allow-Origin": "http://localhost:3000",
  });
  res.end(bytes);
});
await new Promise((r, j) => {
  server.once("error", j);
  server.listen(0, "127.0.0.1", r);
});
const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1365, height: 900 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/models/creator/structural-cat.glb", (route) =>
    route.fulfill({
      status: 307,
      headers: {
        location: `http://127.0.0.1:${server.address().port}/model.glb`,
      },
    }),
  );
  await page.goto("http://localhost:3000/studio/base");
  await page.locator('[data-creator-ready="true"]').waitFor({ timeout: 90000 });
  const button = (name) => page.getByRole("button", { name, exact: true });
  await button("自然脸").click();
  await button("毛发").click();
  await page
    .getByRole("slider", { name: "猫毛数量", exact: true })
    .press("Home");
  await button("眼睛").click();
  await button("材质预览").click();
  const tools = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "旋转与缩放按钮" }) });
  async function capture(name) {
    await page.evaluate(() => scrollTo(0, 0));
    await page
      .locator("canvas")
      .screenshot({ path: path.join(output, `${name}.png`) });
  }
  for (const [view, name] of [
    ["正面", "front"],
    ["三分之四", "three"],
    ["侧面", "side"],
  ]) {
    await button(view).click();
    await tools.locator("summary").click();
    await button("放大").click();
    await button("放大").click();
    await tools.locator("summary").click();
    await capture(name);
  }
  await button("正面").click();
  await button("闭眼预览").click();
  await capture("closed");
  await button("闭眼预览").click();
  await button("三分之四").click();
  await capture("overview");
  await writeFile(
    path.join(output, "checkpoint.json"),
    JSON.stringify(
      {
        assetPath,
        assetSha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
        inspection:
          "Actual webpage; neutral face, fixed camera buttons, geometric fur hidden for eye inspection",
        errors,
      },
      null,
      2,
    ),
  );
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(JSON.stringify({ label, output, bytes: bytes.length }));
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
