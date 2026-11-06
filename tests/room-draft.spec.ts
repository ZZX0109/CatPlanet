import { defaultCreatorDesign } from "../lib/cat-creator-design";
import { test, expect, devices, type Page } from "@playwright/test";
import sharp from "sharp";

async function storedDraft(page: Page, key = "guest") {
  return page.evaluate(key => new Promise<any>((resolve, reject) => {
    const open = indexedDB.open("miaoxing-room-drafts", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction("drafts").objectStore("drafts").get(key);
      request.onsuccess = () => { resolve(request.result ?? null); db.close(); };
      request.onerror = () => { reject(request.error); db.close(); };
    };
  }), key);
}
async function guest(page: Page) {
  await page.route("**/api/session", route => route.fulfill({ json: { user: null, pet: null } }));
  await page.goto("/");
  await page.getByRole("button", { name: "创建我的纪念宠物", exact: true }).click();
  await page.getByLabel("它的名字", { exact: true }).fill("草稿小猫");
}

test("refresh restores photo, appearance and unfinished memory; discard actually removes draft", async ({ page }) => {
  await guest(page);
  const photo = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#c08060" } }).png().toBuffer();
  await page.locator('input[accept="image/jpeg,image/png,image/webp"]').setInputFiles({ name: "draft.png", mimeType: "image/png", buffer: photo });
  await page.getByLabel("导入造型室外观 JSON").setInputFiles({ name: "cat.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(defaultCreatorDesign)) });
  await page.getByRole("button", { name: "进入它的小房间", exact: true }).click();
  await page.getByRole("button", { name: "回忆 · 0", exact: true }).click();
  await page.getByLabel("记下一段回忆", { exact: true }).fill("还没有写完的那个午后");
  await expect.poll(async () => (await storedDraft(page))?.memory).toBe("还没有写完的那个午后");
  await page.reload();
  await expect(page.getByRole("region", { name: "本机未保存草稿" })).toContainText("草稿小猫");
  await page.getByRole("button", { name: "恢复本机草稿", exact: true }).click();
  await expect(page.getByLabel("记下一段回忆", { exact: true })).toHaveValue("还没有写完的那个午后");
  await page.getByRole("button", { name: "关于它", exact: true }).click();
  await expect(page.getByText("当前外观：短毛猫", { exact: true })).toBeVisible();
  await expect(page.locator(".portrait")).toHaveJSProperty("naturalWidth", 20);
  await page.getByRole("button", { name: "删除照片", exact: true }).click();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect.poll(async () => (await storedDraft(page))?.photo).toBeNull();
  await page.reload();
  await page.getByRole("button", { name: "放弃本机草稿", exact: true }).click();
  await expect.poll(() => storedDraft(page)).toBeNull();
  await page.reload();
  await expect(page.getByRole("region", { name: "本机未保存草稿" })).toHaveCount(0);
});

test("account drafts are isolated and explicit logout clears the account draft", async ({ page }) => {
  const pet = { name: "云端猫", model: "toon", personality: "", memories: [], photoId: null, version: 1 };
  let account = "owner-a";
  await page.route("**/api/session", route => route.fulfill({ json: { user: account ? { id: account, email: `${account}@example.test` } : null, pet: account ? pet : null } }));
  await page.route("**/api/auth/logout", route => route.fulfill({ json: { ok: true } }));
  await page.goto("/");
  await page.getByLabel("它的性格", { exact: true }).fill("仅属于账号甲的修改");
  await expect.poll(async () => (await storedDraft(page, "account:owner-a"))?.pet.personality).toBe("仅属于账号甲的修改");
  account = "owner-b";
  await page.reload();
  await expect(page.getByLabel("它的性格", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "恢复本机草稿" })).toHaveCount(0);
  account = "owner-a";
  await page.reload();
  await page.getByRole("button", { name: "恢复本机草稿" }).click();
  await expect(page.getByLabel("它的性格", { exact: true })).toHaveValue("仅属于账号甲的修改");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  account = "";
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByRole("button", { name: "邮箱登录", exact: true })).toBeVisible();
  await expect.poll(() => storedDraft(page, "account:owner-a")).toBeNull();
});

test("expired local drafts are removed instead of offered for recovery", async ({ page }) => {
  await guest(page);
  await expect.poll(async () => (await storedDraft(page))?.pet.name).toBe("草稿小猫");
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("miaoxing-room-drafts", 1);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("drafts", "readwrite");
      const store = tx.objectStore("drafts");
      const request = store.get("guest");
      request.onsuccess = () => store.put({ ...request.result, updatedAt: Date.now() - 8 * 86400000 }, "guest");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
    open.onerror = () => reject(open.error);
  }));
  await page.reload();
  await expect(page.getByRole("button", { name: "创建我的纪念宠物", exact: true })).toBeEnabled();
  await expect(page.getByRole("region", { name: "本机未保存草稿" })).toHaveCount(0);
  await expect.poll(() => storedDraft(page)).toBeNull();
});

test("unavailable browser storage permits editing with explicit memory-only feedback", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, "indexedDB", { get() { throw new Error("storage disabled"); } }); });
  await page.route("**/api/session", route => route.fulfill({ json: { user: null, pet: null } }));
  await page.goto("/");
  await page.getByRole("button", { name: "暂不使用本机草稿，继续编辑" }).click();
  await page.getByRole("button", { name: "创建我的纪念宠物", exact: true }).click();
  await page.getByLabel("它的名字", { exact: true }).fill("仍能编辑");
  await page.getByRole("button", { name: "进入它的小房间", exact: true }).click();
  await expect(page.getByText("当前仅保留页面内存，请登录保存后再关闭。未读取的旧草稿仍留在本机。", { exact: true })).toBeVisible();
});

for (const name of ["iPhone SE", "iPhone 13", "Pixel 7"]) {
  test(`${name}: camera controls work without overflow in portrait and landscape`, async ({ browser }) => {
    const context = await browser.newContext({ ...devices[name] });
    try {
      const page = await context.newPage();
      await page.goto("http://localhost:3000");
      await page.getByRole("button", { name: "先体验房间", exact: true }).tap();
      await expect(page.locator('[data-model-ready="toon"]')).toBeVisible();
      await page.emulateMedia({ reducedMotion: "reduce" });
      const canvas = page.locator("canvas");
      const before = await canvas.screenshot();
      await page.getByRole("button", { name: "拉近视角", exact: true }).tap();
      expect((await canvas.screenshot()).equals(before)).toBe(false);
      await page.getByRole("button", { name: "向右转动视角", exact: true }).tap();
      await expect(page.getByRole("group", { name: "房间视角" })).not.toHaveAttribute("data-camera-yaw", "0");
      await page.getByRole("button", { name: "恢复默认视角", exact: true }).tap();
      await expect(page.getByRole("group", { name: "房间视角" })).toHaveAttribute("data-camera-zoom", "1");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `artifacts/local-room/${name.replaceAll(" ", "-")}-portrait.png`, fullPage: true });
      const viewport = page.viewportSize()!;
      await page.setViewportSize({ width: viewport.height, height: viewport.width });
      await page.getByRole("button", { name: "拉远视角", exact: true }).tap();
      await page.screenshot({ path: `artifacts/local-room/${name.replaceAll(" ", "-")}-landscape.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await context.close(); }
  });
}
