/** Isolated review runner. Never writes model assets or database records. */
import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative, join, isAbsolute, dirname } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { catVisualScenario } from "../lib/cat-visual-validation";
import { defaultCreatorDesign, parseCreatorDesign } from "../lib/cat-creator-design";

async function main() {
const args = process.argv.slice(2);
function option(name: string) { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; }
const design = parseCreatorDesign(option("--design") ? JSON.parse(await readFile(option("--design")!, "utf8")) : defaultCreatorDesign);
const origin = option("--origin") ?? "http://127.0.0.1:3000";
const destination = resolve(option("--output") ?? `artifacts/cat-visual-${Date.now()}`);
const child = relative(resolve("artifacts"), destination);
if (!child || child.startsWith("..") || isAbsolute(child)) throw new Error("Visual output must be a NEW directory under artifacts/");
const stages = ["creator", "roundtrip", "room"];
const views = Object.keys(catVisualScenario.views);
const plan = { scenario: catVisualScenario, design, stages, views, output: destination,
  blender: option("--blender-report") ?? "missing: use render-cat-validation.py with the approved source .blend" };
if (args.includes("--dry-run")) { console.log(JSON.stringify(plan, null, 2)); process.exit(0); }
await mkdir(resolve("artifacts"), { recursive: true });
await mkdir(destination); // Refuse reuse, so screenshots/results cannot be stale.
const browser = await chromium.launch({ executablePath: option("--browser") || undefined, headless: true,
  args: ["--enable-unsafe-swiftshader", "--no-sandbox"] });
const records: Record<string, any> = {};
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 1 });
  for (const stage of stages) for (const view of views) {
    const key = `${stage}-${view}`;
    try {
      const query = new URLSearchParams({ stage, view, design: JSON.stringify(design) });
      await page.goto(`${origin}/studio/validation?${query}`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => {
        const value = document.querySelector("[data-visual-report]")?.textContent;
        return value && JSON.parse(value).status !== "loading";
      }, undefined, { timeout: 90_000 });
      const record = JSON.parse((await page.locator("[data-visual-report]").textContent())!);
      if (record.status === "rendered") {
        const file = join(destination, `${key}.png`);
        await page.locator("canvas").screenshot({ path: file });
        record.image = { file, sha256: createHash("sha256").update(await readFile(file)).digest("hex") };
      }
      records[key] = record;
    } catch (error) { records[key] = { status: "blocked", error: String(error) }; }
  }
} finally { await browser.close(); }
const comparisons: object[] = [];
for (const view of views) for (const other of ["roundtrip", "room"]) {
  const left = records[`creator-${view}`], right = records[`${other}-${view}`];
  if (!left?.image || !right?.image) { comparisons.push({ view, pair: ["creator", other], status: "blocked" }); continue; }
  const a = await sharp(left.image.file).removeAlpha().raw().toBuffer();
  const b = await sharp(right.image.file).removeAlpha().raw().toBuffer();
  if (a.length !== b.length) throw new Error("Comparison image dimensions differ");
  let absolute = 0;
  for (let i = 0; i < a.length; i++) absolute += Math.abs(a[i] - b[i]);
  comparisons.push({ view, pair: ["creator", other], status: "measured-not-approved", meanAbsoluteChannelDifference: absolute / a.length,
    leftDecoded: left.decoded, rightDecoded: right.decoded,
    caveat: "Inspect hair coverage, materials, bones and deformation; pixel similarity is not visual approval." });
}
let blender: any = { status: "unrun", reason: "Approved source Blender assets are not available by default." };
if (option("--blender-report")) {
  try {
    const reportPath = resolve(option("--blender-report")!);
    blender = JSON.parse(await readFile(reportPath, "utf8"));
    if (blender.fixtureOnly) throw new Error("Synthetic Blender fixture cannot certify production cat appearance");
    if (blender.status !== "rendered-not-approved" || JSON.stringify(blender.scenario) !== JSON.stringify(catVisualScenario) || JSON.stringify(blender.design) !== JSON.stringify(design))
      throw new Error("Blender evidence has an incomplete status or different scenario/design");
    for (const view of views) {
      const image = blender.images?.[view];
      if (!image || !/^[a-f0-9]{64}$/.test(image.sha256)) throw new Error("Missing Blender image digest");
      const file = resolve(image.file);
      const rel = relative(dirname(reportPath), file);
      if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Blender image must be alongside its report");
      const bytes = await readFile(file);
      if (createHash("sha256").update(bytes).digest("hex") !== image.sha256) throw new Error("Blender image digest mismatch");
      const meta = await sharp(bytes).metadata();
      if (meta.width !== catVisualScenario.width || meta.height !== catVisualScenario.height) throw new Error("Blender image dimensions differ");
      const web = records[`creator-${view}`];
      if (web?.image) {
        const a = await sharp(web.image.file).removeAlpha().raw().toBuffer();
        const b = await sharp(bytes).removeAlpha().raw().toBuffer();
        if (a.length !== b.length) throw new Error("Blender color channel layout differs");
        let absolute = 0;
        for (let i = 0; i < a.length; i++) absolute += Math.abs(a[i] - b[i]);
        comparisons.push({ view, pair: ["blender", "creator"], status: "measured-not-approved", meanAbsoluteChannelDifference: absolute / a.length,
          caveat: "Nominal shared settings do not make Cycles hair BSDF and Three shaders physically equivalent." });
      }
    }
    blender.imageHashesVerified = true;
  } catch (error) { blender = { status: "invalid", error: String(error) }; }
}
const status = !Object.values(records).every(record => record.status === "rendered") ? "blocked"
  : blender.imageHashesVerified ? "measured-not-approved" : "web-measured-blender-unverified";
await writeFile(join(destination, "validation.json"), JSON.stringify({ ...plan, status, records, comparisons, blender,
  approved: false, limitations: ["Blender and Three BSDF/light energy differ even under shared nominal settings.",
    "Shared review stage exercises loading/design/export, not the production room's warm lighting or compositor.",
    "Native Blender curves are not asserted to survive GLB; inspect groom representation and static versus animated binding separately."] }, null, 2));
console.log(`${status}: ${join(destination, "validation.json")}`);
if (status !== "measured-not-approved") process.exitCode = 1;

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
