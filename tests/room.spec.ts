import { currentRoomAsset } from "../lib/room-model-assets";
import { defaultCreatorDesign } from "../lib/cat-creator-design";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import pg from "pg";
import sharp from "sharp";
const origin = "http://localhost:3000";
const headers = { Origin: origin };
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
test.beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "54329" ||
    url.pathname !== "/miaoxing"
  )
    throw new Error("Tests require the dedicated local compose database");
  const key = createHmac("sha256", process.env.AUTH_SECRET!)
    .update("send:local")
    .digest("hex");
  await db.query("DELETE FROM rate_limits WHERE key=$1", [key]);
});
test.afterAll(() => db.end());
async function mailCode(request: APIRequestContext, email: string) {
  let id = "";
  await expect
    .poll(async () => {
      const data = await (
        await request.get("http://127.0.0.1:8025/api/v1/messages")
      ).json();
      id =
        data.messages.find((m: { To: { Address: string }[] }) =>
          m.To.some((to) => to.Address === email),
        )?.ID || "";
      return !!id;
    })
    .toBe(true);
  const mail = await (
    await request.get(`http://127.0.0.1:8025/api/v1/message/${id}`)
  ).json();
  return mail.Text.match(/\d{6}/)[0] as string;
}
async function login(request: APIRequestContext, email: string) {
  expect(
    (
      await request.post("/api/auth/code", { headers, data: { email } })
    ).status(),
  ).toBe(200);
  const code = await mailCode(request, email);
  expect(
    (
      await request.post("/api/auth/verify", { headers, data: { email, code } })
    ).status(),
  ).toBe(200);
  return code;
}
test("guest creation, actual canvas interaction, save and cross-device restoration", async ({
  page,
  request,
  browser,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "先体验房间", exact: true }).click();
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByText("猫咪正在来房间的路上…")).toBeHidden();
  await page.getByRole("button", { name: "走路", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "走路", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: "test-results/desktop-toon-walk.png" });
  const canvas = page.locator("canvas");
  const before = await canvas.screenshot();
  await page.waitForTimeout(220);
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  await page.getByRole("button", { name: "休息", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("button", { name: "休息", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "摸摸它", exact: true }).click();
  await expect(page.getByText("轻轻回应，继续休息")).toBeVisible();
  await expect(page.getByText("安静休息中")).toBeVisible();
  await page.getByRole("radio", { name: "团团" }).check();
  await expect(page.getByText("猫咪正在来房间的路上…")).toBeHidden();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "test-results/desktop-vuena-sleep.png" });
  const catBox = await canvas.boundingBox();
  await canvas.click({
    position: { x: catBox!.width * 0.5, y: catBox!.height * 0.43 },
  });
  await expect(page.getByText("轻轻回应，继续休息")).toBeVisible();
  await page
    .getByRole("button", { name: "创建我的纪念宠物", exact: true })
    .click();
  await page.getByLabel("它的名字", { exact: true }).fill("米粒");
  await page.getByRole("radio", { name: "团团" }).check();
  const image = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#ca9970" },
  })
    .png()
    .toBuffer();
  await page.locator('input[type=file][accept="image/jpeg,image/png,image/webp"]').setInputFiles({
    name: "memory.png",
    mimeType: "image/png",
    buffer: image,
  });
  await page.getByRole("button", { name: "进入它的小房间" }).click();
  await page.getByLabel("它的性格").fill("喜欢晒太阳");
  await page.getByRole("button", { name: "回忆 · 0" }).click();
  await page.getByLabel("记下一段回忆").fill("窗边那个温暖的午后。");
  await page.getByRole("button", { name: "加入回忆" }).click();
  await page.getByRole("button", { name: "保存纪念房间" }).click();
  const email = `ui-${randomUUID()}@example.test`;
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByRole("button", { name: "发送验证码" }).click();
  const code = await mailCode(request, email);
  await page.getByLabel("6 位验证码").fill("000000");
  await page.getByRole("button", { name: "验证并保存" }).click();
  await expect(page.locator("dialog .error")).toContainText("验证码错误");
  await page.getByLabel("6 位验证码").fill(code);
  await page.getByRole("button", { name: "验证并保存" }).click();
  await expect(
    page.getByText("已经保存，下次登录还可以继续探望。"),
  ).toBeVisible();
  const saved = await (await page.request.get("/api/pet")).json();
  expect(saved.pet).toMatchObject({
    name: "米粒",
    model: "vuena",
    personality: "喜欢晒太阳",
  });
  expect(saved.pet.memories[0].text).toBe("窗边那个温暖的午后。");
  expect(saved.pet.photoId).toBeTruthy();
  // Separate device, new cookie jar and independently verified login.
  await db.query(
    "UPDATE challenges SET sent_at=now()-interval '61 seconds' WHERE email=$1",
    [email],
  );
  const device = await browser.newContext({ baseURL: origin });
  const second = await device.newPage();
  await login(device.request, email);
  await second.goto(origin);
  await expect(
    second.getByRole("heading", { name: "米粒的小房间" }),
  ).toBeVisible();
  await expect(second.getByLabel("它的性格")).toHaveValue("喜欢晒太阳");
  await device.request.delete("/api/pet", { headers });
  await device.close();
});
test("OTP expiry, attempts, replay, ownership, conflict and storage cleanup", async ({
  playwright,
}) => {
  const a = await playwright.request.newContext({ baseURL: origin });
  const b = await playwright.request.newContext({ baseURL: origin });
  const email = `security-${randomUUID()}@example.test`;
  expect(
    (await a.post("/api/auth/code", { headers, data: { email } })).status(),
  ).toBe(200);
  expect(
    (await a.post("/api/auth/code", { headers, data: { email } })).status(),
  ).toBe(429);
  let code = await mailCode(a, email);
  await db.query(
    "UPDATE challenges SET expires_at=now()-interval '1 second',sent_at=now()-interval '61 seconds' WHERE email=$1",
    [email],
  );
  expect(
    (
      await a.post("/api/auth/verify", { headers, data: { email, code } })
    ).status(),
  ).toBe(400);
  await a.post("/api/auth/code", { headers, data: { email } });
  code = await mailCode(a, email);
  for (let i = 0; i < 5; i++)
    expect(
      (
        await a.post("/api/auth/verify", {
          headers,
          data: { email, code: "000000" },
        })
      ).status(),
    ).toBe(400);
  expect(
    (
      await a.post("/api/auth/verify", { headers, data: { email, code } })
    ).status(),
  ).toBe(400);
  await db.query(
    "UPDATE challenges SET sent_at=now()-interval '61 seconds' WHERE email=$1",
    [email],
  );
  code = await login(a, email);
  expect(
    (
      await a.post("/api/auth/verify", { headers, data: { email, code } })
    ).status(),
  ).toBe(400);
  await login(b, `other-${randomUUID()}@example.test`);
  const image = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "#aa8866" },
  })
    .png()
    .toBuffer();
  expect(
    (
      await a.post("/api/photos", {
        headers,
        data: Buffer.from("not an image"),
      })
    ).status(),
  ).toBe(400);
  const photo = await (
    await a.post("/api/photos", { headers, data: image })
  ).json();
  const draft = {
    name: "测试猫",
    model: "toon",
    personality: "",
    photoId: photo.id,
    memories: [{ id: randomUUID(), text: "测试回忆" }],
    version: 0,
  };
  expect(
    (
      await a.put("/api/pet", {
        headers: { Origin: "https://other.example" },
        data: draft,
      })
    ).status(),
  ).toBe(403);
  expect((await a.put("/api/pet", { headers, data: draft })).status()).toBe(
    200,
  );
  expect((await a.put("/api/pet", { headers, data: draft })).status()).toBe(
    409,
  );
  expect((await b.get(`/api/photos/${photo.id}`)).status()).toBe(404);
  expect(
    (await b.delete(`/api/photos/${photo.id}`, { headers })).status(),
  ).toBe(404);
  expect((await b.put("/api/pet", { headers, data: draft })).status()).toBe(
    404,
  );
  expect((await (await b.get("/api/pet")).json()).pet).toBeNull();
  expect((await a.get(`/api/photos/${photo.id}`)).status()).toBe(200);
  const file = `.data/photos/${photo.id}.webp`;
  await access(file);
  expect((await a.delete("/api/pet", { headers })).status()).toBe(200);
  await expect(access(file)).rejects.toThrow();
  expect((await a.get(`/api/photos/${photo.id}`)).status()).toBe(404);
  expect((await (await a.get("/api/pet")).json()).pet).toBeNull();
  await a.post("/api/auth/logout", { headers });
  expect((await a.get("/api/pet")).status()).toBe(401);
  await a.dispose();
  await b.dispose();
});
test("mobile touch, orientation, offline draft, WebGL and model failure recovery", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(origin);
  await page.getByRole("button", { name: "先体验房间", exact: true }).tap();
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByText("猫咪正在来房间的路上…")).toBeHidden();
  await page.getByRole("button", { name: "走路", exact: true }).tap();
  await page.getByRole("button", { name: "摸摸它", exact: true }).tap();
  await expect(page.getByText("转过身，回应你的轻触")).toBeVisible();
  await page.screenshot({
    path: "test-results/mobile-portrait.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "展开纪念资料" }).tap();
  await page.getByRole("radio", { name: "团团" }).check();
  await expect(page.getByText("猫咪正在来房间的路上…")).toBeHidden({
    timeout: 20_000,
  });
  await expect(page.getByText("慢慢走一走")).toBeVisible();
  await page.locator("canvas").scrollIntoViewIfNeeded();
  const touchBox = await page.locator("canvas").boundingBox();
  await page.touchscreen.tap(
    touchBox!.x + touchBox!.width * 0.5,
    touchBox!.y + touchBox!.height * 0.36,
  );
  await expect(page.getByText("转过身，回应你的轻触")).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole("button", { name: "休息", exact: true }).tap();
  await page.screenshot({
    path: "test-results/mobile-landscape.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "创建我的纪念宠物" }).tap();
  await page.getByLabel("它的名字").fill("留下来的输入");
  await page.getByRole("button", { name: "进入它的小房间" }).tap();
  await page.getByRole("button", { name: "保存纪念房间" }).tap();
  await page.getByLabel("邮箱", { exact: true }).fill("offline@example.test");
  await context.setOffline(true);
  await page.getByRole("button", { name: "发送验证码" }).tap();
  await expect(page.locator("dialog .error")).toContainText("当前输入仍然保留");
  await context.setOffline(false);
  await page.getByRole("button", { name: "关闭弹窗" }).tap();
  await expect(
    page.getByRole("heading", { name: "留下来的输入的小房间" }),
  ).toBeVisible();
  await context.close();
  const broken = await browser.newContext();
  const p = await broken.newPage();
  await p.route("**/models/toon_cat_free.glb", (route) => route.abort());
  await p.goto(origin);
  await p.getByRole("button", { name: "先体验房间", exact: true }).click();
  await expect(p.getByRole("button", { name: "重新加载房间" })).toBeVisible();
  await p.unroute("**/models/toon_cat_free.glb");
  await p.getByRole("button", { name: "重新加载房间" }).click();
  await expect(p.locator("canvas")).toBeVisible();
  await broken.close();
  const noGL = await browser.newContext();
  const fallback = await noGL.newPage();
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof original>
    ) {
      if (String(args[0]).includes("webgl")) return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await fallback.goto(origin);
  await fallback
    .getByRole("button", { name: "先体验房间", exact: true })
    .click();
  await expect(fallback.getByText("当前设备无法显示 3D 房间。")).toBeVisible();
  await noGL.close();
});
test("upload retry preserves draft; photo and memory edits and deletion persist", async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: origin });
  await login(context.request, `upload-${randomUUID()}@example.test`);
  const page = await context.newPage();
  await page.goto("/");
  await page
    .getByRole("button", { name: "创建我的纪念宠物", exact: true })
    .click();
  await page.getByLabel("它的名字").fill("上传恢复");
  const image = await sharp({
    create: { width: 20, height: 20, channels: 3, background: "#ccbbaa" },
  })
    .png()
    .toBuffer();
  await page
    .locator('input[type=file][accept="image/jpeg,image/png,image/webp"]')
    .setInputFiles({ name: "cat.png", mimeType: "image/png", buffer: image });
  await page.getByRole("button", { name: "进入它的小房间" }).click();
  await page.route("**/api/photos", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "测试上传失败，请重试。" }),
    }),
  );
  await page.getByRole("button", { name: "保存纪念房间" }).click();
  await expect(page.getByText("测试上传失败，请重试。")).toBeVisible();
  await expect(page.getByLabel("名字", { exact: true })).toHaveValue(
    "上传恢复",
  );
  await expect(page.getByAltText("上传恢复的照片")).toBeVisible();
  await page.unroute("**/api/photos");
  await page.getByRole("button", { name: "保存纪念房间" }).click();
  await expect(
    page.getByText("已经保存，下次登录还可以继续探望。"),
  ).toBeVisible();
  const saved = await (await context.request.get("/api/pet")).json();
  await page.getByRole("button", { name: "删除照片", exact: true }).click();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByAltText("上传恢复的照片")).toBeHidden();
  expect(
    (await context.request.get(`/api/photos/${saved.pet.photoId}`)).status(),
  ).toBe(404);
  await expect(
    access(`.data/photos/${saved.pet.photoId}.webp`),
  ).rejects.toThrow();
  await page.getByRole("button", { name: "回忆 · 0" }).click();
  await page.getByLabel("记下一段回忆").fill("初稿");
  await page.getByRole("button", { name: "加入回忆" }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("编辑这段回忆").fill("修改后的回忆");
  await page.getByRole("button", { name: "完成编辑" }).click();
  await page.getByRole("button", { name: "保存纪念房间" }).click();
  await expect(
    page.getByText("已经保存，下次登录还可以继续探望。"),
  ).toBeVisible();
  expect(
    (await (await context.request.get("/api/pet")).json()).pet.memories[0].text,
  ).toBe("修改后的回忆");
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "保存纪念房间" }).click();
  await expect(
    page.getByText("已经保存，下次登录还可以继续探望。"),
  ).toBeVisible();
  expect(
    (await (await context.request.get("/api/pet")).json()).pet.memories,
  ).toEqual([]);
  await context.request.delete("/api/pet", { headers });
  await context.close();
});
test("reduced motion freezes both models and touch response changes actual pixels", async ({
  browser,
}) => {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    baseURL: origin,
  });
  const page = await context.newPage();
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "先体验房间", exact: true }).click();
  await expect(page.locator('[data-model-ready="toon"]')).toBeVisible({
    timeout: 20_000,
  });
  for (const name of ["小橘", "团团"]) {
    await page.clock.resume();
    await page.getByRole("radio", { name }).check();
    await expect(
      page.locator(
        `[data-model-ready="${name === "小橘" ? "toon" : "vuena"}"]`,
      ),
    ).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "走路", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "走路", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.clock.pauseAt(
      new Date((await page.evaluate(() => Date.now())) + 1000),
    );
    await page.clock.runFor(600);
    const canvas = page.locator("canvas");
    const a = await canvas.screenshot();
    await page.clock.runFor(250);
    expect((await canvas.screenshot()).equals(a)).toBe(true);
    await page.getByRole("button", { name: "摸摸它", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.clock.runFor(100);
    await expect(page.getByText("转过身，回应你的轻触")).toBeVisible();
    const response = await canvas.screenshot();
    expect(response.equals(a)).toBe(false);
    // A second press must not extend the original response timer.
    await page.keyboard.press("Enter");
    await page.clock.runFor(1550);
    await expect(page.getByText("慢慢走一走")).toBeVisible({ timeout: 2500 });
  }
  await context.close();
});

test("custom appearance persists across sessions, rejects invalid input and renders in the room", async ({ page, browser }) => {
  page.on("pageerror", error => console.log("room-page-error", error.message));
  const appearance = structuredClone(defaultCreatorDesign);
  appearance.shape.headWidth = 68;
  const email = `appearance-${randomUUID()}@example.test`;
  await login(page.request, email);
  const draft = { name: "定制小猫", model: "toon", personality: "安静", memories: [], photoId: null, version: 0, appearance };
  expect((await page.request.put("/api/pet", { headers, data: draft })).status()).toBe(200);
  const saved = (await (await page.request.get("/api/pet")).json()).pet;
  expect(saved.appearance).toEqual(appearance);
  const invalid = structuredClone(appearance);
  invalid.shape.headWidth = 101;
  expect((await page.request.put("/api/pet", { headers, data: { ...saved, appearance: invalid } })).status()).toBe(400);
  expect((await (await page.request.get("/api/pet")).json()).pet).toEqual(saved);
  await page.goto("/");
  await expect(page.locator("[data-model-ready='toon']")).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole("button", { name: "走路", exact: true })).toBeDisabled();
  await page.clock.install();
  await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 100));
  await page.getByRole("button", { name: "摸摸它", exact: true }).click();
  await page.clock.runFor(100);
  await expect(page.getByText("转过身，回应你的轻触", { exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/room-appearance/room.png", fullPage: true });
  await page.clock.resume();
  const other = await browser.newContext({ baseURL: origin });
  try {
    // A separate device verifies the same mailbox without copying cookies.
    await db.query("DELETE FROM challenges WHERE email=$1", [email]);
    await login(other.request, email);
    expect((await (await other.request.get(`${origin}/api/pet`)).json()).pet.appearance).toEqual(appearance);
    const stale = await other.request.put(`${origin}/api/pet`, { headers, data: { ...draft, appearance: null } });
    expect(stale.status()).toBe(409);
  } finally { await other.close(); }
  expect((await page.request.put("/api/pet", { headers, data: { ...saved, appearance: null } })).status()).toBe(200);
  await page.reload();
  await expect(page.getByRole("button", { name: "走路", exact: true })).toBeEnabled();
});

test("room model versions persist through legacy saves and reject unknown or mismatched assets", async ({ page }) => {
  await login(page.request, `asset-pin-${randomUUID()}@example.test`);
  const draft = { name: "版本猫", model: "toon", personality: "", memories: [], photoId: null, version: 0, appearance: defaultCreatorDesign };
  const response = await page.request.put("/api/pet", { headers, data: draft });
  expect(response.status()).toBe(200);
  const result = await response.json();
  const pinned = currentRoomAsset(defaultCreatorDesign);
  expect(result.appearanceAsset).toBe(pinned);
  for (const wrong of ["https://elsewhere.example/cat.glb", currentRoomAsset({ ...defaultCreatorDesign, coatType: "hairless" })]) {
    expect((await page.request.put("/api/pet", { headers, data: { ...draft, version: 1, appearanceAsset: wrong } })).status()).toBe(400);
  }
  const { appearance: omitted, ...legacy } = draft;
  expect((await page.request.put("/api/pet", { headers, data: { ...legacy, name: "旧客户端改名", version: 1 } })).status()).toBe(200);
  const saved = (await (await page.request.get("/api/pet")).json()).pet;
  expect(saved.appearanceAsset).toBe(pinned);
  expect(saved.appearance).toEqual(defaultCreatorDesign);
  expect(saved.name).toBe("旧客户端改名");
  await page.request.delete("/api/pet", { headers });
});
