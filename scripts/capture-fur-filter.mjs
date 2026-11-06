// Actual studio filter A/B; source, geometry, lighting and LOD remain unchanged.
// Usage: node scripts/capture-fur-filter.mjs round-01 [--heads-only] [--geometry-views] [--pose-audit] [--coat=long] [--filters=legacy,compact] [--angles-only] [--probe-only]
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
const phase = process.argv[2] ?? "round-01";
const densityVariant =
  process.argv.find((s) => s.startsWith("--density-variant="))?.split("=")[1] ??
  "base";
if (!["base", "r14-s0"].includes(densityVariant))
  throw Error("Unknown density variant");
const densityBase =
  densityVariant === "r14-s0"
    ? "fur-volume-prototype-r14-s0"
    : "fur-volume-prototype";
const skipNullControl =
  process.argv.includes("--skip-null-control") || densityVariant !== "base";
if (!/^[a-z0-9-]+$/.test(phase) || phase === "before")
  throw Error("Use a new round name; preserve before.");
const headsOnly = process.argv.includes("--heads-only"),
  coreViews = process.argv.includes("--core-views"),
  geometryViews = process.argv.includes("--geometry-views"),
  layerViews = process.argv.includes("--layer-views"),
  appendageDepthViews = process.argv.includes("--appendage-depth-views"),
  appendageFinalViews = process.argv.includes("--appendage-final-views"),
  appendageViews =
    process.argv.includes("--appendage-views") ||
    appendageDepthViews ||
    appendageFinalViews,
  lodAudit = process.argv.includes("--lod-audit"),
  volumeWidthAudit = process.argv.includes("--volume-width-audit"),
  kindIsolationAudit = process.argv.includes("--kind-isolation-audit"),
  isolationFinOnly = process.argv.includes("--isolation-fin-only"),
  drawIsolationAudit =
    process.argv.includes("--draw-isolation-audit") ||
    kindIsolationAudit ||
    isolationFinOnly,
  isolationSecondPass = process.argv.includes("--isolation-second-pass"),
  bakedVolumeAudit =
    process.argv.includes("--baked-volume-audit") || drawIsolationAudit,
  volumeAudit =
    process.argv.includes("--volume-audit") ||
    volumeWidthAudit ||
    bakedVolumeAudit,
  poseAudit = process.argv.includes("--pose-audit"),
  anglesOnly = process.argv.includes("--angles-only"),
  angles = anglesOnly || process.argv.includes("--angles"),
  coatOption = process.argv.find((s) => s.startsWith("--coat="))?.split("=")[1];
if (coatOption && !["short", "long"].includes(coatOption))
  throw Error("Choose short or long.");
const filters = (
  process.argv.find((s) => s.startsWith("--filters="))?.split("=")[1] ??
  "legacy,box,compact"
).split(",");
if (
  !filters.length ||
  filters.some((f) => !["legacy", "box", "compact"].includes(f)) ||
  new Set(filters).size !== filters.length
)
  throw Error("Choose distinct legacy, box or compact filters.");
if (lodAudit && (filters.length !== 1 || filters[0] !== "legacy"))
  throw Error("LOD audit must use --filters=legacy.");
if (volumeAudit && (filters.length !== 1 || filters[0] !== "legacy"))
  throw Error("Volume audit must use --filters=legacy.");
if (headsOnly && anglesOnly) throw Error("Choose heads or extra angles.");
const output = path.resolve("artifacts/fur-filter", phase);
await mkdir(output, { recursive: true });
const baseline = JSON.parse(
  await readFile("artifacts/fur-filter/before/capture-report.json", "utf8"),
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  sources = {};
for (const file of [
  ...Object.keys(baseline.sources),
  "lib/cat-fur-segments.ts",
  "lib/cat-fur-segment-material.ts",
  "lib/cat-fur-volume.ts",
  "lib/cat-fur-volume-material.ts",
  "lib/cat-fur-volume-fields.ts",
  "lib/cat-fur-volume-bake.ts",
  "public/models/creator/fur-volume-prototype/body-volume.json",
  "public/models/creator/fur-volume-prototype/body-volume.rgba16f.bin",
  "public/models/creator/fur-volume-prototype-r14-s0/body-volume.json",
  "public/models/creator/fur-volume-prototype-r14-s0/body-volume.rgba16f.bin",
])
  sources[file] = sha(await readFile(file));
const probe = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "ts",
    contents: `import * as THREE from 'three';import{GLTFLoader}from'three/addons/loaders/GLTFLoader.js';import{ownCreatorModel,applyCreatorDesign,cloneCreatorForExport,disposeCreatorExport}from'./lib/cat-creator-model';import{defaultCreatorDesign}from'./lib/cat-creator-design';import{getCatCoatProfile}from'./lib/cat-coat-profiles';import{createNorwegianFur}from'./lib/norwegian-fur';window.__filterAuditTools={THREE,GLTFLoader,ownCreatorModel,applyCreatorDesign,cloneCreatorForExport,disposeCreatorExport,defaultCreatorDesign,getCatCoatProfile,createNorwegianFur};`,
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
});
await writeFile(path.join(output, "model-probe.js"), probe.outputFiles[0].text);
const densityTools = bakedVolumeAudit
  ? await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: "ts",
        contents: `import {Data3DTexture,RGBAFormat,HalfFloatType,NoColorSpace,LinearFilter,ClampToEdgeWrapping,Vector4} from 'three';window.__densityTextureTools={Data3DTexture,RGBAFormat,HalfFloatType,NoColorSpace,LinearFilter,ClampToEdgeWrapping,Vector4};`,
      },
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
    })
  : null;
if (densityTools)
  await writeFile(
    path.join(output, "density-texture-probe.js"),
    densityTools.outputFiles[0].text,
  );
await writeFile(
  path.join(output, "probe-sources.json"),
  JSON.stringify(
    { sources, probeSHA: sha(probe.outputFiles[0].text) },
    null,
    2,
  ),
);
if (process.argv.includes("--probe-only")) {
  console.log(JSON.stringify({ output, probeOnly: true, sources }));
  process.exit(0);
}
process.env.NO_PROXY = "localhost,127.0.0.1,::1";
process.env.no_proxy = process.env.NO_PROXY;
const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader"],
});
const captureStarted = Date.now();
let modelSHA = null;
const errors = [],
  frames = [],
  settings = [],
  lodPairs = [],
  volumePairs = [];
let nullTextureComparison = null;
const drawIsolationChecks = [];
try {
  const auditContext = await browser.newContext();
  const modelResponse = await auditContext.request.get(
      "http://localhost:3000/models/creator/norwegian-cat.glb",
    ),
    modelBytes = await modelResponse.body();
  modelSHA = sha(modelBytes);
  await auditContext.close();
  if (
    modelResponse.status() !== 200 ||
    modelSHA !== baseline.decodedHttpModels[0].sha256
  )
    throw Error("Unexpected cat source asset");
  for (const coat of coatOption
    ? [coatOption]
    : lodAudit || volumeAudit
      ? ["long"]
      : appendageViews
        ? ["long", "short"]
        : ["short", "long"]) {
    const context = await browser.newContext({
        viewport: { width: 1365, height: 900 },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
      }),
      page = await context.newPage();
    page.on("pageerror", (e) => errors.push({ coat, message: e.message }));
    page.on("console", (m) => {
      if (m.type() === "error")
        errors.push({ coat, kind: "console.error", message: m.text() });
    });
    try {
      await page.goto("http://localhost:3000/studio/base");
      await page
        .locator('[data-creator-ready="true"]')
        .waitFor({ timeout: 90000 });
      const button = (name) => page.getByRole("button", { name, exact: true });
      await button(coat === "short" ? "短毛猫" : "长毛猫").click();
      await page
        .locator(`[data-creator-ready="true"][data-creator-coat="${coat}"]`)
        .waitFor({ timeout: 90000 });
      // This historical harness evaluates the optional procedural groom.
      // Fresh studio loads now prefer the original surface coat instead.
      await button("毛发").click();
      await button("附加毛层（实验）").click();
      await page
        .locator('[data-creator-ready="true"][data-creator-coat-mode="groom"]')
        .waitFor({ timeout: 90000 });
      await button("头型").click();
      await button("自然脸").click();
      await button("材质预览").click();
      const shape = {};
      for (const part of ["头型", "眼睛", "鼻口", "耳朵", "毛发"]) {
        await button(part).click();
        for (const input of await page.locator('input[id^="creator-"]').all())
          shape[(await input.getAttribute("id")).replace("creator-", "")] =
            Number(await input.inputValue());
      }
      for (const [key, value] of Object.entries(shape))
        if (
          !key.includes("Fur") &&
          value !== (["headRound", "headWedge"].includes(key) ? 0 : 50)
        )
          throw Error(`Non-neutral ${coat}.${key}`);
      if ((await button("呼吸与眨眼").getAttribute("aria-pressed")) !== "false")
        throw Error("Automatic motion must be off");
      await button("头型").click();
      settings.push({
        coat,
        shape,
        viewport: { width: 1365, height: 900, dpr: 1 },
        reducedMotion: true,
        defaultPose: "stand",
        lighting: "Actual existing CatCreatorScene and compositor",
      });
      await page.locator("canvas").evaluate((canvas, lodAudit) => {
        let node =
          canvas[Object.keys(canvas).find((k) => k.startsWith("__reactFiber"))];
        while (node && !node.memoizedProps?.model) node = node.return;
        if (!node) throw Error("Live model unavailable");
        window.__filterModel = node.memoizedProps.model;
        window.__filterVolumeEnabled = false;
        if (lodAudit) {
          const fur = window.__filterModel.fur;
          const original = fur.setDetail;
          window.__filterLodAudit = { forced: null, requests: [], original };
          fur.setDetail = function (value) {
            const audit = window.__filterLodAudit;
            audit.requests.push({
              requested: value,
              applied: audit.forced ?? value,
            });
            return original.call(this, audit.forced ?? value);
          };
        }
        window.__filterMode = "legacy";
        window.__filterGeometryCache = new WeakMap();
        window.__filterEntries = window.__filterModel.fur.meshes
          .filter((m) => m.userData.furRegion)
          .map((mesh) => ({ mesh, material: mesh.material }));
        window.__filterDrawMaterials = new WeakMap();
        window.__filterActualDraws = [];
        window.__filterOpaqueDraws = [];
        const renderer = window.__filterModel.scene.__r3f.root.getState().gl,
          originalRender = renderer.render;
        renderer.render = function (scene, camera, ...args) {
          const mrt = this.getRenderTarget()?.textures?.length === 2;
          const opaque =
            this.getRenderTarget()?.texture?.name === "CatFur_OpaqueLinear";
          if (mrt || opaque) {
            if (mrt) window.__filterActualDraws = [];
            if (opaque) window.__filterOpaqueDraws = [];
            scene.traverse((object) => {
              if (!object.isMesh) return;
              for (const material of Array.isArray(object.material)
                ? object.material
                : [object.material]) {
                if (window.__filterDrawMaterials.has(material)) continue;
                const entry = {
                  material,
                  compile: material.onBeforeCompile,
                  render: material.onBeforeRender,
                  key: material.customProgramCacheKey,
                };
                window.__filterDrawMaterials.set(material, entry);
                material.onBeforeCompile = function (shader, ...args) {
                  entry.compile.call(this, shader, ...args);
                  entry.shader = shader;
                };
                material.onBeforeRender = function (...args) {
                  entry.render.apply(this, args);
                  const target = args[0].getRenderTarget();
                  const list =
                    target?.textures?.length === 2
                      ? window.__filterActualDraws
                      : target?.texture?.name === "CatFur_OpaqueLinear"
                        ? window.__filterOpaqueDraws
                        : null;
                  if (list)
                    list.push({
                      entry,
                      geometry: args[3],
                      object: args[4],
                    });
                };
                material.customProgramCacheKey = () =>
                  entry.key.call(material) + "-filter-qa-inspection";
                material.needsUpdate = true;
              }
            });
          }
          const start = performance.now();
          const result = originalRender.call(this, scene, camera, ...args);
          if (mrt) window.__filterHairSubmissionMs = performance.now() - start;
          return result;
        };
      }, lodAudit);
      if (bakedVolumeAudit) {
        await page.addScriptTag({ content: densityTools.outputFiles[0].text });
        await page.evaluate(
          async ({ densityBase, skipNullControl }) => {
            const response = await fetch(
              `/models/creator/${densityBase}/body-volume.json`,
            );
            const metadata = await response.json();
            const rawResponse = await fetch(
              `/models/creator/${densityBase}/body-volume.rgba16f.bin`,
            );
            const raw = await rawResponse.arrayBuffer();
            const rawSHA = Array.from(
              new Uint8Array(await crypto.subtle.digest("SHA-256", raw)),
            )
              .map((n) => n.toString(16).padStart(2, "0"))
              .join("");
            if (
              !response.ok ||
              !rawResponse.ok ||
              raw.byteLength !== metadata.bytes ||
              rawSHA !== metadata.sha256
            )
              throw Error("Baked density HTTP data/hash mismatch");
            if (new Uint8Array(new Uint16Array([0x1234]).buffer)[0] !== 0x34)
              throw Error("Raw half texture requires little-endian host");
            const t = window.__densityTextureTools,
              renderer = window.__filterModel.scene.__r3f.root.getState().gl,
              gl = renderer.getContext();
            const uploads = [];
            for (const method of [
              "texStorage3D",
              "texImage3D",
              "texSubImage3D",
            ]) {
              const original = gl[method];
              gl[method] = function (...args) {
                uploads.push({
                  method,
                  args: args.map((value) =>
                    ArrayBuffer.isView(value)
                      ? { type: value.constructor.name, length: value.length }
                      : value,
                  ),
                });
                return original.apply(this, args);
              };
            }
            const texture = new t.Data3DTexture(
              new Uint16Array(raw),
              ...metadata.resolution,
            );
            texture.format = t.RGBAFormat;
            texture.type = t.HalfFloatType;
            texture.colorSpace = t.NoColorSpace;
            texture.minFilter = texture.magFilter = t.LinearFilter;
            texture.wrapS =
              texture.wrapT =
              texture.wrapR =
                t.ClampToEdgeWrapping;
            texture.generateMipmaps = false;
            texture.unpackAlignment = 1;
            texture.needsUpdate = true;
            window.__filterBakedDensity = {
              metadata,
              rawSHA,
              uploads,
              texture,
              enabled: false,
            };
            if (metadata.geometryScales)
              window.__filterModel.fur.setVolumeGeometry(
                metadata.geometryScales,
              );
            if (skipNullControl)
              window.__filterModel.fur.setVolumeDensity(
                texture,
                metadata.densityScale,
                new t.Vector4(...metadata.uvTransform),
              );
            window.__filterModel.fur.setVolume(true);
            window.__filterVolumeEnabled = true;
            if (!skipNullControl)
              window.__filterModel.fur.setVolumeDensity(null);
            else window.__filterBakedDensity.enabled = true;
            window.__filterModel.scene.__r3f.root.getState().invalidate();
          },
          { densityBase, skipNullControl },
        );
      }
      const settle = async () => {
        await page
          .locator(`[data-creator-ready="true"][data-creator-coat="${coat}"]`)
          .waitFor({ timeout: 90000 });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((r) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            ),
          );
        });
        if (errors.length)
          throw Error(`Actual page/WebGL error: ${errors.at(-1).message}`);
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
      const audit = () =>
        page.locator("canvas").evaluate(async (canvas) => {
          const model = window.__filterModel,
            state = model.scene.__r3f.root.getState(),
            renderer = state.gl,
            gl = renderer.getContext(),
            digest = async (array) =>
              Array.from(
                new Uint8Array(
                  await crypto.subtle.digest(
                    "SHA-256",
                    new Uint8Array(
                      array.buffer,
                      array.byteOffset,
                      array.byteLength,
                    ),
                  ),
                ),
              )
                .map((v) => v.toString(16).padStart(2, "0"))
                .join("");
          const regions = [];
          for (const entry of window.__filterEntries) {
            const m = entry.mesh,
              a = m.geometry.attributes,
              version =
                Object.entries(a)
                  .map(([k, v]) => k + ":" + v.version)
                  .join(",") +
                ":" +
                m.geometry.index.version;
            let cached = window.__filterGeometryCache.get(m.geometry);
            if (!cached || cached.version !== version) {
              const hashes = {};
              for (const name of [
                "position",
                "normal",
                "color",
                "uv",
                "furWidth",
                "furFilterAxis",
                "furVolumeWeight",
              ])
                hashes[name] = a[name] ? await digest(a[name].array) : null;
              hashes.index = await digest(m.geometry.index.array);
              cached = { version, hashes };
              window.__filterGeometryCache.set(m.geometry, cached);
            }
            let zeroStrands = 0,
              mixedFallback = 0,
              sideMismatch = 0;
            const stride = m.userData.strandVertices,
              count = m.userData.strandCount,
              axis = a.furFilterAxis;
            if (axis)
              for (let strand = 0; strand < count; strand++) {
                let zeros = 0,
                  nonzero = 0;
                for (let sample = 0; sample < stride; sample += 2) {
                  const i = strand * stride + sample,
                    v = axis.getX(i);
                  if (v === 0) zeros++;
                  else nonzero++;
                  if (v !== axis.getX(i + 1)) sideMismatch++;
                }
                if (zeros) zeroStrands++;
                if (zeros && nonzero) mixedFallback++;
              }
            regions.push({
              region: m.userData.furRegion,
              geometryUUID: m.geometry.uuid,
              hashes: cached.hashes,
              vertexCount: a.position.count,
              indexCount: m.geometry.index.count,
              strandVertices: stride,
              strandCount: count,
              previewStrands: m.userData.previewStrands,
              detailLevel: m.userData.detailLevel,
              drawRange: { ...m.geometry.drawRange },
              axis: {
                present: !!axis,
                zeroStrands,
                mixedFallback,
                sideMismatch,
              },
              actualFilter: m.material.userData.catFurOptics.coverageFilter,
              volumeReplacement:
                !!m.material.userData.catFurOptics.volumeReplacement,

              materialKey: m.material.customProgramCacheKey(),
              mrt: !!m.material.defines?.CAT_FUR_MRT,
            });
          }
          return {
            alpha: gl.getContextAttributes().alpha,
            samples: gl.getParameter(gl.SAMPLES),
            mode: canvas.dataset.furRenderer,
            geometryMode: canvas.dataset.furGeometry,
            hairPassSubmissionMs: window.__filterHairSubmissionMs,
            gpuTimerAvailable: !!gl.getExtension(
              "EXT_disjoint_timer_query_webgl2",
            ),
            gpuMemoryObjects: { ...renderer.info.memory },
            actualDraws: window.__filterActualDraws.map(
              ({ entry, geometry, object }) => ({
                name: object?.name,
                uuid: object?.uuid,
                undercoat: !!object?.userData.undercoat,
                nativeSource: window.__filterModel.meshes.includes(object),
                region: object?.userData.furRegion,
                volumeRegion: object?.userData.furVolumeRegion ?? null,
                instanced: !!geometry.isInstancedBufferGeometry,
                instances: geometry.instanceCount ?? null,
                vertexCount: geometry.attributes.position.count,
                indexCount: geometry.index?.count,
                drawRange: { ...geometry.drawRange },
                bytes:
                  Object.values(geometry.attributes).reduce(
                    (sum, a) => sum + a.array.byteLength,
                    0,
                  ) + (geometry.index?.array.byteLength ?? 0),
                material: entry.material.name,
                sourceFilter:
                  entry.material.userData.catFurSegmentOptics?.coverageFilter ??
                  entry.material.userData.catFurOptics?.coverageFilter,
                uniforms: Object.fromEntries(
                  Object.entries(
                    entry.shader?.uniforms ?? entry.material.uniforms ?? {},
                  )
                    .filter(
                      ([name, u]) =>
                        /filter|sampling|lod|volume/i.test(name) &&
                        (typeof u.value === "number" ||
                          u.value?.isVector4 ||
                          u.value?.isData3DTexture),
                    )
                    .map(([name, u]) => [
                      name,
                      u.value?.isVector4
                        ? u.value.toArray()
                        : u.value?.isData3DTexture
                          ? { uuid: u.value.uuid, data3D: true }
                          : u.value,
                    ]),
                ),
              }),
            ),
            opaqueDraws: window.__filterOpaqueDraws.map(
              ({ entry, geometry, object }) => ({
                name: object?.name,
                uuid: object?.uuid,
                undercoat: !!object?.userData.undercoat,
                nativeSource: window.__filterModel.meshes.includes(object),
                furRegion: object?.userData.furRegion ?? null,
                volumeRegion: object?.userData.furVolumeRegion ?? null,
                material: entry.material.name,
                vertices: geometry.attributes.position.count,
                indices: geometry.index?.count ?? 0,
                layers: object.layers.mask,
              }),
            ),
            isolation: window.__filterIsolationGroup ?? null,
            toneMapping: renderer.toneMapping,
            exposure: renderer.toneMappingExposure,
            viewport: {
              width: innerWidth,
              height: innerHeight,
              dpr: devicePixelRatio,
            },
            canvasRect: (() => {
              const r = canvas.getBoundingClientRect();
              return {
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                drawingBufferWidth: canvas.width,
                drawingBufferHeight: canvas.height,
              };
            })(),
            worldMatrices: {
              model: model.scene.matrixWorld.toArray(),
              camera: state.camera.matrixWorld.toArray(),
              cameraInverse: state.camera.matrixWorldInverse.toArray(),
              cameraQuaternion: state.camera.quaternion.toArray(),
              cameraUp: state.camera.up.toArray(),
              native: model.meshes.map((mesh) => ({
                name: mesh.name,
                matrix: mesh.matrixWorld.toArray(),
              })),
              fur: model.fur.meshes.map((mesh) => ({
                name: mesh.name,
                matrix: mesh.matrixWorld.toArray(),
              })),
            },
            camera: {
              position: state.camera.position.toArray(),
              projection: state.camera.projectionMatrix.toArray(),
              target: state.controls?.target.toArray() ?? null,
            },
            lights: (() => {
              const lights = [];
              state.scene.traverse((object) => {
                if (object.isLight)
                  lights.push({
                    type: object.type,
                    color: object.color.toArray(),
                    groundColor: object.groundColor?.toArray() ?? null,
                    intensity: object.intensity,
                    position: object
                      .getWorldPosition(object.position.clone())
                      .toArray(),
                    target: object.target
                      ? object.target
                          .getWorldPosition(object.position.clone())
                          .toArray()
                      : null,
                  });
              });
              return lights;
            })(),
            programCount: renderer.info.programs.length,
            renderStats: { ...renderer.info.render },
            regions,
            volumeInfo: model.fur.volumeInfo?.() ?? null,
            bakedDensity: window.__filterBakedDensity
              ? (() => {
                  const data = window.__filterBakedDensity,
                    texture = data.texture;
                  return {
                    enabled: data.enabled,
                    metadata: data.metadata,
                    rawSHA: data.rawSHA,
                    uploads: data.uploads,
                    webglTextureExists:
                      !!renderer.properties.get(texture).__webglTexture,
                    texture: {
                      isData3DTexture: texture.isData3DTexture,
                      type: texture.type,
                      format: texture.format,
                      colorSpace: texture.colorSpace,
                      minFilter: texture.minFilter,
                      magFilter: texture.magFilter,
                      wrapS: texture.wrapS,
                      wrapT: texture.wrapT,
                      wrapR: texture.wrapR,
                      dimensions: [
                        texture.image.width,
                        texture.image.height,
                        texture.image.depth,
                      ],
                      arrayType: texture.image.data.constructor.name,
                      unpackAlignment: texture.unpackAlignment,
                    },
                    max3DTextureSize: gl.getParameter(gl.MAX_3D_TEXTURE_SIZE),
                    rgba16fEnum: gl.RGBA16F,
                  };
                })()
              : null,
            volumeMeshes: model.fur.meshes
              .filter((mesh) => mesh.userData.furVolumeRegion)
              .map((mesh) => ({
                name: mesh.name,
                region: mesh.userData.furVolumeRegion,
                visible: mesh.visible,
                metadata: { ...mesh.userData },
                materialMetadata: mesh.material.userData.catFurVolume,
                stepAlignment: (() => {
                  const step = mesh.geometry.attributes.furVolumeStep,
                    normal = mesh.geometry.attributes.normal;
                  if (!step || !normal) return null;
                  let maxRelativeCross = 0,
                    zeroStep = 0,
                    negativeDot = 0;
                  for (let i = 0; i < step.count; i++) {
                    const x = step.getX(i),
                      y = step.getY(i),
                      z = step.getZ(i);
                    const nx = normal.getX(i),
                      ny = normal.getY(i),
                      nz = normal.getZ(i);
                    const length = Math.hypot(x, y, z) * Math.hypot(nx, ny, nz);
                    if (length < 1e-15) {
                      zeroStep++;
                      continue;
                    }
                    maxRelativeCross = Math.max(
                      maxRelativeCross,
                      Math.hypot(
                        ny * z - nz * y,
                        nz * x - nx * z,
                        nx * y - ny * x,
                      ) / length,
                    );
                    if (nx * x + ny * y + nz * z < 0) negativeDot++;
                  }
                  return {
                    count: step.count,
                    maxRelativeCross,
                    zeroStep,
                    negativeDot,
                  };
                })(),
                attributes: Object.fromEntries(
                  Object.entries(mesh.geometry.attributes).map(
                    ([name, attribute]) => [
                      name,
                      {
                        count: attribute.count,
                        itemSize: attribute.itemSize,
                        finite: attribute.array.every(Number.isFinite),
                      },
                    ],
                  ),
                ),
                drawRange: { ...mesh.geometry.drawRange },
              })),
            lodAudit: window.__filterLodAudit
              ? {
                  forced: window.__filterLodAudit.forced,
                  recentRequests: window.__filterLodAudit.requests.slice(-8),
                }
              : null,
            error: gl.getError(),
          };
        });
      const capture = async (filter, view, roi) => {
        const started = Date.now();
        if ((bakedVolumeAudit && !drawIsolationAudit) || appendageViews)
          await page.evaluate(() => {
            const model = window.__filterModel;
            model.fur.refresh({ full: true });
            model.scene.__r3f.root.getState().invalidate();
          });
        await page.evaluate(() => scrollTo(0, 0));
        await settle();
        const name = `${coat}-${filter}-${view}.png`;
        if (roi) {
          const box = await page.locator("canvas").boundingBox();
          await page.screenshot({
            path: path.join(output, name),
            clip: {
              x: box.x + roi.x,
              y: box.y + roi.y,
              width: roi.width,
              height: roi.height,
            },
          });
        } else
          await page
            .locator("canvas")
            .screenshot({ path: path.join(output, name) });
        frames.push({
          file: name,
          coat,
          filter,
          view,
          roi: roi ?? null,
          volumeEnabled: volumeAudit
            ? await page.evaluate(() => window.__filterVolumeEnabled)
            : null,
          context: await audit(),
          captureWallMs: Date.now() - started,
        });
      };
      const yaw = async (degrees) => {
        await page.evaluate((degrees) => {
          const state = window.__filterModel.scene.__r3f.root.getState(),
            camera = state.camera,
            controls = state.controls;
          if (!controls) throw Error("Orbit controls unavailable");
          const target = controls.target,
            delta = camera.position.clone().sub(target),
            radius = delta.length(),
            phi = Math.acos(Math.max(-1, Math.min(1, delta.y / radius))),
            theta = (degrees * Math.PI) / 180;
          camera.position.set(
            target.x + radius * Math.sin(phi) * Math.sin(theta),
            target.y + radius * Math.cos(phi),
            target.z + radius * Math.sin(phi) * Math.cos(theta),
          );
          camera.lookAt(target);
          camera.updateProjectionMatrix();
          controls.update();
          state.invalidate();
        }, degrees);
        await settle();
      };
      const captureLodPair = async (filter, view) => {
        const started = Date.now();
        const prepare = await page.evaluate(() => {
          const model = window.__filterModel,
            audit = window.__filterLodAudit;
          audit.forced = null;
          const previousLevel = model.fur.meshes.find(
            (m) => m.userData.furRegion,
          ).userData.detailLevel;
          const before = performance.now();
          // Evaluate the current pose at every authored root before both draws.
          // Otherwise expansion may refresh stale hidden roots only for B.
          model.fur.refresh({ full: true });
          const fullRefreshCpuMs = performance.now() - before;
          model.scene.__r3f.root.getState().invalidate();
          return { previousLevel, fullRefreshCpuMs };
        });
        await settle();
        await capture(filter, `${view}-current`);
        const full = await page.evaluate(() => {
          const model = window.__filterModel;
          const before = performance.now();
          window.__filterLodAudit.forced = 1;
          model.fur.setDetail(1);
          model.scene.__r3f.root.getState().invalidate();
          return { forceFullCpuMs: performance.now() - before };
        });
        await settle();
        await capture(filter, `${view}-full`);
        const [a, b] = frames.slice(-2);
        for (let i = 0; i < a.context.regions.length; i++) {
          const current = a.context.regions[i],
            full = b.context.regions[i];
          if (JSON.stringify(current.hashes) !== JSON.stringify(full.hashes))
            throw Error(
              `CPU arrays changed across LOD pair: ${view}/${current.region}`,
            );
          if (
            full.detailLevel !== 1 ||
            full.previewStrands !== full.strandCount
          )
            throw Error(
              `Full LOD did not draw every intended root: ${view}/${full.region}`,
            );
          if (
            current.detailLevel >= 1 ||
            current.previewStrands >= current.strandCount
          )
            throw Error(
              `Current LOD is unexpectedly full: ${view}/${current.region}`,
            );
        }
        if (
          JSON.stringify(a.context.camera) !==
            JSON.stringify(b.context.camera) ||
          JSON.stringify(a.context.lights) !== JSON.stringify(b.context.lights)
        )
          throw Error(`Camera/lights changed across LOD pair: ${view}`);
        lodPairs.push({
          view,
          ...prepare,
          ...full,
          pairWallMs: Date.now() - started,
          cpuArraysEqual: true,
          cameraEqual: true,
          lightsEqual: true,
          current: a.file,
          full: b.file,
        });
        await page.evaluate((level) => {
          const model = window.__filterModel;
          window.__filterLodAudit.forced = null;
          model.fur.setDetail(level);
          model.scene.__r3f.root.getState().invalidate();
        }, prepare.previousLevel);
        await settle();
      };
      const captureVolumePair = async (filter, view) => {
        const started = Date.now();
        await page.evaluate(() => {
          const model = window.__filterModel;
          model.fur.setVolume(false);
          window.__filterVolumeEnabled = false;
          model.fur.refresh({ full: true });
          model.scene.__r3f.root.getState().invalidate();
        });
        await settle();
        await capture(filter, `${view}-volume-off`);
        if (volumeWidthAudit)
          await page.evaluate(() => {
            const mesh = window.__filterEntries.find(
              ({ mesh }) => mesh.userData.furRegion === "body",
            ).mesh;
            window.__filterBodyBefore = Object.fromEntries(
              ["position", "normal", "furWidth"].map((name) => [
                name,
                mesh.geometry.attributes[name].array.slice(),
              ]),
            );
          });
        const enableCpuMs = await page.evaluate(() => {
          const model = window.__filterModel,
            before = performance.now();
          model.fur.setVolume(true);
          model.fur.refresh({ full: true });
          window.__filterVolumeEnabled = true;
          model.scene.__r3f.root.getState().invalidate();
          return performance.now() - before;
        });
        await settle();
        await capture(filter, `${view}-volume-on`);
        const bodyWidthComparison = volumeWidthAudit
          ? await page.evaluate(() => {
              const mesh = window.__filterEntries.find(
                ({ mesh }) => mesh.userData.furRegion === "body",
              ).mesh;
              const before = window.__filterBodyBefore,
                after = mesh.geometry.attributes;
              const stride = mesh.userData.strandVertices,
                count = mesh.userData.strandCount;
              const centreErrors = [],
                rootErrors = [],
                ratios = [];
              const largestCentreErrors = [];
              let minNonRootY = Infinity,
                unchangedStrands = 0,
                changedWidthStrands = 0,
                widenedPairs = 0;
              let normalCount = 0,
                normalChanged = 0,
                normalMax = 0,
                normalSumSquared = 0;
              for (let strand = 0; strand < count; strand++)
                for (let sample = 2; sample < stride; sample += 2) {
                  const i = (strand * stride + sample) * 3;
                  minNonRootY = Math.min(
                    minNonRootY,
                    before.position[i + 1],
                    before.position[i + 4],
                  );
                }
              let nearMinimumPairs = 0,
                nearMinimumMaxCentreError = 0,
                awayFromMinimumMaxCentreError = 0;
              for (let strand = 0; strand < count; strand++) {
                let unchanged = true,
                  widthChanged = false;
                for (let sample = 0; sample < stride; sample += 2) {
                  const i = (strand * stride + sample) * 3;
                  const oldCentre = [0, 1, 2].map(
                    (k) =>
                      (before.position[i + k] + before.position[i + 3 + k]) *
                      0.5,
                  );
                  const newCentre = [0, 1, 2].map(
                    (k) =>
                      (after.position.array[i + k] +
                        after.position.array[i + 3 + k]) *
                      0.5,
                  );
                  const centreError = Math.hypot(
                    ...oldCentre.map((value, k) => newCentre[k] - value),
                  );
                  centreErrors.push(centreError);
                  if (sample === 0) rootErrors.push(centreError);
                  const nearMinimum =
                    sample > 0 &&
                    Math.min(before.position[i + 1], before.position[i + 4]) <=
                      minNonRootY + 1e-6;
                  if (nearMinimum) {
                    nearMinimumPairs++;
                    nearMinimumMaxCentreError = Math.max(
                      nearMinimumMaxCentreError,
                      centreError,
                    );
                  } else
                    awayFromMinimumMaxCentreError = Math.max(
                      awayFromMinimumMaxCentreError,
                      centreError,
                    );
                  if (
                    largestCentreErrors.length < 5 ||
                    centreError > largestCentreErrors.at(-1).error
                  ) {
                    largestCentreErrors.push({
                      strand,
                      sample: sample / 2,
                      error: centreError,
                      nearMinimumNonRootY: nearMinimum,
                      oldCentre,
                      newCentre,
                    });
                    largestCentreErrors.sort((a, b) => b.error - a.error);
                    largestCentreErrors.length = Math.min(
                      5,
                      largestCentreErrors.length,
                    );
                  }
                  const oldWidth = Math.hypot(
                    ...before.furWidth.subarray(i, i + 3),
                  );
                  const newWidth = Math.hypot(
                    ...after.furWidth.array.subarray(i, i + 3),
                  );
                  if (oldWidth > 1e-12) {
                    const ratio = newWidth / oldWidth;
                    ratios.push(ratio);
                    widthChanged ||= Math.abs(ratio - 1) > 1e-5;
                    if (ratio > 1.00001) widenedPairs++;
                  }
                  for (let component = 0; component < 6; component++) {
                    const j = i + component;
                    const normalError = Math.abs(
                      after.normal.array[j] - before.normal[j],
                    );
                    normalCount++;
                    if (normalError > 0) normalChanged++;
                    normalMax = Math.max(normalMax, normalError);
                    normalSumSquared += normalError * normalError;
                    for (const name of ["position", "normal", "furWidth"])
                      unchanged &&= after[name].array[j] === before[name][j];
                  }
                }
                if (unchanged) unchangedStrands++;
                if (widthChanged) changedWidthStrands++;
              }
              const distribution = (values) => {
                values.sort((a, b) => a - b);
                const at = (q) =>
                  values[
                    Math.min(
                      values.length - 1,
                      Math.floor(q * (values.length - 1)),
                    )
                  ];
                return {
                  count: values.length,
                  min: values[0],
                  p50: at(0.5),
                  p95: at(0.95),
                  p99: at(0.99),
                  max: values.at(-1),
                };
              };
              const result = {
                intendedStrands: count,
                unchangedStrands,
                changedWidthStrands,
                widenedPairs,
                centreError: distribution(centreErrors),
                rootError: distribution(rootErrors),
                widthRatio: distribution(ratios),
                normalComponentError: {
                  count: normalCount,
                  changed: normalChanged,
                  max: normalMax,
                  rms: Math.sqrt(normalSumSquared / normalCount),
                },
                minNonRootY,
                nearMinimumPairs,
                nearMinimumMaxCentreError,
                awayFromMinimumMaxCentreError,
                largestCentreErrors,
                floorClassification:
                  "Old non-root pair has either vertex <= minimum non-root y + 1e-6. Diagnostic classification, not an exposed anatomical/floor label.",
                appendageContractConfirmedFromPublicMetadata: false,
                appendageNote:
                  "Private root kind/trunkWeight is not exposed. Unchanged-strand totals are measured; they do not alone identify every limb/tail root.",
              };
              delete window.__filterBodyBefore;
              return result;
            })
          : null;
        const [off, on] = frames.slice(-2);
        for (let i = 0; i < off.context.regions.length; i++) {
          const a = off.context.regions[i],
            b = on.context.regions[i];
          if (
            (!volumeWidthAudit || a.region !== "body") &&
            JSON.stringify(a.hashes) !== JSON.stringify(b.hashes)
          )
            throw Error(
              `Strand CPU arrays changed across volume pair: ${view}/${a.region}`,
            );
          if (volumeWidthAudit && a.region === "body")
            for (const key of ["color", "uv", "index"])
              if (a.hashes[key] !== b.hashes[key])
                throw Error(`Body ${key} changed across volume pair: ${view}`);
          for (const key of ["previewStrands", "strandCount", "detailLevel"])
            if (a[key] !== b[key])
              throw Error(`LOD changed across volume pair: ${view}/${key}`);
        }
        if (
          JSON.stringify(off.context.camera) !==
            JSON.stringify(on.context.camera) ||
          JSON.stringify(off.context.lights) !==
            JSON.stringify(on.context.lights)
        )
          throw Error(`Camera/lights changed across volume pair: ${view}`);
        if (
          off.context.geometryMode !== "ribbons" ||
          on.context.geometryMode !== "hybrid" ||
          !on.context.actualDraws.some(
            (draw) => draw.volumeRegion === "body",
          ) ||
          !on.context.regions.find((region) => region.region === "body")
            .volumeReplacement
        )
          throw Error(`Actual volume replacement did not render: ${view}`);
        if (
          volumeWidthAudit &&
          !on.context.actualDraws.some(
            (draw) => draw.name === "FurVolumeFin_body",
          )
        )
          throw Error(`Actual silhouette fin draw missing: ${view}`);
        volumePairs.push({
          view,
          enableCpuMs,
          bodyWidthComparison,
          pairWallMs: Date.now() - started,
          strandArraysEqual: !volumeWidthAudit,
          headRuffArraysEqual: true,
          bodyColorUvIndexEqual: true,
          lodEqual: true,
          cameraEqual: true,
          lightsEqual: true,
          off: off.file,
          on: on.file,
        });
        await page.evaluate(() => {
          const model = window.__filterModel;
          model.fur.setVolume(false);
          window.__filterVolumeEnabled = false;
          model.scene.__r3f.root.getState().invalidate();
        });
        await settle();
      };
      for (const filter of filters) {
        await page.evaluate((value) => {
          window.__filterMode = value;
          for (const entry of window.__filterEntries)
            entry.material.userData.catFurOptics.coverageFilter = value;
          window.__filterModel.scene.__r3f.root.getState().invalidate();
        }, filter);
        await button("三分之四").click();
        if (appendageViews) {
          if (coat === "short") {
            await whole();
            await capture(filter, "whole");
          } else {
            await button("趴卧").click();
            await whole();
            await yaw(180);
            await capture(filter, "rest-rear");
            console.log(
              JSON.stringify({
                captured: path.join(output, `${coat}-${filter}-rest-rear.png`),
              }),
            );
            if (appendageFinalViews) continue;
            await button("站立").click();
            await whole();
            await yaw(90);
            await capture(filter, "side");
            if (!appendageDepthViews) {
              await yaw(180);
              await capture(filter, "rear");
            }
          }
          continue;
        }
        if (bakedVolumeAudit) {
          if (drawIsolationAudit) {
            await button("趴卧").click();
            await whole();
            await yaw(180);
            await page.evaluate(() => {
              const model = window.__filterModel;
              window.__filterIsolationMasks = new Map();
              model.scene.traverse((mesh) => {
                if (mesh.isMesh)
                  window.__filterIsolationMasks.set(mesh, mesh.layers.mask);
              });
            });
            if (kindIsolationAudit) {
              const labels = await readFile(
                "artifacts/fur-volume/draw-diagnostics/kind.bin",
              );
              const labelSHA = sha(labels);
              await page.evaluate(
                ({ base64, labelSHA }) => {
                  const model = window.__filterModel;
                  const body = model.fur.meshes.find(
                    (mesh) => mesh.userData.furRegion === "body",
                  );
                  window.__filterKindLabels = Uint8Array.from(
                    atob(base64),
                    (c) => c.charCodeAt(0),
                  );
                  window.__filterKindLabelSHA = labelSHA;
                  window.__filterOriginalBodyIndices =
                    body.geometry.index.array.slice();
                },
                { base64: labels.toString("base64"), labelSHA },
              );
            }
            const isolationReference =
              isolationSecondPass || kindIsolationAudit || isolationFinOnly
                ? JSON.parse(
                    await readFile(
                      "artifacts/fur-filter/volume-r14-draw-isolation/capture-report.json",
                      "utf8",
                    ),
                  ).frames.find(
                    (frame) => frame.context.isolation?.group === "baseline",
                  )
                : null;
            for (const group of isolationFinOnly
              ? ["body-fin"]
              : kindIsolationAudit
                ? ["kind0", "kind1", "kind2"]
                : isolationSecondPass
                  ? ["body-ribbons", "body-volume"]
                  : [
                      "baseline",
                      "undercoat",
                      "ruff",
                      "undercoat-and-ruff",
                      "native-source",
                      "native-only",
                    ]) {
              await page.evaluate(() => {
                for (const [mesh, mask] of window.__filterIsolationMasks)
                  mesh.layers.mask = mask;
                if (window.__filterOriginalBodyIndices) {
                  const body = window.__filterModel.fur.meshes.find(
                    (mesh) => mesh.userData.furRegion === "body",
                  );
                  body.geometry.index.array.set(
                    window.__filterOriginalBodyIndices,
                  );
                  body.geometry.index.needsUpdate = true;
                }
                window.__filterModel.fur.refresh({ full: true });
                window.__filterModel.scene.__r3f.root.getState().invalidate();
              });
              await settle();
              await page.evaluate((group) => {
                const model = window.__filterModel;
                const fur = model.fur.meshes;
                const undercoat = fur.filter((mesh) => mesh.userData.undercoat);
                const ruff = fur.filter(
                  (mesh) => mesh.userData.furRegion === "ruff",
                );
                const targets =
                  group === "undercoat"
                    ? undercoat
                    : group === "ruff"
                      ? ruff
                      : group === "undercoat-and-ruff"
                        ? [...undercoat, ...ruff]
                        : group === "native-source"
                          ? model.meshes
                          : group === "native-only"
                            ? fur
                            : group === "body-ribbons"
                              ? fur.filter(
                                  (mesh) => mesh.userData.furRegion === "body",
                                )
                              : group === "body-volume"
                                ? fur.filter(
                                    (mesh) =>
                                      mesh.userData.furVolumeRegion === "body",
                                  )
                                : group === "body-fin"
                                  ? fur.filter(
                                      (mesh) =>
                                        mesh.userData.furVolumeRegion ===
                                          "body" && mesh.userData.volumeFins,
                                    )
                                  : [];
                for (const mesh of targets) mesh.layers.mask = 0;
                window.__filterIsolationGroup = {
                  group,
                  method:
                    "One-shot object layer visibility mask; original masks restored before each group. No per-frame callback rewrites.",
                  hidden: targets.map((mesh) => ({
                    uuid: mesh.uuid,
                    name: mesh.name,
                    nativeSource: model.meshes.includes(mesh),
                    undercoat: !!mesh.userData.undercoat,
                    furRegion: mesh.userData.furRegion ?? null,
                    volumeRegion: mesh.userData.furVolumeRegion ?? null,
                  })),
                };
                if (/^kind[012]$/.test(group)) {
                  const body = fur.find(
                    (mesh) => mesh.userData.furRegion === "body",
                  );
                  const kind = Number(group.at(-1)),
                    prefix = body.userData.previewStrands,
                    stride = body.userData.strandIndices;
                  const original = window.__filterOriginalBodyIndices,
                    selected = [];
                  for (let root = 0; root < prefix; root++)
                    if (window.__filterKindLabels[root] === kind) {
                      body.geometry.index.array.set(
                        original.subarray(root * stride, (root + 1) * stride),
                        selected.length * stride,
                      );
                      selected.push(root);
                    }
                  body.geometry.index.needsUpdate = true;
                  body.geometry.setDrawRange(0, selected.length * stride);
                  window.__filterIsolationGroup.method =
                    "Show only one kind inside the original active prefix by copying its unchanged source indices into the original index buffer; full index backup restored before every group.";
                  window.__filterIsolationGroup.indexFilter = {
                    kind,
                    originalPreviewStrands: prefix,
                    selectedStrands: selected.length,
                    indexStride: stride,
                    expectedDrawCount: selected.length * stride,
                    labelSHA: window.__filterKindLabelSHA,
                    firstRootIds: selected.slice(0, 8),
                    lastRootIds: selected.slice(-8),
                  };
                }
                model.scene.__r3f.root.getState().invalidate();
              }, group);
              await capture(filter, `rest-rear-isolate-${group}`);
              const frame = frames.at(-1),
                hidden = new Set(
                  frame.context.isolation.hidden.map((mesh) => mesh.uuid),
                );
              const draws = [
                ...frame.context.actualDraws,
                ...frame.context.opaqueDraws,
              ];
              const hiddenDraws = draws.filter((draw) => hidden.has(draw.uuid));
              if (hiddenDraws.length)
                throw Error(`Isolation target actually drew: ${group}`);
              const baseline =
                frames.find(
                  (frame) => frame.context.isolation?.group === "baseline",
                ) ?? isolationReference;
              if (
                JSON.stringify(frame.context.camera) !==
                  JSON.stringify(baseline.context.camera) ||
                JSON.stringify(frame.context.lights) !==
                  JSON.stringify(baseline.context.lights)
              )
                throw Error(`Isolation camera/lights changed: ${group}`);
              drawIsolationChecks.push({
                group,
                hiddenTargets: hidden.size,
                actualHiddenDraws: hiddenDraws.length,
                hairDraws: frame.context.actualDraws.length,
                opaqueDraws: frame.context.opaqueDraws.length,
                cameraEqual: true,
                lightsEqual: true,
              });
              if (frame.context.isolation.indexFilter) {
                const bodyDraw = frame.context.actualDraws.find(
                  (draw) => draw.name === "Fur_Body",
                );
                if (
                  !bodyDraw ||
                  bodyDraw.drawRange.count !==
                    frame.context.isolation.indexFilter.expectedDrawCount
                )
                  throw Error(
                    `Kind-filter actual index draw did not match selected roots: ${group}`,
                  );
                drawIsolationChecks.at(-1).indexFilter =
                  frame.context.isolation.indexFilter;
                drawIsolationChecks.at(-1).actualBodyDrawRange =
                  bodyDraw.drawRange;
              }
              if (group === "baseline") {
                const reference = path.resolve(
                    "artifacts/fur-filter/volume-baked-r14-s0/long-legacy-rest-rear-baked-on.png",
                  ),
                  current = path.join(output, frame.file);
                const a = await sharp(reference).removeAlpha().raw().toBuffer(),
                  b = await sharp(current).removeAlpha().raw().toBuffer();
                let changed = 0,
                  maxDifference = 0,
                  difference = 0;
                for (let i = 0; i < a.length; i++) {
                  const d = Math.abs(a[i] - b[i]);
                  if (d) changed++;
                  maxDifference = Math.max(maxDifference, d);
                  difference += d;
                }
                nullTextureComparison = {
                  reference,
                  current,
                  changedChannels: changed,
                  maxDifference,
                  meanAbsoluteDifference255: difference / a.length,
                  pngEqual:
                    sha(await readFile(reference)) ===
                    sha(await readFile(current)),
                  note: "Current perspective baseline with v7 orthographic-only material update; raw differences reported without assuming equality.",
                };
              }
            }
            if (kindIsolationAudit)
              await page.evaluate(() => {
                const body = window.__filterModel.fur.meshes.find(
                  (mesh) => mesh.userData.furRegion === "body",
                );
                body.geometry.index.array.set(
                  window.__filterOriginalBodyIndices,
                );
                body.geometry.index.needsUpdate = true;
                body.geometry.setDrawRange(
                  0,
                  body.userData.previewStrands * body.userData.strandIndices,
                );
              });
            continue;
          }
          await whole();
          if (!skipNullControl) {
            await capture(filter, "whole-procedural-null");
            const reference = path.resolve(
              "artifacts/fur-filter/volume-round02/long-legacy-whole-volume-on.png",
            );
            const current = path.join(
              output,
              `${coat}-${filter}-whole-procedural-null.png`,
            );
            const a = await sharp(reference)
              .removeAlpha()
              .raw()
              .toBuffer({ resolveWithObject: true });
            const b = await sharp(current)
              .removeAlpha()
              .raw()
              .toBuffer({ resolveWithObject: true });
            let changed = 0,
              sceneChanged = 0,
              maxDifference = 0;
            if (
              a.info.width !== b.info.width ||
              a.info.height !== b.info.height
            )
              throw Error("Null density control image dimensions changed");
            for (let i = 0; i < a.data.length; i++)
              if (a.data[i] !== b.data[i]) {
                changed++;
                if (Math.floor(i / (a.info.width * 3)) >= 18) sceneChanged++;
                maxDifference = Math.max(
                  maxDifference,
                  Math.abs(a.data[i] - b.data[i]),
                );
              }
            nullTextureComparison = {
              reference,
              current,
              changedChannels: changed,
              sceneChangedChannels: sceneChanged,
              maxDifference,
              pngEqual:
                sha(await readFile(reference)) === sha(await readFile(current)),
            };
            await writeFile(
              path.join(output, "null-texture-comparison.json"),
              JSON.stringify(nullTextureComparison, null, 2),
            );
            if (sceneChanged)
              throw Error(
                "Null-texture scene differs from round02; inspect the single control before more captures",
              );
          } else
            nullTextureComparison = {
              skipped: true,
              reason:
                "Container geometry, shell path metric and density data intentionally changed together; no old-null pixel-identity claim.",
            };
          await page.evaluate(() => {
            const data = window.__filterBakedDensity,
              t = window.__densityTextureTools;
            window.__filterModel.fur.setVolumeDensity(
              data.texture,
              data.metadata.densityScale,
              new t.Vector4(...data.metadata.uvTransform),
            );
            data.enabled = true;
            window.__filterModel.scene.__r3f.root.getState().invalidate();
          });
          await capture(filter, "whole-baked-on");
          await yaw(90);
          await capture(filter, "side-baked-on");
          await yaw(180);
          await capture(filter, "rear-baked-on");
          await button("趴卧").click();
          await whole();
          await yaw(180);
          await capture(filter, "rest-rear-baked-on");
          continue;
        }
        if (volumeAudit) {
          await whole();
          await captureVolumePair(filter, "whole");
          await yaw(90);
          await captureVolumePair(filter, "side");
          await yaw(180);
          await captureVolumePair(filter, "rear");
          await button("趴卧").click();
          await whole();
          await yaw(180);
          await captureVolumePair(filter, "rest-rear");
          await button("站立").click();
          continue;
        }
        if (lodAudit) {
          await whole();
          await yaw(180);
          await captureLodPair(filter, "rear");
          await button("趴卧").click();
          await whole();
          await yaw(180);
          await captureLodPair(filter, "rest-rear");
          await button("站立").click();
          await whole();
          await yaw(90);
          await captureLodPair(filter, "side");
          continue;
        }
        await settle();
        await button("三分之四").click();
        if (!anglesOnly) {
          if (!layerViews || coat === "long") await capture(filter, "head");
          if (headsOnly) continue;
          await whole();
          await capture(filter, "whole");
          if (layerViews) {
            if (coat === "long") {
              await yaw(90);
              await capture(filter, "side");
              await yaw(180);
              await capture(filter, "rear");
              await button("趴卧").click();
              await whole();
              await yaw(180);
              await capture(filter, "rest-rear");
              await button("站立").click();
            }
            continue;
          }
          if (coreViews || geometryViews) {
            await yaw(90);
            await capture(filter, "side");
            if (geometryViews) {
              if (coat === "long") {
                await yaw(180);
                await capture(filter, "rear");
                await button("趴卧").click();
                await whole();
                await capture(filter, "rest-whole");
                await yaw(180);
                await capture(filter, "rest-rear");
                await button("站立").click();
              }
              await page.setViewportSize({ width: 390, height: 844 });
              await button("三分之四").click();
              await settle();
              await capture(filter, "phone-head");
              await page.screenshot({
                path: path.join(output, `${coat}-${filter}-phone-page.png`),
                fullPage: true,
              });
              await page.setViewportSize({ width: 1365, height: 900 });
              await settle();
            }
            continue;
          }
          if (coat === "long") {
            await capture(filter, "white-chest", {
              x: 200,
              y: 190,
              width: 135,
              height: 135,
            });
            await capture(filter, "gray-flank", {
              x: 365,
              y: 210,
              width: 130,
              height: 115,
            });
          }
          if (poseAudit) {
            await button("趴卧").click();
            await whole();
            await capture(filter, "rest-whole");
            await button("三分之四").click();
            await capture(filter, "rest-head");
            await button("头型").click();
            await page.locator("#creator-headWidth").press("End");
            await page.locator("#creator-headDepth").press("Home");
            await page.locator("#creator-cheeks").press("End");
            await button("鼻口").click();
            await page.locator("#creator-muzzle").press("End");
            await page.locator("#creator-muzzleWidth").press("Home");
            await whole();
            await capture(filter, "combined-rest");
            await button("自然脸").click();
            await button("站立").click();
            await button("头型").click();
          }
        }
        if (angles) {
          await whole();
          await yaw(90);
          await capture(filter, "side");
          await yaw(180);
          await capture(filter, "rear");
          if (coat === "long") {
            await button("趴卧").click();
            await whole();
            await yaw(180);
            await capture(filter, "rest-rear");
            await button("站立").click();
          }
        }
      }
    } finally {
      if (bakedVolumeAudit)
        await page
          .evaluate(() => {
            if (window.__filterBakedDensity) {
              window.__filterModel.fur.setVolumeDensity(null);
              window.__filterBakedDensity.texture.dispose();
            }
          })
          .catch(() => {});
      await context.close();
    }
  }
  const sourcesAfter = {};
  for (const file of Object.keys(sources))
    sourcesAfter[file] = sha(await readFile(file));
  const changed = Object.keys(sources).filter(
    (file) => sources[file] !== sourcesAfter[file],
  );
  const report = {
    phase,
    densityVariant,
    capturedAt: new Date().toISOString(),
    method: volumeWidthAudit
      ? "Actual localhost studio prototype A/B; camera, lights, LOD and compositor held fixed. Prototype ON intentionally narrows body trunk strand widths and replaces bulk down with volume shells/fins; centres, normals, physical width ratios and unchanged regions are audited rather than claiming identical body geometry. Unedited page/canvas screenshots."
      : "Actual localhost studio; validated material metadata selects the official compositor/backend; disposable page wrappers only observe actual draw calls. Same live geometry, camera, lights, LOD and compositor. Unedited page/canvas/ROI screenshots.",
    baseline: "artifacts/fur-filter/before",
    sources,
    sourcesAfter,
    changed,
    modelSHA,
    settings,
    frames,
    lodPairs,
    volumePairs,
    nullTextureComparison,
    drawIsolationChecks,
    totalWallMs: Date.now() - captureStarted,
    errors,
  };
  await writeFile(
    path.join(output, "capture-report.json"),
    JSON.stringify(report, null, 2),
  );
  if (changed.length || errors.length)
    throw Error("Sources changed or runtime errors");
  for (const frame of frames) {
    if (
      frame.context.alpha !== false ||
      frame.context.mode !== "weighted" ||
      frame.context.toneMapping !== 6 ||
      frame.context.error !== 0
    )
      throw Error(`Unexpected live renderer ${frame.file}`);
    if (
      frame.context.geometryMode !==
      (frame.volumeEnabled
        ? "hybrid"
        : frame.filter === "legacy"
          ? "ribbons"
          : "segments")
    )
      throw Error(`Wrong actual backend ${frame.file}`);
    if (
      !drawIsolationAudit &&
      (frame.context.actualDraws.length !==
        (frame.volumeEnabled
          ? 3 +
            frame.context.volumeMeshes.filter(
              (mesh) => mesh.visible && mesh.drawRange.count > 0,
            ).length
          : 3) ||
        frame.context.actualDraws.some(
          (d) => d.instanced !== (frame.filter !== "legacy"),
        ))
    )
      throw Error(`Wrong actual draw ${frame.file}`);
    for (const region of frame.context.regions)
      if (
        region.actualFilter !== frame.filter ||
        region.axis.mixedFallback ||
        region.axis.sideMismatch
      )
        throw Error(`Unexpected filter/axis ${frame.file}`);
  }
  console.log(
    JSON.stringify({
      output,
      images: frames.length,
      errors,
      changed,
      modelSHA,
    }),
  );
} catch (error) {
  const sourcesAfter = {};
  for (const file of Object.keys(sources))
    sourcesAfter[file] = sha(await readFile(file));
  await writeFile(
    path.join(output, "partial-failure-report.json"),
    JSON.stringify(
      {
        phase,
        capturedAt: new Date().toISOString(),
        complete: false,
        failure: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
        sources,
        sourcesAfter,
        changed: Object.keys(sources).filter(
          (file) => sources[file] !== sourcesAfter[file],
        ),
        modelSHA,
        settings,
        frames,
        lodPairs,
        volumePairs,
        nullTextureComparison,
        drawIsolationChecks,
        totalWallMs: Date.now() - captureStarted,
        errors,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
