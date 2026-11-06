import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import registry from "../lib/room-model-assets.json";
import { currentRoomAsset, roomModelAsset } from "../lib/room-model-assets";
import { defaultCreatorDesign } from "../lib/cat-creator-design";

test("published model files match their registered hashes and have no external dependencies", async ({ request }) => {
  for (const asset of Object.values(registry.assets)) {
    const response = await request.get(asset.url);
    expect(response.status()).toBe(200);
    const bytes = await response.body();
    expect(bytes.length).toBe(asset.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(asset.sha256);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    expect([...(json.buffers ?? []), ...(json.images ?? [])].every(item => !item.uri || item.uri.startsWith("data:"))).toBe(true);
  }
});

test("corrupt archive is refused; retry loads the pinned copy independently of studio assets", async ({ page }) => {
  const design = structuredClone(defaultCreatorDesign);
  const asset = roomModelAsset(currentRoomAsset(design), design);
  await page.route("**/models/creator/**", route => route.abort());
  await page.route(`**${asset.url}`, route => route.fulfill({ status: 200, contentType: "model/gltf-binary", body: Buffer.alloc(asset.bytes) }));
  await page.goto("/");
  await page.getByRole("button", { name: "创建我的纪念宠物", exact: true }).click();
  await page.getByLabel("它的名字", { exact: true }).fill("版本保留小猫");
  const upload = page.getByLabel("导入造型室外观 JSON");
  await upload.setInputFiles({ name: "appearance.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(design)) });
  await expect(page.getByRole("button", { name: "重新加载房间", exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByLabel("它的名字", { exact: true })).toHaveValue("版本保留小猫");
  await page.unroute(`**${asset.url}`);
  await page.getByRole("button", { name: "重新加载房间", exact: true }).click();
  await expect(page.locator('[data-model-ready="toon"]')).toBeVisible({ timeout: 40000 });
  await upload.setInputFiles({ name: "hairless.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...design, coatType: "hairless" })) });
  await expect(page.getByText("当前外观：无毛猫", { exact: true })).toBeVisible();
  await expect(page.getByText("猫咪正在来房间的路上…", { exact: true })).toBeHidden({ timeout: 40000 });
  await expect(page.locator('[data-model-ready="toon"]')).toBeVisible();
});
