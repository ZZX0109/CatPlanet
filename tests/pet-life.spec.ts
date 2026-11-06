import { test, expect, type BrowserContext } from "@playwright/test";
import { createHmac, randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const origin = "http://localhost:3000";
const headers = { Origin: origin };
const owners: string[] = [];
test.beforeAll(() => {
  const url = new URL(process.env.DATABASE_URL!);
  if (url.hostname !== "127.0.0.1" || url.port !== "54329" || url.pathname !== "/miaoxing") throw new Error("Dedicated local database required");
});
test.afterEach(async () => {
  for (const id of owners.splice(0)) await db.query("DELETE FROM users WHERE id=$1", [id]);
});
test.afterAll(() => db.end());
async function account(context: BrowserContext, save = true) {
  const id = randomUUID(); owners.push(id);
  const token = randomBytes(32).toString("base64url");
  const hash = createHmac("sha256", process.env.AUTH_SECRET!).update(token).digest("hex");
  await db.query("INSERT INTO users(id,email) VALUES($1,$2)", [id, `life-${id}@example.test`]);
  await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')", [hash, id]);
  await context.addCookies([{ name: "miaoxing_session", value: token, url: origin, httpOnly: true, sameSite: "Lax" }]);
  if (save) expect((await context.request.put(`${origin}/api/pet`, { headers, data: {
    name: "日记小猫", model: "vuena", personality: "喜欢看窗外", memories: [{ id: randomUUID(), text: "生前爱睡在我的枕头边" }], photoId: null, version: 0,
  } })).status()).toBe(200);
  return id;
}

test("offline activities catch up once, remain separate from real memories, and are owner scoped", async ({ page, browser }) => {
  const id = await account(page.context(), false);
  expect((await page.request.post("/api/life/visit", { headers })).status()).toBe(404);
  expect((await page.request.put("/api/pet", { headers, data: { name: "日记小猫", model: "toon", personality: "", memories: [], photoId: null, version: 0 } })).status()).toBe(200);
  const first = await (await page.request.post("/api/life/visit", { headers })).json();
  expect(first.life.days.flatMap((day: any) => day.events)).toHaveLength(1);
  await db.query("UPDATE pet_life SET last_slot=last_slot-48,started_at=now()-interval '3 days' WHERE user_id=$1", [id]);
  const after = await (await page.request.post("/api/life/visit", { headers, data: { now: "2099-01-01", userId: randomUUID() } })).json();
  expect(after.life.days.length).toBeGreaterThanOrEqual(2);
  expect(after.life.days.every((day: any) => day.source === "WORLD_STORY" && day.events.every((event: any) => event.source === "WORLD_STORY"))).toBe(true);
  const count = Number((await db.query("SELECT count(*) FROM pet_life_events WHERE user_id=$1", [id])).rows[0].count);
  expect(count).toBe(48);
  const visits = await Promise.all(Array.from({ length: 3 }, () => page.request.post("/api/life/visit", { headers })));
  expect(visits.every(response => response.ok())).toBe(true);
  expect(Number((await db.query("SELECT count(*) FROM pet_life_events WHERE user_id=$1", [id])).rows[0].count)).toBe(count);
  expect((await (await page.request.get("/api/pet")).json()).pet.memories).toEqual([]);
  expect((await page.request.post("/api/life/visit", { headers: { Origin: "https://elsewhere.example" } })).status()).toBe(403);
  const stranger = await browser.newContext({ baseURL: origin });
  try {
    expect((await stranger.request.get("/api/life")).status()).toBe(401);
    await account(stranger);
    expect((await stranger.request.get(`/api/life?userId=${id}`)).status()).toBe(404);
    const other = await (await stranger.request.post("/api/life/visit", { headers })).json();
    expect(other.life.days.flatMap((day: any) => day.events)).toHaveLength(1);
  } finally { await stranger.close(); }
});

test("long absences are bounded, old logs pruned and deleting a pet deletes its life", async ({ page }) => {
  const id = await account(page.context());
  await page.request.post("/api/life/visit", { headers });
  await db.query("UPDATE pet_life SET last_slot=last_slot-1080,started_at=now()-interval '46 days' WHERE user_id=$1", [id]);
  await db.query("INSERT INTO pet_life_events(user_id,slot,action,occurred_at) SELECT user_id,last_slot,'sleep',now()-interval '45 days' FROM pet_life WHERE user_id=$1", [id]);
  const response = await page.request.post("/api/life/visit", { headers });
  expect(response.status()).toBe(200);
  const { life } = await response.json();
  expect(life.catchUpLimited).toBe(true);
  expect(life.days).toHaveLength(7);
  expect(Number((await db.query("SELECT count(*) FROM pet_life_events WHERE user_id=$1", [id])).rows[0].count)).toBe(168);
  const get = await (await page.request.get("/api/life")).json();
  expect(get.life.days).toEqual(life.days);
  expect((await page.request.delete("/api/pet", { headers })).status()).toBe(200);
  for (const table of ["pet_life", "pet_life_events"]) expect(Number((await db.query(`SELECT count(*) FROM ${table} WHERE user_id=$1`, [id])).rows[0].count)).toBe(0);
  expect((await page.request.get("/api/life")).status()).toBe(404);
});

test("diary UI labels fiction, preserves it on a failed refresh and survives a new visit", async ({ page }) => {
  await account(page.context());
  await page.goto("/");
  await page.getByRole("button", { name: "生活日记", exact: true }).click();
  await expect(page.getByRole("heading", { name: "日记小猫的生活日记", exact: true })).toBeVisible();
  const panel = page.getByRole("region", { name: "生活日记" });
  await expect(panel.getByText("喵星虚拟故事", { exact: true }).first()).toBeVisible();
  await expect(panel.locator(".life-day")).toHaveCount(1);
  await page.route("**/api/life/visit", route => route.fulfill({ status: 503, json: { error: "测试连接中断，日记仍保留。" } }));
  await page.getByRole("button", { name: "更新生活日记", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("测试连接中断");
  await expect(panel.locator(".life-day")).toHaveCount(1);
  await page.unroute("**/api/life/visit");
  await page.getByRole("button", { name: "更新生活日记", exact: true }).click();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "回忆 · 1", exact: true }).click();
  await expect(page.getByText("生前爱睡在我的枕头边", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "生活日记", exact: true }).click();
  await expect(panel.locator(".life-day")).toHaveCount(1);
  await expect(page.locator('[data-model-ready="vuena"]')).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: "artifacts/local-room/life-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole("button", { name: "展开纪念资料", exact: true }).click();
  await expect(panel.getByRole("button", { name: "更新生活日记", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "artifacts/local-room/life-mobile.png", fullPage: true });
});
