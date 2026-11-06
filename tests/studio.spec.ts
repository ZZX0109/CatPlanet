import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

type CatGlbProbe = {
  bones: number;
  bodyMorphCount: number;
  hasShapeWeights: boolean;
  eyelidTargetCount: number;
  embeddedImages: number;
  poses: {
    name: string;
    bounds: number[];
    eyeScales: number[][];
    eyelidClosures: number[];
    restFold: number;
    shapeWeights: number[];
  }[];
  transition: { bounds: number[]; restFold: number; shapeWeights: number[] };
};

// Keep the roundtrip in a real browser: the exported iris maps are embedded PNGs,
// which need browser image decoding. This probe is bundled in memory for tests only.
async function browserGlbProbe() {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "js",
      contents: `
        import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
        import * as THREE from 'three';
        window.__verifyCatGlb = async function(url) {
          const bytes = await (await fetch(url)).arrayBuffer();
          const loaded = await new GLTFLoader().parseAsync(bytes, '');
          const body = loaded.scene.getObjectByName('CatBody');
          if (!body || !body.isSkinnedMesh) throw new Error('CatBody did not roundtrip as a skinned mesh');
          const eyes = [], lids = [], images = new Set(), materials = new Set(), geometries = new Set(), skeletons = new Set();
          let eyelidTargetCount = 0;
          loaded.scene.traverse(object => {
            if (/^Eye(?:L|R|-?1)$/.test(object.name)) eyes.push(object);
            if (object.morphTargetDictionary && 'eyelidClosure' in object.morphTargetDictionary) { eyelidTargetCount++; lids.push(object); }
            if (!object.isMesh) return;
            geometries.add(object.geometry);
            if (object.isSkinnedMesh) skeletons.add(object.skeleton);
            for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
              materials.add(material);
              if (material.map && material.map.image) images.add(material.map.image);
            }
          });
          const mixer = new THREE.AnimationMixer(loaded.scene), poses = [];
          for (const clip of loaded.animations) {
            mixer.stopAllAction(); mixer.clipAction(clip).play(); mixer.update(.5);
            loaded.scene.updateMatrixWorld(true); body.computeBoundingBox();
            poses.push({ name: clip.name, bounds: body.boundingBox.getSize(new THREE.Vector3()).toArray(), eyeScales: eyes.map(eye => eye.scale.toArray()), eyelidClosures: lids.map(lid => lid.morphTargetInfluences[lid.morphTargetDictionary.eyelidClosure]), restFold: body.morphTargetInfluences[body.morphTargetDictionary.restFold], shapeWeights: body.morphTargetInfluences.slice(0, 7) });
          }
          // Blend both exported actions at the midpoint, checking the corrective
          // remains finite and does not overwrite the owner's seven shape values.
          mixer.stopAllAction();
          mixer.clipAction(loaded.animations.find(clip => clip.name === 'stand')).setEffectiveWeight(.5).play();
          mixer.clipAction(loaded.animations.find(clip => clip.name === 'rest')).setEffectiveWeight(.5).play();
          mixer.update(.5); loaded.scene.updateMatrixWorld(true); body.computeBoundingBox();
          const transition = { bounds: body.boundingBox.getSize(new THREE.Vector3()).toArray(), restFold: body.morphTargetInfluences[body.morphTargetDictionary.restFold], shapeWeights: body.morphTargetInfluences.slice(0, 7) };
          const result = {
            bones: body.skeleton.bones.length,
            bodyMorphCount: body.morphTargetInfluences.length,
            hasShapeWeights: body.morphTargetInfluences.slice(0, 7).some(value => value !== 0),
            eyelidTargetCount, embeddedImages: images.size, poses, transition,
          };
          mixer.stopAllAction(); mixer.uncacheRoot(loaded.scene);
          for (const geometry of geometries) geometry.dispose();
          const textures = new Set();
          for (const material of materials) { if (material.map) textures.add(material.map); material.dispose(); }
          for (const texture of textures) texture.dispose();
          for (const skeleton of skeletons) skeleton.dispose();
          return result;
        };
      `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
  });
  return result.outputFiles[0].text;
}
test("real geometry changes, undo, local save, import and animated GLB export", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/studio");
  await expect(page.locator("[data-ready=true]")).toBeVisible({
    timeout: 60_000,
  });
  const before = await page.locator("canvas").screenshot();
  const slider = page.getByRole("slider", { name: "脸部宽度" });
  await slider.focus();
  await page.keyboard.press("End");
  await slider.blur();
  await expect(slider).toHaveValue("100");
  await page.waitForTimeout(500);
  expect((await page.locator("canvas").screenshot()).equals(before)).toBe(
    false,
  );
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(slider).toHaveValue("50");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(slider).toHaveValue("100");
  await page.getByRole("button", { name: "毛色", exact: true }).click();
  await page.getByLabel("毛色样式").selectOption("calico");
  await page.getByRole("button", { name: "保存外观", exact: true }).click();
  await page.reload();
  await expect(page.locator("[data-ready=true]")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("slider", { name: "脸部宽度" })).toHaveValue(
    "100",
  );
  await page.getByRole("button", { name: "趴卧", exact: true }).click();
  await page.screenshot({ path: "test-results/studio-rest.png" });
  await page.getByRole("button", { name: "走路", exact: true }).click();
  await page.screenshot({ path: "test-results/studio-walk.png" });
  await page.getByText("外观文件与模型", { exact: true }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schemaVersion":99}'),
  });
  await expect(page.locator(".studio-error")).toContainText(
    "这不是受支持的猫咪外观文件",
  );
  await expect(page.getByRole("slider", { name: "脸部宽度" })).toHaveValue(
    "100",
  );
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 3D 模型（GLB）" }).click();
  const download = await downloading;
  await download.saveAs("test-results/miaoxing-cat.glb");
  const path = await download.path();
  const buffer = await readFile(path!);
  expect(buffer.readUInt32LE(0)).toBe(0x46546c67);
  expect(buffer.byteLength).toBeLessThan(45 * 1024 * 1024);
  const json = JSON.parse(
    buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString(),
  );
  expect(json.skins[0].joints.length).toBe(22);
  expect(json.animations.map((a: { name: string }) => a.name)).toEqual([
    "stand",
    "walk",
    "rest",
  ]);
  const bodyNode = json.nodes.find(
    (n: { name: string }) => n.name === "CatBody",
  );
  const mesh = json.meshes[bodyNode.mesh];
  expect(mesh.primitives[0].targets.length).toBe(8);
  expect(json.images.length).toBeGreaterThanOrEqual(1);
  expect(
    json.images.every((image: { bufferView?: number }) =>
      Number.isInteger(image.bufferView),
    ),
  ).toBe(true);
  await page.addScriptTag({ content: await browserGlbProbe() });
  // Serve the binary in the test browser, avoiding several enormous base64 and
  // UTF-16 copies over the automation channel during the reload check.
  await page.route("**/__test_cat_roundtrip.glb", (route) =>
    route.fulfill({ body: buffer, contentType: "model/gltf-binary" }),
  );
  const roundtrip = await page.evaluate(async () => {
    const probe = (
      window as unknown as {
        __verifyCatGlb: (data: string) => Promise<CatGlbProbe>;
      }
    ).__verifyCatGlb;
    return probe("/__test_cat_roundtrip.glb");
  });
  expect(roundtrip.bones).toBe(22);
  expect(roundtrip.bodyMorphCount).toBe(8);
  expect(roundtrip.hasShapeWeights).toBe(true);
  expect(roundtrip.embeddedImages).toBeGreaterThanOrEqual(1);
  expect(roundtrip.eyelidTargetCount).toBeGreaterThanOrEqual(4);
  expect(roundtrip.poses.map((pose) => pose.name)).toEqual([
    "stand",
    "walk",
    "rest",
  ]);
  for (const pose of roundtrip.poses) {
    expect(
      pose.bounds.every(
        (value) => Number.isFinite(value) && value > 0.1 && value < 6,
      ),
    ).toBe(true);
    expect(pose.eyeScales.length).toBe(2);
    for (const scale of pose.eyeScales) expect(scale).toEqual([1, 1, 1]);
    expect(pose.shapeWeights).toEqual(roundtrip.poses[0].shapeWeights);
    if (pose.name === "rest") {
      expect(pose.restFold).toBeGreaterThanOrEqual(0.9);
      expect(pose.eyelidClosures.length).toBeGreaterThanOrEqual(4);
      expect(pose.eyelidClosures.every((closure) => closure >= 0.9)).toBe(true);
    } else expect(pose.restFold).toBe(0);
  }
  expect(roundtrip.transition.restFold).toBeCloseTo(0.5, 3);
  expect(roundtrip.transition.shapeWeights).toEqual(
    roundtrip.poses[0].shapeWeights,
  );
  expect(
    roundtrip.transition.bounds.every(
      (value) => Number.isFinite(value) && value > 0.1 && value < 6,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("mobile layout, touch rotation and bounded body controls", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("http://localhost:3000/studio");
  await expect(page.locator("[data-ready=true]")).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "侧面", exact: true }).tap();
  await expect(page.locator("[data-ready=true]")).toBeVisible();
  await page.screenshot({
    path: "test-results/studio-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "体型", exact: true }).tap();
  for (const name of ["身体饱满度", "躯干长度", "四肢长度", "尾巴长度"]) {
    const slider = page.getByRole("slider", { name });
    await slider.fill("100");
    await slider.blur();
  }
  await page.getByRole("button", { name: "趴卧", exact: true }).tap();
  await page.screenshot({
    path: "test-results/studio-extreme-mobile.png",
    fullPage: true,
  });
  await context.close();
});
