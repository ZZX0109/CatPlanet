import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  defaultCreatorDesign,
  parseCreatorDesign,
  serializeCreatorDesign,
} from "../lib/cat-creator-design";
import { installNativeCoatInspection } from "./fixtures/native-coat-inspection.mjs";

const output = "artifacts/procedural-groom/verification";
const key = "miaoxing.cat-creator.foundation.v1";
const migratedShape = {
  ...defaultCreatorDesign.shape,
  headRound: 22,
  headWedge: 17,
  headWidth: 67,
  cheeks: 79,
  headFurDensity: 0,
  headFurLength: 100,
  ruffFurDensity: 37,
  ruffFurLength: 12,
  bodyFurDensity: 98,
  bodyFurLength: 55,
};
const oldV4 = {
  schemaVersion: 4,
  templateId: "cat-foundation-v1",
  coatType: "short",
  shape: migratedShape,
};
const oldV3 = {
  schemaVersion: 3,
  templateId: "norwegian-cat-v1",
  shape: migratedShape,
};

async function ready(page: Page, mode: "source" | "groom") {
  await page
    .locator(`[data-creator-ready="true"][data-creator-coat-mode="${mode}"]`)
    .waitFor({ timeout: 90000 });
}
async function inspect(page: Page) {
  // Mode changes intentionally replace the model/resource. Bind each ready model.
  await page.evaluate(installNativeCoatInspection);
  return await page.evaluate(() => (window as any).__nativeCoatCapture());
}
function assertSource(actual: any) {
  expect(actual.mode).toBe("source");
  expect(actual.preparedGroom).toBe(false);
  for (const region of Object.values(actual.stats) as any[]) {
    expect(region.capacity).toBe(0);
    expect(region.strands).toBe(0);
    expect(region.previewStrands).toBe(0);
  }
  expect(actual.draws.some((draw: any) => draw.native)).toBe(true);
  expect(
    actual.draws.filter(
      (draw: any) =>
        draw.furRegion ||
        draw.undercoat ||
        draw.volumeRegion ||
        /EarTufts/.test(draw.name),
    ),
  ).toEqual([]);
  expect(actual.draws.some((draw: any) => /Whiskers/.test(draw.name))).toBe(
    true,
  );
  for (const material of actual.materials.filter((m: any) => m.nativeCoat)) {
    expect(material.normalScale).toEqual(material.nativeCoat.sourceNormalScale);
    expect(material.roughness).toBe(material.nativeCoat.sourceRoughness);
    expect(material.metalness).toBe(0);
  }
  expect(actual.context.error).toBe(0);
  for (const program of actual.context.programs)
    expect(program.runnable).toBe(true);
}
function assertGroom(actual: any) {
  expect(actual.mode).toBe("groom");
  expect(actual.preparedGroom).toBe(true);
  for (const region of Object.values(actual.stats) as any[])
    expect(region.capacity).toBeGreaterThan(0);
  expect(actual.draws.some((draw: any) => draw.furRegion === "body")).toBe(
    true,
  );
  expect(actual.context.error).toBe(0);
  for (const program of actual.context.programs)
    expect(program.runnable).toBe(true);
}
async function exportSource(page: Page, name: string) {
  const summary = page.locator("summary").filter({ hasText: "备份与导出" });
  if (!(await summary.locator("..").getAttribute("open"))) {
    // Empty-string open attributes are valid, so inspect presence explicitly.
    if (
      !(await summary
        .locator("..")
        .evaluate((node) => node.hasAttribute("open")))
    )
      await summary.click();
  }
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出 3D 模型（GLB）", exact: true })
    .click();
  const download = await pending;
  const file = `${output}/${name}.glb`;
  await download.saveAs(file);
  const bytes = await readFile(file);
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
  const json = JSON.parse(
    bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
  );
  const nodes = json.nodes ?? [];
  const procedural = nodes.filter(
    (node: any) =>
      node.extras?.furRegion ||
      node.extras?.undercoat ||
      node.extras?.furVolumeRegion ||
      node.extras?.groomDetail === "earTufts",
  );
  expect(procedural).toEqual([]);
  expect(
    nodes.some((node: any) => node.extras?.groomDetail === "whiskers"),
  ).toBe(true);
  expect(json.skins.length).toBeGreaterThan(0);
  expect(json.images.length).toBeGreaterThan(0);
  const design = nodes.find((node: any) => node.extras?.miaoxingCreatorDesign)
    ?.extras.miaoxingCreatorDesign;
  expect(design.coatMode).toBe("source");
  return {
    file,
    byteLength: bytes.length,
    design,
    meshNames: nodes
      .filter((node: any) => node.mesh !== undefined)
      .map((node: any) => node.name),
    proceduralMeshes: procedural.length,
  };
}

test("schema5 defaults to full groom, preserves all legacy values and retains explicit v5 source", () => {
  expect(defaultCreatorDesign.schemaVersion).toBe(5);
  expect(defaultCreatorDesign.coatType).toBe("long");
  expect(defaultCreatorDesign.coatMode).toBe("groom");
  for (const [old, coatType] of [
    [oldV4, "short"],
    [{ ...oldV4, coatMode: "source" }, "short"],
    [{ ...oldV4, coatMode: "groom" }, "short"],
    [oldV3, "long"],
  ] as const) {
    const migrated = parseCreatorDesign(old);
    expect(migrated.schemaVersion).toBe(5);
    expect(migrated.coatMode).toBe("groom");
    expect(migrated.coatType).toBe(coatType);
    expect(migrated.shape).toEqual(migratedShape);
    for (const coatMode of ["source", "groom"] as const) {
      const design = { ...migrated, coatMode };
      expect(
        parseCreatorDesign(JSON.parse(serializeCreatorDesign(design))),
      ).toEqual(design);
    }
  }
  expect(() =>
    parseCreatorDesign({ ...defaultCreatorDesign, coatMode: "unknown" }),
  ).toThrow();
  const legacyMissingFur = { ...oldV3, shape: { ...oldV3.shape } };
  for (const key of [
    "headFurDensity",
    "headFurLength",
    "ruffFurDensity",
    "ruffFurLength",
    "bodyFurDensity",
    "bodyFurLength",
  ] as const)
    delete (legacyMissingFur.shape as Partial<typeof migratedShape>)[key];
  const filled = parseCreatorDesign(legacyMissingFur);
  expect(filled.shape.headWidth).toBe(migratedShape.headWidth);
  expect(filled.shape.headFurDensity).toBe(75);
  expect(filled.shape.headFurLength).toBe(40);
  expect(filled.shape.ruffFurLength).toBe(55);
  expect(filled.shape.bodyFurLength).toBe(45);
});

test("default full coat and explicit source exports switch without stale geometry or lost parameters", async ({
  page,
}) => {
  test.setTimeout(240000);
  await mkdir(output, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/studio/base");
  await ready(page, "groom");
  const defaultGroom = await inspect(page);
  assertGroom(defaultGroom);
  await page.getByRole("button", { name: "毛发", exact: true }).click();
  await expect(page.locator('input[id^="creator-"]')).toHaveCount(6);
  await page.getByRole("button", { name: "仅看原模型", exact: true }).click();
  await ready(page, "source");
  const source = await inspect(page);
  assertSource(source);
  expect(source.design.coatType).toBe("long");
  expect(Object.keys(source.textureContentHashes).length).toBeGreaterThan(0);
  await expect(page.locator('input[id^="creator-"]')).toHaveCount(0);
  const firstExport = await exportSource(page, "source-before-groom");
  await page.getByRole("button", { name: "完整被毛", exact: true }).click();
  await ready(page, "groom");
  await expect(page.locator('input[id^="creator-"]')).toHaveCount(6);
  const groom = await inspect(page);
  expect(groom.preparedGroom).toBe(true);
  expect(groom.draws.some((draw: any) => draw.furRegion === "body")).toBe(true);
  expect(groom.draws.some((draw: any) => draw.undercoat)).toBe(true);
  for (const region of Object.values(groom.stats) as any[])
    expect(region.capacity).toBeGreaterThan(0);
  expect(groom.textureContentHashes).toEqual(source.textureContentHashes);
  const eyeProperties = (snapshot: any) =>
    snapshot.materials
      .filter((material: any) =>
        /eye|iris|cornea|pupil/i.test(material.role ?? material.material),
      )
      .map((material: any) => ({
        mesh: material.mesh,
        role: material.role,
        normalScale: material.normalScale,
        roughness: material.roughness,
        metalness: material.metalness,
        clearcoat: material.clearcoat,
      }));
  expect(eyeProperties(groom)).toEqual(eyeProperties(source));
  for (const material of groom.materials.filter((m: any) => m.nativeCoat)) {
    expect(material.normalScale[0]).toBeCloseTo(
      material.nativeCoat.sourceNormalScale[0] * 0.85,
      6,
    );
    expect(material.normalScale[1]).toBeCloseTo(
      material.nativeCoat.sourceNormalScale[1] * 0.85,
      6,
    );
    expect(material.metalness).toBe(material.nativeCoat.sourceMetalness);
  }
  await page.locator("#creator-headFurDensity").press("Home");
  await page.locator("#creator-bodyFurLength").press("Home");
  for (let i = 0; i < 7; i++)
    await page.locator("#creator-bodyFurLength").press("ArrowRight");
  await page.getByRole("button", { name: "仅看原模型", exact: true }).click();
  await ready(page, "source");
  const sourceAgain = await inspect(page);
  assertSource(sourceAgain);
  expect(sourceAgain.design.shape.headFurDensity).toBe(0);
  expect(sourceAgain.design.shape.bodyFurLength).toBe(7);
  expect(sourceAgain.textureContentHashes).toEqual(source.textureContentHashes);
  const finalExport = await exportSource(page, "source-after-groom");
  expect(finalExport.design.shape.bodyFurLength).toBe(7);
  expect(finalExport.design.shape.headFurDensity).toBe(0);
  expect(finalExport.meshNames).toEqual(firstExport.meshNames);
  const afterExport = await inspect(page);
  assertSource(afterExport);
  await page.getByRole("button", { name: "保存外观", exact: true }).click();
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    key,
  );
  expect(saved.coatMode).toBe("source");
  expect(saved.schemaVersion).toBe(5);
  expect(saved.shape.bodyFurLength).toBe(7);
  await page.reload();
  await ready(page, "source");
  const restored = await inspect(page);
  assertSource(restored);
  expect(restored.design.shape).toEqual(saved.shape);
  expect(errors).toEqual([]);
  await writeFile(
    `${output}/source-groom-export.json`,
    JSON.stringify(
      {
        source,
        defaultGroom,
        groom,
        sourceAgain,
        firstExport,
        finalExport,
        afterExport,
        restored,
        errors,
      },
      null,
      2,
    ),
  );
});

for (const [name, value] of [
  ["v4", oldV4],
  ["v4-source", { ...oldV4, coatMode: "source" }],
  ["v3", oldV3],
] as const) {
  test(`old ${name} browser record restores full groom without overwriting face or fur values`, async ({
    page,
  }) => {
    const raw = JSON.stringify(value);
    await page.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), {
      key,
      raw,
    });
    await page.goto("/studio/base");
    await ready(page, "groom");
    const actual = await inspect(page);
    assertGroom(actual);
    expect(actual.design.schemaVersion).toBe(5);
    expect(actual.stats.head.strands).toBe(0);
    expect(actual.design.shape).toEqual(migratedShape);
    expect(actual.design.coatType).toBe(
      name.startsWith("v4") ? "short" : "long",
    );
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      raw,
    );
  });
}

test("phone touch and keyboard switch real coat resources with reachable controls in both orientations", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  try {
    await page.goto("/studio/base");
    await ready(page, "groom");
    assertGroom(await inspect(page));
    await page.getByRole("button", { name: "毛发", exact: true }).tap();
    await page.getByRole("button", { name: "仅看原模型", exact: true }).tap();
    await ready(page, "source");
    assertSource(await inspect(page));
    await page.getByRole("button", { name: "完整被毛", exact: true }).tap();
    await ready(page, "groom");
    const groom = await inspect(page);
    expect(groom.preparedGroom).toBe(true);
    expect(groom.draws.some((draw: any) => draw.furRegion === "body")).toBe(
      true,
    );
    const sourceButton = page.getByRole("button", {
      name: "仅看原模型",
      exact: true,
    });
    await sourceButton.focus();
    await sourceButton.press("Enter");
    await ready(page, "source");
    const source = await inspect(page);
    assertSource(source);
    const reachability = [];
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      for (const name of ["仅看原模型", "完整被毛"]) {
        const button = page.getByRole("button", { name, exact: true });
        await button.scrollIntoViewIfNeeded();
        const bounds = await button.evaluate((node) => {
          const r = node.getBoundingClientRect(),
            hit = document.elementFromPoint(
              r.x + r.width / 2,
              r.y + r.height / 2,
            );
          return {
            width: r.width,
            height: r.height,
            reachable: hit === node || node.contains(hit),
          };
        });
        expect(bounds.width).toBeGreaterThanOrEqual(44);
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        expect(bounds.reachable).toBe(true);
        reachability.push({ viewport, name, ...bounds });
      }
    }
    expect(errors).toEqual([]);
    await mkdir(output, { recursive: true });
    await writeFile(
      `${output}/phone-native-coat.json`,
      JSON.stringify(
        {
          groom,
          source,
          reachability,
          errors,
          inputEvidence:
            "Touch activates groom; Enter activates source. Real draw callbacks/prepared resources verified after each.",
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
  }
});
