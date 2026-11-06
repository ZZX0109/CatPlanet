import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const round = process.argv[2];
if (!/^round-[0-5]$/.test(round || ""))
  throw new Error("Pass round-0 to round-5");
const folder = path.resolve("artifacts/cat-refinement", round);
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 920 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const start = Date.now();
  await page.goto("http://localhost:3000/studio");
  await page.locator("[data-ready=true]").waitFor({ timeout: 90_000 });
  const loadMs = Date.now() - start;
  await page.getByRole("button", { name: "近看", exact: true }).click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(folder, "face.png") });
  await page.getByRole("button", { name: "全身", exact: true }).click();
  await page.screenshot({ path: path.join(folder, "stand.png") });
  await page.getByRole("button", { name: "趴卧", exact: true }).click();
  await page.getByRole("button", { name: "侧面", exact: true }).click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(folder, "rest-side.png") });
  await writeFile(
    path.join(folder, "review.json"),
    JSON.stringify(
      { round, loadMs, errors, viewport: { width: 1280, height: 920 } },
      null,
      2,
    ),
  );
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    `${round}: saved face, stand, rest-side; load ${loadMs}ms; no page errors`,
  );
} finally {
  await browser.close();
}
