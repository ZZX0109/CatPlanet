import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DataUtils, Matrix3, Matrix4, Vector3 } from "three";

const output = "artifacts/fur-volume/verification";
const sourceFiles = [
  "lib/cat-fur-volume-material.ts",
  "lib/cat-fur-compositor.ts",
  "tests/fixtures/fur-volume-analytic.mjs",
];

async function hashes() {
  return Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (path) => [
        path,
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      ]),
    ),
  );
}

function trilinearKappa(half: number[], u: number, h: number) {
  // Independent reconstruction of WebGL CLAMP_TO_EDGE texel-centre sampling.
  const x = Math.max(0, Math.min(1, u * 2 - 0.5));
  const z = Math.max(0, Math.min(15, h * 16 - 0.5));
  const z0 = Math.floor(z),
    z1 = Math.min(z0 + 1, 15),
    f = z - z0;
  const texel = (column: number, slice: number) =>
    DataUtils.fromHalfFloat(half[(slice * 2 + column) * 4 + 3]);
  const atSlice = (slice: number) =>
    texel(0, slice) * (1 - x) + texel(1, slice) * x;
  return atSlice(z0) * (1 - f) + atSlice(z1) * f;
}

function referenceTau(result: any, row: any, pixel: any) {
  const matrix = new Matrix4().fromArray(row.matrix);
  const inverse = matrix.clone().invert();
  const normalMatrix = new Matrix3().getNormalMatrix(matrix);
  const linear = new Matrix3().setFromMatrix4(matrix);
  const view = new Vector3(0, 0, 1);
  const origin = new Vector3(pixel.worldX, pixel.worldY, 3);
  const ray = new Vector3(0, 0, -1);
  const transform = row.uvTransform ?? [1, 1, 0, 0];
  let total = 0;
  for (let i = 0; i < row.layers; i++) {
    const h = (i + 0.5) / row.layers;
    const slope = row.slope ?? 0;
    // Each slice is the real plane z=h*(H+slope*x), transformed into world.
    const planeNormal = new Vector3(-h * slope, 0, 1)
      .applyMatrix3(normalMatrix)
      .normalize();
    const point = new Vector3(0, 0, result.height * h).applyMatrix4(matrix);
    const rayDistance =
      planeNormal.dot(point.clone().sub(origin)) / planeNormal.dot(ray);
    const local = origin
      .clone()
      .addScaledVector(ray, rayDistance)
      .applyMatrix4(inverse);
    const nativeU = local.x / result.width + 0.5;
    const nativeV = local.y / result.width + 0.5;
    // Do not silently count samples outside the rasterized finite slice.
    if (nativeU < 0 || nativeU > 1 || nativeV < 0 || nativeV > 1) continue;
    const localHeight = result.height + slope * local.x;
    const step = new Vector3(0, 0, localHeight / row.layers).applyMatrix3(
      linear,
    );
    const length =
      Math.abs(step.dot(planeNormal)) /
      Math.max(Math.abs(view.dot(planeNormal)), 0.2);
    const u = nativeU * transform[0] + transform[2];
    total +=
      trilinearKappa(result.texture.half, u, h) *
      result.decodeScale *
      result.density *
      length;
  }
  return total;
}

test("shell MRT integrates a known half-float volume without colour fringes and respects occlusion and ownership", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const before = await hashes();
  await page.route("**/__fur-volume-analytic", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body></body></html>',
    }),
  );
  await page.goto("http://localhost:3000/__fur-volume-analytic");
  const bundled = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "ts",
      contents: `import {runFurVolumeAnalytic} from './tests/fixtures/fur-volume-analytic.mjs';window.__furVolumeAnalytic=runFurVolumeAnalytic;`,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
  });
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  const result = await page.evaluate(() =>
    (window as any).__furVolumeAnalytic(),
  );
  const after = await hashes();
  const analyticRows = result.cases.flatMap((row: any) =>
    row.pixels.map((pixel: any) => {
      const expectedTau = referenceTau(result, row, pixel);
      return {
        name: row.name,
        x: pixel.x,
        expectedTau,
        measuredTau: pixel.opticalDepth,
        relativeError:
          expectedTau > 0
            ? Math.abs(pixel.opticalDepth - expectedTau) / expectedTau
            : 0,
      };
    }),
  );
  await mkdir(output, { recursive: true });
  await writeFile(
    `${output}/gpu-analytic.json`,
    JSON.stringify(
      {
        description:
          "Analytic shell-medium validation; not evidence of photorealism or absence of coordinate folds.",
        before,
        after,
        errors,
        analyticRows,
        result,
      },
      null,
      2,
    ),
  );

  await test.step("real WebGL programs, source stability and MRT attachments", async () => {
    expect(errors).toEqual([]);
    expect(after).toEqual(before);
    expect(result.diagnostics.attributes.alpha).toBe(false);
    expect(result.diagnostics.error).toBe(0);
    expect(result.errorAfterCleanup).toBe(0);
    for (const program of result.diagnostics.programs)
      expect(program.runnable).toBe(true);
    for (const row of result.cases) {
      expect(row.info.mode).toBe("weighted");
      expect(row.info.geometryMode).toBe("hybrid");
      expect(row.targetNames).toEqual([
        "CatFur_WeightedColour",
        "CatFur_LogRevealage",
      ]);
      expect(row.restoredRenderTarget).toBe(true);
    }
  });

  await test.step("8/16 slices, UV crop and nonuniform sloping-shell metric agree with independent ray/half-texel integration", async () => {
    for (const row of analyticRows) {
      expect(Number.isFinite(row.measuredTau), JSON.stringify(row)).toBe(true);
      if (row.expectedTau > 0.00001)
        expect(row.relativeError, JSON.stringify(row)).toBeLessThan(0.02);
      else
        expect(Math.abs(row.measuredTau), JSON.stringify(row)).toBeLessThan(
          0.00001,
        );
    }
    const full = result.cases.find((row: any) => row.name === "sixteen");
    const half = result.cases.find((row: any) => row.name === "eight");
    const noMap = result.cases.find(
      (row: any) => row.name === "without-base-map",
    );
    for (let i = 0; i < full.pixels.length; i++) {
      expect(
        Math.abs(full.pixels[i].opticalDepth - half.pixels[i].opticalDepth),
      ).toBeLessThan(0.025);
      expect(
        Math.abs(noMap.pixels[i].opticalDepth - full.pixels[i].opticalDepth),
      ).toBeLessThan(0.005);
    }
    expect(
      result.cases.find((row: any) => row.name === "copied-uv-transform")
        .metadata.densityUvTransform,
    ).toEqual([0.5, 1, 0.25, 0]);
  });

  await test.step("density-premultiplied RGB remains the same colour when filtered into empty voxels", async () => {
    for (const row of result.cases.filter((entry: any) => !entry.transformed)) {
      for (const pixel of row.pixels) {
        if (pixel.opticalDepth <= 0.02) continue;
        const alpha = 1 - Math.exp(-pixel.opticalDepth);
        for (let channel = 0; channel < 3; channel++) {
          const recovered = pixel.accumulation[channel] / pixel.accumulation[3];
          expect(
            Math.abs(recovered - result.referenceColour[channel]),
            `${row.name},x=${pixel.x},channel=${channel}`,
          ).toBeLessThan(0.006);
          expect(
            Math.abs(
              pixel.canvas[channel] - alpha * result.referenceColour[channel],
            ),
          ).toBeLessThan(0.008);
        }
      }
    }
  });

  await test.step("opaque depth, clear/rebind and caller-owned resource lifetime remain correct", async () => {
    const centre = result.blocked.pixels.find((pixel: any) => pixel.x === 64);
    expect(centre.opticalDepth).toBe(0);
    expect(centre.accumulation).toEqual([0, 0, 0, 0]);
    for (let channel = 0; channel < 3; channel++) {
      expect(
        Math.abs(centre.canvas[channel] - result.frontColour[channel]),
      ).toBeLessThan(2 / 255);
      expect(
        Math.abs(
          result.blocked.background[channel] - result.background[channel],
        ),
      ).toBeLessThan(2 / 255);
    }
    expect(
      result.blocked.pixels.find((pixel: any) => pixel.x === 26).opticalDepth,
    ).toBeGreaterThan(1);
    expect(result.procedural.metadata.sampleMode).toBe("procedural");
    expect(
      result.procedural.pixels.some((pixel: any) => pixel.opticalDepth > 0),
    ).toBe(true);
    expect(result.rebound.metadata.sampleMode).toBe("baked-strand-density");
    expect(result.rebound.pixels).toEqual(result.beforeWall.pixels);
    expect(result.afterVolumeCleanup.borrowed).toEqual({
      geometry: 0,
      material: 0,
      map: 0,
      volume: 0,
    });
    expect(result.afterVolumeCleanup.owned).toEqual(
      result.afterVolumeCleanup.expectedOwned,
    );
    expect(Math.max(...result.sourceAfterCleanup.slice(0, 3))).toBeGreaterThan(
      0.02,
    );
  });
});
