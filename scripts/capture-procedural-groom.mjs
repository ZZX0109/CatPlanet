import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { installNativeCoatInspection } from "../tests/fixtures/native-coat-inspection.mjs";

const phase = process.argv[2] ?? "before-full-coat";
if (!/^[a-z0-9-]+$/.test(phase)) throw Error("Use a named phase");
const baselineArg = process.argv.find((x) => x.startsWith("--baseline="));
const baseline = baselineArg
  ? JSON.parse(await readFile(baselineArg.slice(11), "utf8"))
  : null;
const phone = process.argv.includes("--phone");
const desiredCoat = process.argv.includes("--short")
  ? "short"
  : (baseline?.frames[0].actual.design.coatType ?? "long");
const viewsArgument = process.argv.find((arg) => arg.startsWith("--views="));
const selectedViews = viewsArgument
  ? viewsArgument.slice(8).split(",")
  : process.argv.includes("--quick")
    ? ["head", "side"]
    : ["head", "side", "rest"];
if (
  !selectedViews.length ||
  selectedViews.some(
      (view) => !["head", "chest", "side", "rest", "back", "tail", "full", "front", "face", "ears", "cheek"].includes(view),
  ) ||
  new Set(selectedViews).size !== selectedViews.length
)
  throw Error("Choose distinct head/chest/side/rest/back/tail/full/front/face/ears/cheek views");
const output = path.resolve("artifacts/procedural-groom", phase);
await mkdir(output, { recursive: true });
const sha = (data) => createHash("sha256").update(data).digest("hex");
const paths = [
  "lib/norwegian-fur.ts",
  "components/RoomCreatorCat.tsx",
  "components/CatCreator.tsx",
  "components/CatCreatorScene.tsx",
  "components/useCatCreatorDesign.ts",
  ...(await readdir("lib"))
    .filter((n) => /^cat-.*(coat|fur|creator|groom).*\.ts$/.test(n))
    .map((n) => "lib/" + n),
];
const hashes = async () =>
  Object.fromEntries(
    await Promise.all(paths.map(async (p) => [p, sha(await readFile(p))])),
  );
const sources = await hashes(),
  frames = [],
  errors = [];
const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader"],
});
try {
  const context = await browser.newContext({
    viewport: phone
      ? { width: 390, height: 844 }
      : { width: 1365, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    ...(phone ? { hasTouch: true, isMobile: true } : {}),
  });
  const page = await context.newPage();
  page.on("pageerror", (e) =>
    errors.push({ type: "pageerror", message: e.message }),
  );
  page.on("console", (m) => {
    if (m.type() === "error")
      errors.push({ type: "console.error", message: m.text() });
  });
  if (baseline)
    await page.addInitScript(
      (design) =>
        localStorage.setItem(
          "miaoxing.cat-creator.foundation.v1",
          JSON.stringify(design),
        ),
      baseline.frames[0].actual.design,
    );
  await page.goto("http://localhost:3000/studio/base");
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.locator('[data-creator-ready="true"]').waitFor({ timeout: 90000 });
  if (
    (await page
      .locator('[data-creator-ready="true"]')
      .getAttribute("data-creator-coat")) !== desiredCoat
  ) {
    await page.getByRole("button", { name: desiredCoat === "short" ? /^短毛/ : /^长毛/ }).click();
    await page
      .locator(
        `[data-creator-ready="true"][data-creator-coat="${desiredCoat}"]`,
      )
      .waitFor({ timeout: 90000 });
  }
  if (
    (await page
      .locator('[data-creator-ready="true"]')
      .getAttribute("data-creator-coat-mode")) !== "groom"
  ) {
    await button("毛发").click();
    await page
      .getByRole("group", { name: /被毛来源|被毛显示/ })
      .getByRole("button")
      .filter({ hasText: /附加毛层|完整被毛/ })
      .first()
      .click();
  }
  await page
    .locator('[data-creator-ready="true"][data-creator-coat-mode="groom"]')
    .waitFor({ timeout: 90000 });
  await page.evaluate(installNativeCoatInspection);
  const settle = async () => {
    await page
      .locator('[data-creator-ready="true"][data-creator-coat-mode="groom"]')
      .waitFor();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((r) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        ),
      );
    });
    if (errors.length) throw Error(errors.at(-1).message);
  };
  const yaw = async (degrees) => {
    await page.evaluate((degrees) => {
      const canvas = document.querySelector("canvas");
      let f =
        canvas[Object.keys(canvas).find((k) => k.startsWith("__reactFiber"))];
      while (f && !f.memoizedProps?.model) f = f.return;
      const s = f.memoizedProps.model.scene.__r3f.root.getState(),
        c = s.camera,
        t = s.controls.target,
        d = c.position.clone().sub(t),
        r = d.length(),
        p = Math.acos(d.y / r),
        a = (degrees * Math.PI) / 180;
      c.position.set(
        t.x + r * Math.sin(p) * Math.sin(a),
        t.y + r * Math.cos(p),
        t.z + r * Math.sin(p) * Math.cos(a),
      );
      c.lookAt(t);
      s.controls.update();
      s.invalidate();
    }, degrees);
    await settle();
  };
  const whole = async () => {
    await button("全身").click();
    await settle();
    const region = page.getByRole("region", {
      name: "结构猫头三维预览",
      exact: true,
    });
    await region.focus();
    for (let i = 0; i < 3; i++) {
      await region.press("ArrowRight");
      await settle();
    }
    await region.press("-");
    await settle();
  };
  const capture = async (view) => {
    await settle();
    const ref = baseline?.frames.find((f) => f.view === view);
    if (ref)
      await page.evaluate((ref) => {
        const canvas = document.querySelector("canvas");
        let f =
          canvas[Object.keys(canvas).find((k) => k.startsWith("__reactFiber"))];
        while (f && !f.memoizedProps?.model) f = f.return;
        const s = f.memoizedProps.model.scene.__r3f.root.getState();
        s.camera.position.fromArray(ref.camera.position);
        s.controls.target.fromArray(ref.camera.target);
        s.camera.lookAt(s.controls.target);
        s.controls.update();
        s.camera.projectionMatrix.fromArray(ref.camera.projection);
        s.camera.projectionMatrixInverse
          .copy(s.camera.projectionMatrix)
          .invert();
        s.invalidate();
      }, ref.actual);
    const actual = await page.evaluate(() => window.__nativeCoatCapture());
    if (actual.mode !== "groom" || !actual.preparedGroom)
      throw Error("Full procedural resource was not active");
    for (const region of ["head", "ruff", "body"])
      if (
        !(
          actual.stats[region].capacity > 0 &&
          actual.stats[region].previewStrands > 0
        ) ||
        !actual.draws.some((d) => d.furRegion === region)
      )
        throw Error("Missing actual " + region + " coat draw");
    if (
      actual.context.error ||
      actual.context.programs.some((p) => !p.runnable)
    )
      throw Error("Actual WebGL error");
    if (process.argv.includes("--expect-analytic")) {
      for (const region of ["head", "ruff", "body"]) {
        if (!actual.analyticTangentDraws.some(draw => draw.region === region && draw.uniform === 1)) throw Error("Analytic tangent uniform did not reach actual " + region + " GPU draw");
        const attribute = actual.resources.find(mesh => mesh.region === region && mesh.furTangent)?.furTangent;
        if (!attribute || attribute.type !== "Int16Array" || !attribute.normalized || attribute.sampledNonfinite || attribute.samples === 0 || attribute.sampledUnitMin < 0.9999 || attribute.sampledUnitMax > 1.0001) throw Error("Invalid drawn analytic tangent attribute in " + region);
      }
    }
    const file = view + ".png";
    await page.locator("canvas").screenshot({ path: path.join(output, file) });
    frames.push({
      view,
      file,
      actual,
      matchedBaseline: ref
        ? {
            camera:
              JSON.stringify(actual.camera) ===
              JSON.stringify(ref.actual.camera),
            shape:
              JSON.stringify(actual.design.shape) ===
              JSON.stringify(ref.actual.design.shape),
            canvas:
              JSON.stringify(actual.canvas) ===
              JSON.stringify(ref.actual.canvas),
          }
        : null,
    });
    console.log(
      JSON.stringify({
        captured: file,
        mode: actual.mode,
        counts: Object.fromEntries(
          Object.entries(actual.stats).map(([k, v]) => [k, v.previewStrands]),
        ),
      }),
    );
  };
  if (phone) {
    await button(process.argv.includes("--phone-full") ? "全身" : "三分之四").tap();
    await capture("phone-portrait");
    await page.setViewportSize({ width: 844, height: 390 });
    await button(process.argv.includes("--phone-full") ? "全身" : "三分之四").tap();
    await capture("phone-landscape");
  } else {
    for (const view of selectedViews) {
      if (["head", "chest", "front", "face", "ears", "cheek"].includes(view)) {
        await button("三分之四").click();
        await settle();
        if (view === "chest")
          await page.evaluate(() => {
            const canvas = document.querySelector("canvas");
            let fiber =
              canvas[
                Object.keys(canvas).find((key) =>
                  key.startsWith("__reactFiber"),
                )
              ];
            while (fiber && !fiber.memoizedProps?.model) fiber = fiber.return;
            const state = fiber.memoizedProps.model.scene.__r3f.root.getState();
            const delta = state.camera.position
              .clone()
              .sub(state.controls.target)
              .multiplyScalar(1.12);
            state.controls.target.y -= 0.65;
            state.controls.target.z -= 0.2;
            state.camera.position.copy(state.controls.target).add(delta);
            state.camera.lookAt(state.controls.target);
            state.controls.update();
            state.invalidate();
          });
        if (view === "front") await yaw(0);
        if (view === "face" || view === "ears" || view === "cheek")
          await page.evaluate((view) => {
            const canvas=document.querySelector("canvas");
            let f=canvas[Object.keys(canvas).find(k=>k.startsWith("__reactFiber"))];
            while(f&&!f.memoizedProps?.model)f=f.return;
            const model=f.memoizedProps.model,s=model.scene.__r3f.root.getState();
            const eyes=model.landmarks.eyeCenters, span=Math.abs(eyes[0][0]-eyes[1][0]);
            const x=(eyes[0][0]+eyes[1][0])*.5,y=(eyes[0][1]+eyes[1][1])*.5,z=(eyes[0][2]+eyes[1][2])*.5;
            if(view==="face") {
              s.controls.target.set(x,y-span*.38,z+span*.19);
              s.camera.position.copy(s.controls.target).add({x:0,y:span*.04,z:span*3.1});
            } else if(view==="ears") {
              s.controls.target.set(x,y+span*.86,z-span*.75);
              s.camera.position.copy(s.controls.target).add({x:span*.8,y:span*.12,z:span*4.0});
            } else {
              s.controls.target.set(x+span*.72,y-span*.65,z-span*.25);
              s.camera.position.copy(s.controls.target).add({x:span*2.8,y:span*.25,z:span*3.5});
            }
            s.camera.lookAt(s.controls.target);s.controls.update();s.invalidate();
          },view);
      } else if (view === "back" || view === "tail") {
        await whole();
        await page.evaluate((view) => {
          const canvas = document.querySelector("canvas");
          let fiber = canvas[Object.keys(canvas).find(key => key.startsWith("__reactFiber"))];
          while (fiber && !fiber.memoizedProps?.model) fiber = fiber.return;
          const model = fiber.memoizedProps.model;
          const state = model.scene.__r3f.root.getState();
          const head = model.bounds, body = model.wholeBounds;
          const height = body.max.y - body.min.y;
          const target = state.controls.target;
          if (view === "back") {
            target.set(0, head.min.y + (head.max.y-head.min.y)*0.18, head.min.z - height*0.18);
            state.camera.position.copy(target).add({x:height*0.9,y:height*0.25,z:-height*0.55});
          } else {
            target.set(0, body.min.y + height*0.30, body.min.z + (body.max.z-body.min.z)*0.16);
            state.camera.position.copy(target).add({x:height*1.1,y:height*0.12,z:-height*0.20});
          }
          state.camera.lookAt(target);
          state.controls.update();
          state.invalidate();
        }, view);
      } else {
        if (view === "rest") {
          await button("趴卧").click();
          await page.waitForTimeout(1400);
        }
        await whole();
        if (view === "side") await yaw(90);
        if (view === "full") await yaw(55);
      }
      await capture(view);
    }
  }
  const sourcesAfter = await hashes(),
    changed = Object.keys(sources).filter(
      (p) => sources[p] !== sourcesAfter[p],
    );
  const response = await context.request.get(
    "http://localhost:3000/models/creator/norwegian-cat.glb",
  );
  if (!response.ok()) throw Error("Model unavailable");
  const modelSHA = sha(await response.body());
  await writeFile(
    path.join(output, "capture-report.json"),
    JSON.stringify(
      {
        phase,
        selectedCoat: desiredCoat,
        selectedViews: phone
          ? ["phone-portrait", "phone-landscape"]
          : selectedViews,
        method:
          "Unedited actual project studio full procedural groom; selected matching camera views. No private Kitten data.",
        sources,
        sourcesAfter,
        changed,
        modelSHA,
        frames,
        errors,
      },
      null,
      2,
    ),
  );
  if (changed.length || errors.length)
    throw Error("Capture sources changed or console error");
  await context.close();
  console.log(
    JSON.stringify({ output, frames: frames.length, changed, errors }),
  );
} finally {
  await browser.close();
}
