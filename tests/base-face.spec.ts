import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { build } from "esbuild";
import sharp from "sharp";

const STORAGE_KEY = "miaoxing.tabby-face.v1";
const CONTROLS = [
  ["faceWidth", "脸部宽度"],
  ["cheeks", "脸颊饱满度"],
  ["muzzleLength", "口鼻长度"],
  ["eyeSize", "眼睛大小"],
  ["eyeSpacing", "眼睛间距"],
  ["earSize", "耳朵大小"],
  ["earSpacing", "耳朵间距"],
  ["noseWidth", "鼻子宽度"],
] as const;

type MorphProbe = {
  meshes: {
    name: string;
    vertices: number;
    targets: Record<string, { influence: number; maxDelta: number }>;
    changedVertices: number;
    maxDisplacement: number;
    bounds: number[];
    finite: boolean;
  }[];
  embeddedImages: number;
  colorMappedMaterials: number;
};

let probeBundle: Promise<string> | undefined;

// This code is injected only by Playwright. Re-import the actual downloaded GLB
// through a test route, keeping binary data out of page.evaluate/base64 copies.
function browserProbeBundle() {
  return (probeBundle ??= build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "js",
      contents: `
        import * as THREE from 'three';
        import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
        window.__verifyBaseFaceGlb = async url => {
          const response = await fetch(url);
          if (!response.ok) throw new Error('Test GLB route was unavailable');
          const bytes = await response.arrayBuffer();
          const loaded = await new GLTFLoader().parseAsync(bytes, '');
          const meshes = [], geometries = new Set(), materials = new Set(), textures = new Set(), images = new Set();
          loaded.scene.updateMatrixWorld(true);
          loaded.scene.traverse(mesh => {
            if (!mesh.isMesh) return;
            geometries.add(mesh.geometry);
            for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
              materials.add(material);
              for (const value of Object.values(material)) if (value && value.isTexture) {
                textures.add(value); if (value.image) images.add(value.image);
              }
            }
            const dictionary = mesh.morphTargetDictionary || {};
            if (!Object.keys(dictionary).some(name => name.startsWith('TabbyFace_'))) return;
            const base = mesh.geometry.getAttribute('position');
            const attributes = mesh.geometry.morphAttributes.position || [];
            const targets = {};
            let finite = true;
            for (const [name, index] of Object.entries(dictionary)) {
              const target = attributes[index];
              if (!target || target.count !== base.count) throw new Error('Mismatched morph vertex count');
              let maxDelta = 0;
              for (let i = 0; i < target.count; i++) {
                let x = target.getX(i), y = target.getY(i), z = target.getZ(i);
                if (!mesh.geometry.morphTargetsRelative) { x -= base.getX(i); y -= base.getY(i); z -= base.getZ(i); }
                finite &&= Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
                maxDelta = Math.max(maxDelta, Math.hypot(x, y, z));
              }
              targets[name] = { influence: mesh.morphTargetInfluences[index], maxDelta };
            }
            let changedVertices = 0, maxDisplacement = 0;
            const bounds = new THREE.Box3(), point = new THREE.Vector3();
            for (let i = 0; i < base.count; i++) {
              mesh.getVertexPosition(i, point);
              const distance = Math.hypot(point.x - base.getX(i), point.y - base.getY(i), point.z - base.getZ(i));
              finite &&= Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
              if (distance > 1e-6) changedVertices++;
              maxDisplacement = Math.max(maxDisplacement, distance);
              bounds.expandByPoint(point.applyMatrix4(mesh.matrixWorld));
            }
            meshes.push({ name: mesh.name, vertices: base.count, targets, changedVertices, maxDisplacement,
              bounds: bounds.getSize(new THREE.Vector3()).toArray(), finite });
          });
          const result = { meshes, embeddedImages: images.size,
            colorMappedMaterials: [...materials].filter(material => material.map && material.map.image).length };
          for (const geometry of geometries) geometry.dispose();
          for (const material of materials) material.dispose();
          for (const texture of textures) texture.dispose();
          for (const image of images) if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
          return result;
        };
      `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
  }).then((result) => result.outputFiles[0].text));
}

async function ready(page: Page) {
  await expect(page.locator('[data-review-ready="true"]')).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator('[data-review-cat="tabby"]')).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
}

async function rendered(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function pixelsChanged(before: Buffer, after: Buffer) {
  const [first, second] = await Promise.all(
    [before, after].map((buffer) =>
      sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    ),
  );
  expect(second.info.width).toBe(first.info.width);
  expect(second.info.height).toBe(first.info.height);
  let changed = 0;
  for (let i = 0; i < first.data.length; i += 4) {
    if (
      Math.max(
        Math.abs(first.data[i] - second.data[i]),
        Math.abs(first.data[i + 1] - second.data[i + 1]),
        Math.abs(first.data[i + 2] - second.data[i + 2]),
      ) > 5
    )
      changed++;
  }
  return changed;
}

async function exportGlb(page: Page, info: TestInfo, name: string) {
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出 3D 模型（GLB）", exact: true })
    .click();
  const download = await downloading;
  const path = info.outputPath(name + ".glb");
  await download.saveAs(path);
  const buffer = await readFile(path);
  expect(buffer.readUInt32LE(0)).toBe(0x46546c67);
  expect(buffer.readUInt32LE(8)).toBe(buffer.byteLength);
  const json = JSON.parse(
    buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString(),
  );
  expect(json.images.length).toBeGreaterThanOrEqual(1);
  expect(
    json.images.every((image: { bufferView?: number }) =>
      Number.isInteger(image.bufferView),
    ),
  ).toBe(true);
  await page.addScriptTag({ content: await browserProbeBundle() });
  const route = "**/__test_base_face_roundtrip.glb";
  await page.route(route, (request) =>
    request.fulfill({ body: buffer, contentType: "model/gltf-binary" }),
  );
  try {
    return await page.evaluate(async () => {
      const probe = (
        window as unknown as {
          __verifyBaseFaceGlb: (url: string) => Promise<MorphProbe>;
        }
      ).__verifyBaseFaceGlb;
      return probe("/__test_base_face_roundtrip.glb");
    });
  } finally {
    await page.unroute(route);
  }
}

function checkMorphs(probe: MorphProbe, value: 0 | 50 | 100) {
  expect(probe.embeddedImages).toBeGreaterThanOrEqual(1);
  expect(probe.meshes.length).toBeGreaterThanOrEqual(1);
  for (const mesh of probe.meshes) {
    expect(mesh.finite).toBe(true);
    expect(
      mesh.bounds.every((n) => Number.isFinite(n) && n > 0.1 && n < 4),
    ).toBe(true);
    for (const [key] of CONTROLS) {
      const low = mesh.targets[`TabbyFace_${key}_low`];
      const high = mesh.targets[`TabbyFace_${key}_high`];
      expect(low, key + " low target").toBeDefined();
      expect(high, key + " high target").toBeDefined();
      expect(low.maxDelta).toBeGreaterThan(1e-6);
      expect(high.maxDelta).toBeGreaterThan(1e-6);
      expect(low.influence).toBeCloseTo(value === 0 ? 1 : 0, 5);
      expect(high.influence).toBeCloseTo(value === 100 ? 1 : 0, 5);
    }
    if (value === 50) expect(mesh.changedVertices).toBe(0);
    else {
      expect(mesh.changedVertices).toBeGreaterThan(20);
      expect(mesh.changedVertices).toBeLessThan(mesh.vertices * 0.6);
      expect(mesh.maxDisplacement).toBeGreaterThan(0.001);
    }
  }
}

test("base cat changes real rendered geometry and preserves saved/imported/exported face settings", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/studio/base?legacy=1");
  await ready(page);
  const neutral = await exportGlb(page, info, "neutral");
  checkMorphs(neutral, 50);
  await page.getByRole("button", { name: "脸部近看", exact: true }).click();
  const width = page.getByRole("slider", { name: "脸部宽度", exact: true });
  await width.focus();
  await rendered(page);
  const before = await page
    .locator("canvas")
    .screenshot({ path: info.outputPath("desktop-neutral-face.png") });
  await page.keyboard.press("End");
  await expect(width).toHaveValue("100");
  await rendered(page);
  const widened = await page
    .locator("canvas")
    .screenshot({ path: info.outputPath("desktop-wide-face.png") });
  expect(await pixelsChanged(before, widened)).toBeGreaterThan(100);
  await page.screenshot({
    path: info.outputPath("desktop-face-editor.png"),
    fullPage: true,
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await rendered(page);
  await page.screenshot({
    path: info.outputPath("desktop-viewport.png"),
    fullPage: false,
  });
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(width).toHaveValue("50");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(width).toHaveValue("100");
  await page
    .getByRole("slider", { name: "脸颊饱满度", exact: true })
    .press("Home");
  await page
    .getByRole("slider", { name: "眼睛大小", exact: true })
    .press("End");
  await page.getByRole("button", { name: "保存外观", exact: true }).click();
  const stored = await page.evaluate(
    (key) => localStorage.getItem(key),
    STORAGE_KEY,
  );
  expect(stored).not.toBeNull();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出外观 JSON", exact: true })
    .click();
  const download = await downloading;
  const appearancePath = info.outputPath("appearance.json");
  await download.saveAs(appearancePath);
  const appearance = await readFile(appearancePath);
  const design = JSON.parse(appearance.toString());
  expect(design.shape.faceWidth).toBe(100);
  expect(design.shape.cheeks).toBe(0);
  expect(design.shape.eyeSize).toBe(100);
  const modelRoute = "**/models/review/tabby-web.glb";
  await page.route(modelRoute, (route) => route.abort("failed"));
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "这只猫暂时没有加载成功", exact: true }),
  ).toBeVisible();
  await expect(width).toHaveValue("100");
  await expect(
    page.getByRole("slider", { name: "脸颊饱满度", exact: true }),
  ).toHaveValue("0");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
  ).toBe(stored);
  await page.unroute(modelRoute);
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await ready(page);
  await expect(width).toHaveValue("100");
  await expect(
    page.getByRole("slider", { name: "脸颊饱满度", exact: true }),
  ).toHaveValue("0");
  await expect(
    page.getByRole("slider", { name: "眼睛大小", exact: true }),
  ).toHaveValue("100");

  const importer = page.getByLabel("导入外观 JSON", { exact: true });
  for (const [name, contents] of [
    ["unsupported.json", JSON.stringify({ ...design, schemaVersion: 99 })],
    [
      "out-of-range.json",
      JSON.stringify({ ...design, shape: { ...design.shape, faceWidth: 101 } }),
    ],
  ]) {
    await importer.setInputFiles({
      name,
      mimeType: "application/json",
      buffer: Buffer.from(contents),
    });
    await expect(
      page.getByRole("alert").filter({ hasText: "当前调整已保留" }),
    ).toBeVisible();
    await expect(width).toHaveValue("100");
    await expect(
      page.getByRole("slider", { name: "脸颊饱满度", exact: true }),
    ).toHaveValue("0");
    expect(
      await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
    ).toBe(stored);
  }
  await page.getByRole("button", { name: "重置捏脸", exact: true }).click();
  for (const [, label] of CONTROLS)
    await expect(
      page.getByRole("slider", { name: label, exact: true }),
    ).toHaveValue("50");
  await importer.setInputFiles({
    name: "appearance.json",
    mimeType: "application/json",
    buffer: appearance,
  });
  await expect(width).toHaveValue("100");
  await page.getByText("观察工具", { exact: true }).click();
  const grey = page.getByRole("checkbox", { name: /灰材质/ });
  await grey.check();
  await rendered(page);
  await page.locator("canvas").screenshot({
    path: info.outputPath("desktop-grey-face.png"),
  });
  const customized = await exportGlb(page, info, "customized");
  expect(customized.colorMappedMaterials).toBeGreaterThan(0);
  expect(customized.embeddedImages).toBe(neutral.embeddedImages);
  expect(customized.meshes.length).toBeGreaterThanOrEqual(1);
  for (const mesh of customized.meshes) {
    expect(mesh.finite).toBe(true);
    expect(mesh.changedVertices).toBeGreaterThan(20);
    expect(mesh.changedVertices).toBeLessThan(mesh.vertices * 0.6);
    expect(mesh.maxDisplacement).toBeGreaterThan(0.001);
    expect(mesh.targets.TabbyFace_faceWidth_high.influence).toBeCloseTo(1, 5);
    expect(mesh.targets.TabbyFace_cheeks_low.influence).toBeCloseTo(1, 5);
    expect(mesh.targets.TabbyFace_eyeSize_high.influence).toBeCloseTo(1, 5);
    expect(mesh.targets.TabbyFace_earSize_high.influence).toBe(0);
  }
  await grey.uncheck();
  expect(errors).toEqual([]);
  await mkdir("artifacts/tabby-face-studio", { recursive: true });
  for (const name of [
    "desktop-neutral-face.png",
    "desktop-wide-face.png",
    "desktop-face-editor.png",
    "desktop-viewport.png",
    "desktop-grey-face.png",
  ])
    await copyFile(
      info.outputPath(name),
      "artifacts/tabby-face-studio/" + name,
    );
});

test("mobile native touch, keyboard and combined face extremes stay usable and finite", async ({
  browser,
}, info) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://localhost:3000/studio/base?legacy=1");
    await ready(page);
    await page.getByRole("button", { name: "脸部近看", exact: true }).tap();
    await rendered(page);
    const canvas = page.locator("canvas");
    await canvas.scrollIntoViewIfNeeded();
    const beforeTouch = await canvas.screenshot();
    const rectangle = await canvas.boundingBox();
    expect(rectangle).not.toBeNull();
    const x = rectangle!.x + rectangle!.width * 0.45;
    const y = rectangle!.y + rectangle!.height * 0.5;
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (const movement of [15, 30, 50])
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + movement, y }],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
    await rendered(page);
    expect(
      await pixelsChanged(beforeTouch, await canvas.screenshot()),
    ).toBeGreaterThan(100);
    const region = page.locator('[data-review-ready="true"]');
    await region.focus();
    const beforeKey = await canvas.screenshot();
    await page.keyboard.press("ArrowLeft");
    await rendered(page);
    expect(
      await pixelsChanged(beforeKey, await canvas.screenshot()),
    ).toBeGreaterThan(100);
    const width = page.getByRole("slider", { name: "脸部宽度", exact: true });
    await width.scrollIntoViewIfNeeded();
    const slider = await width.boundingBox();
    expect(slider).not.toBeNull();
    await page.touchscreen.tap(
      slider!.x + slider!.width * 0.9,
      slider!.y + slider!.height / 2,
    );
    expect(Number(await width.inputValue())).toBeGreaterThan(70);
    await width.press("Home");
    await expect(width).toHaveValue("0");
    await width.press("End");
    await expect(width).toHaveValue("100");
    await page.getByRole("button", { name: "脸部近看", exact: true }).tap();
    await width.scrollIntoViewIfNeeded();
    await width.focus();
    await rendered(page);
    await page.screenshot({
      path: info.outputPath("mobile-editor.png"),
      fullPage: false,
    });
    for (const extreme of [0, 100] as const) {
      for (const [, label] of CONTROLS)
        await page
          .getByRole("slider", { name: label, exact: true })
          .press(extreme === 0 ? "Home" : "End");
      checkMorphs(
        await exportGlb(page, info, "mobile-all-" + extreme),
        extreme,
      );
    }
    await page.getByRole("button", { name: "重置捏脸", exact: true }).tap();
    for (const [, label] of CONTROLS)
      await expect(
        page.getByRole("slider", { name: label, exact: true }),
      ).toHaveValue("50");
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
      for (const name of ["保存外观", "重置捏脸"]) {
        const button = page.getByRole("button", { name, exact: true });
        await button.scrollIntoViewIfNeeded();
        expect(
          await button.evaluate((node) => {
            const box = node.getBoundingClientRect();
            const top = document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2,
            );
            return top === node || node.contains(top);
          }),
        ).toBe(true);
      }
    }
    expect(errors).toEqual([]);
    await mkdir("artifacts/tabby-face-studio", { recursive: true });
    await copyFile(
      info.outputPath("mobile-editor.png"),
      "artifacts/tabby-face-studio/mobile-editor.png",
    );
  } finally {
    await context.close();
  }
});
