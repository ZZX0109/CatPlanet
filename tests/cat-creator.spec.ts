import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { build } from "esbuild";
import sharp from "sharp";
import {
  defaultCreatorDesign,
  parseCreatorDesign,
} from "../lib/cat-creator-design";
import { getCatCoatProfile } from "../lib/cat-coat-profiles";

const STORAGE_KEY = "miaoxing.cat-creator.foundation.v1";
const PREVIOUS_STORAGE_KEY = "miaoxing.cat-creator.norwegian.v1";
const LEGACY_STORAGE_KEY = "miaoxing.cat-creator.v2";
const ARTIFACTS = "artifacts/table-refinement/regression";
const ASSET_URL = "/models/creator/norwegian-cat.glb";

type AssetProbe = {
  meshes: number;
  skinnedMeshes: number;
  bones: number;
  vertices: number;
  finite: boolean;
  uvVertices: number;
  texturedMeshes: number;
  targets: Record<string, number>;
  template: string | null;
  coatType: string | null;
  meshNames: string[];
  license: string | null;
  animationClips: number;
  animationTracks: number;
  animationDuration: number;
  animationTracksFinite: boolean;
  unboundTracks: string[];
  surfaceVertices: number;
  surfaceUvVertices: number;
  surfaceTexturedMeshes: number;
  undercoat: {
    meshes: number;
    vertices: number;
    triangles: number;
    uvVertices: number;
    texturedMeshes: number;
    finite: boolean;
    names: string[];
  };
  pawGround: Record<string, number>;
  fur: Record<
    string,
    {
      vertices: number;
      triangles: number;
      strands: number;
      strandVertices: number;
      strandSegments: number;
      strandIndices: number;
      uvError: number;
      finite: boolean;
      bounds: number[];
      positions: number[];
      roots: number[];
      rootSurfaceDistance: number;
    }
  >;
};
type RoundtripProbe = {
  source: AssetProbe;
  exported: AssetProbe;
  comparison: {
    matchedMeshes: number;
    sameTopology: boolean;
    changedVertices: number;
    unchangedVertices: number;
    maxDisplacement: number;
  };
};
let probeScript: Promise<string> | undefined;

function probeBundle() {
  return (probeScript ??= build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "js",
      contents: `
        import * as THREE from 'three';
        import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
        window.__probeNorwegianRoundtrip = async (originalUrl, roundtripUrl) => {
          const resources = [];
          async function load(url) {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Missing cat GLB');
            const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
            resources.push(gltf.scene);
            gltf.scene.updateMatrixWorld(true);
            gltf.scene.traverse(node => { if (node.isSkinnedMesh) node.skeleton.update(); });
            return gltf;
          }
          function inspect(gltf) {
            const data = { meshes:0, skinnedMeshes:0, bones:0, vertices:0, finite:true,
              uvVertices:0, texturedMeshes:0, targets:{}, template:null, coatType:null, meshNames:[], license:null,
              animationClips:gltf.animations.length, animationTracks:0, animationDuration:0,
              animationTracksFinite:true, unboundTracks:[],
              surfaceVertices:0, surfaceUvVertices:0, surfaceTexturedMeshes:0, pawGround:{}, fur:{},
              undercoat:{meshes:0,vertices:0,triangles:0,uvVertices:0,texturedMeshes:0,finite:true,names:[]} };
            const records = new Map(), skeletonBones = new Set();
            gltf.scene.traverse(mesh => {
              if (mesh.userData.miaoxingCreatorDesign) {
                data.template = mesh.userData.miaoxingCreatorDesign.templateId;
                data.coatType = mesh.userData.miaoxingCreatorDesign.coatType;
              }
              if (mesh.userData.license) data.license = mesh.userData.license;
              if (!mesh.isMesh) return;
              data.meshNames.push(mesh.name);
              data.meshes++;
              if (mesh.isSkinnedMesh) { data.skinnedMeshes++; mesh.skeleton.bones.forEach(bone => skeletonBones.add(bone)); }
              const base = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
              data.vertices += base.count; data.uvVertices += mesh.geometry.getAttribute('uv')?.count || 0;
              const textured=(Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some(material => !!material.map);
              if(textured) data.texturedMeshes++;
              const isUndercoat=!!mesh.userData.undercoat;
              const isGroom=!!mesh.userData.norwegianFur || !!mesh.userData.furRegion || /^Fur_/.test(mesh.name);
              const isFur=isGroom&&!isUndercoat&&!mesh.userData.groomDetail;
              if(!isGroom) {data.surfaceVertices+=base.count; data.surfaceUvVertices+=mesh.geometry.getAttribute('uv')?.count||0; if(textured)data.surfaceTexturedMeshes++;}
              const positions = new Float64Array(base.count*3), point = new THREE.Vector3();
              for (let i=0;i<base.count;i++) {
                mesh.getVertexPosition(i, point); point.applyMatrix4(mesh.matrixWorld);
                for (let axis=0;axis<3;axis++) { const value=point.getComponent(axis); positions[i*3+axis]=value; data.finite &&= Number.isFinite(value); }
              }
              if(mesh.isSkinnedMesh&&!isGroom) {
                const joints=mesh.geometry.getAttribute('skinIndex'), weights=mesh.geometry.getAttribute('skinWeight');
                const soleGroups=mesh.skeleton.bones.map(bone=>{
                  const match=/^Panther([LR])Leg(?:Palm|Digit0[12])(.*)$/.exec(bone.name);
                  return match ? match[1]+(match[2]?'Fore':'Hind') : null;
                });
                if(joints&&weights)for(let i=0;i<base.count;i++) {
                  const totals={};
                  for(let component=0;component<4;component++) {
                    const group=soleGroups[joints.getComponent(i,component)];
                    if(group)totals[group]=(totals[group]||0)+weights.getComponent(i,component);
                  }
                  for(const [group,weight] of Object.entries(totals))if(weight>.75)
                    data.pawGround[group]=Math.min(data.pawGround[group]??Infinity,positions[i*3+1]);
                }
              }
              for (const attributes of Object.values(mesh.geometry.morphAttributes)) for (const attribute of attributes) {
                if (attribute.count !== base.count) throw new Error('Mismatched morph topology');
                for (const value of attribute.array) data.finite &&= Number.isFinite(value);
              }
              for (const [name,n] of Object.entries(mesh.morphTargetDictionary || {})) data.targets[name] = mesh.morphTargetInfluences[n];
              if(!isGroom)records.set(mesh.name, {positions, count:base.count, index:index?Array.from(index.array):null});
              if(isUndercoat) {
                data.undercoat.meshes++; data.undercoat.names.push(mesh.name);
                data.undercoat.vertices+=base.count; data.undercoat.triangles+=(index?.count||base.count)/3;
                data.undercoat.uvVertices+=mesh.geometry.getAttribute('uv')?.count||0;
                if(textured)data.undercoat.texturedMeshes++;
                data.undercoat.finite&&=positions.every(Number.isFinite);
              }
              if(isFur) {
                const box=new THREE.Box3(), p=new THREE.Vector3();
                for(let i=0;i<positions.length;i+=3)box.expandByPoint(p.fromArray(positions,i));
                const stride=mesh.userData.strandVertices,segments=mesh.userData.strandSegments,indexStride=mesh.userData.strandIndices,uv=mesh.geometry.attributes.uv,count=mesh.userData.strandCount;
                if(stride!==2*(segments+1)||indexStride!==segments*12)throw new Error('Invalid groom segment topology');
                if((mesh.userData.coatType==='short'&&stride!==10)||(mesh.userData.coatType==='long'&&stride!==18))throw new Error('Wrong coat-specific segment topology');
                if(base.count!==count*stride||index?.count!==count*indexStride||uv?.count!==base.count)throw new Error('Incomplete exported groom');
                let uvError=0;for(let strand=0;strand<Math.min(count,12);strand++)for(let sample=0;sample<=segments;sample++)for(let side=0;side<2;side++){const vertex=strand*stride+sample*2+side;uvError=Math.max(uvError,Math.abs(uv.getX(vertex)-side),Math.abs(uv.getY(vertex)-sample/segments));}
                if(uvError>1e-4)throw new Error('Incorrect strand texture coordinates');
                data.fur[mesh.name]={vertices:base.count,triangles:(index?.count||base.count)/3,strandVertices:stride,strandSegments:segments,strandIndices:indexStride,uvError,
                  strands:mesh.userData.strandCount||0,finite:positions.every(Number.isFinite),
                  bounds:box.getSize(p).toArray(),positions:Array.from(positions.slice(0,stride*3*10)),roots:[],rootSurfaceDistance:0};
                for(let i=0;i<Math.min(base.count,stride*12);i+=stride) {
                  // The paired root vertices are the actual strand geometry,
                  // not a UI counter; their midpoint should remain on skin.
                  for(let axis=0;axis<3;axis++)data.fur[mesh.name].roots.push((positions[i*3+axis]+positions[(i+1)*3+axis])/2);
                }
              }
            });
            data.bones=skeletonBones.size;
            const surfaceRecords=[...records.entries()].filter(([name])=>!data.fur[name]).map(([,record])=>record);
            const triangle=new THREE.Triangle(), sample=new THREE.Vector3(), nearest=new THREE.Vector3();
            for(const fur of Object.values(data.fur))for(let r=0;r<fur.roots.length;r+=3) {
              sample.fromArray(fur.roots,r);let minimum=Infinity;
              for(const surface of surfaceRecords) {
                const count=surface.index?.length||surface.count;
                for(let i=0;i<count;i+=3) {
                  triangle.a.fromArray(surface.positions,(surface.index?.[i]??i)*3);
                  triangle.b.fromArray(surface.positions,(surface.index?.[i+1]??i+1)*3);
                  triangle.c.fromArray(surface.positions,(surface.index?.[i+2]??i+2)*3);
                  triangle.closestPointToPoint(sample,nearest);minimum=Math.min(minimum,nearest.distanceTo(sample));
                }
              }
              fur.rootSurfaceDistance=Math.max(fur.rootSurfaceDistance,minimum);
            }
            const mixer = new THREE.AnimationMixer(gltf.scene);
            for (const clip of gltf.animations) {
              data.animationTracks += clip.tracks.length;
              data.animationDuration = Math.max(data.animationDuration, clip.duration);
              for (const track of clip.tracks) {
                const parsed = THREE.PropertyBinding.parseTrackName(track.name);
                if (!THREE.PropertyBinding.findNode(gltf.scene, parsed.nodeName)) data.unboundTracks.push(track.name);
                for (const value of [...track.times, ...track.values]) data.animationTracksFinite &&= Number.isFinite(value);
              }
              // Binding an actual mixer action also catches stale track targets
              // in the cloned/exported skeleton, beyond counting JSON records.
              const action = mixer.clipAction(clip).play();
              mixer.update(0);
              action.stop();
            }
            mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
            return {data,records};
          }
          try {
            const original=inspect(await load(originalUrl)), exported=inspect(await load(roundtripUrl));
            const comparison={matchedMeshes:0,sameTopology:true,changedVertices:0,unchangedVertices:0,maxDisplacement:0};
            for (const [name,source] of original.records) {
              const other=exported.records.get(name);
              if (!other || source.count!==other.count) { comparison.sameTopology=false; continue; }
              comparison.matchedMeshes++;
              if (JSON.stringify(source.index)!==JSON.stringify(other.index)) comparison.sameTopology=false;
              for(let i=0;i<source.count;i++) {
                const offset=i*3;
                const d=Math.hypot(...[0,1,2].map(axis=>other.positions[offset+axis]-source.positions[offset+axis]));
                comparison.maxDisplacement=Math.max(comparison.maxDisplacement,d);
                if(d>1e-5) comparison.changedVertices++; else comparison.unchangedVertices++;
              }
            }
            return {source:original.data,exported:exported.data,comparison};
          } finally {
            const geometries=new Set(),materials=new Set(),textures=new Set();
            for(const scene of resources) scene.traverse(node=>{ if(!node.isMesh)return; geometries.add(node.geometry);
              for(const material of Array.isArray(node.material)?node.material:[node.material]) { materials.add(material);
                for(const value of Object.values(material)) if(value?.isTexture) textures.add(value); }
            });
            for(const geometry of geometries)geometry.dispose(); for(const material of materials)material.dispose();
            for(const texture of textures){ texture.image?.close?.();texture.dispose(); }
          }
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
  await expect(page.locator('[data-creator-ready="true"]')).toBeVisible({
    timeout: 60_000,
  });
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
async function frame(page: Page, name: string) {
  await rendered(page);
  return page
    .locator("canvas")
    .screenshot({ path: `${ARTIFACTS}/${name}.png` });
}
async function changedPixels(before: Buffer, after: Buffer) {
  const first = await sharp(before)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const second = await sharp(after)
    .resize(first.info.width, first.info.height)
    .ensureAlpha()
    .raw()
    .toBuffer();
  let count = 0;
  for (let i = 0; i < first.data.length; i += 4)
    if (
      [0, 1, 2].some(
        (axis) => Math.abs(first.data[i + axis] - second[i + axis]) > 7,
      )
    )
      count++;
  return count;
}
async function openBackups(page: Page) {
  const details = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "备份与导出" }) });
  if (
    !(await details.evaluate((element) => (element as HTMLDetailsElement).open))
  )
    await details.locator("summary").click();
}
/** Select the short foundation explicitly for geometry and coat regressions. */
async function enableCompleteGroom(page: Page) {
  await page.getByRole("button", { name: "短毛猫", exact: true }).click();
  await ready(page);
  await page.getByRole("button", { name: "毛发", exact: true }).click();
  await page
    .getByRole("button", { name: "完整被毛", exact: true })
    .click();
  await ready(page);
  await page.getByRole("button", { name: "头型", exact: true }).click();
  await rendered(page);
}
async function expectCompleteCoatControls(
  page: Page,
  shape: Record<string, number>,
) {
  await expect(
    page.getByRole("button", { name: "完整被毛", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("slider")).toHaveCount(6);
  for (const key of [
    "headFurDensity",
    "headFurLength",
    "ruffFurDensity",
    "ruffFurLength",
    "bodyFurDensity",
    "bodyFurLength",
  ])
    await expect(page.locator(`#creator-${key}`)).toHaveValue(String(shape[key]));
}
async function exportAndProbe(
  page: Page,
  info: TestInfo,
  name: string,
  originalUrl = ASSET_URL,
): Promise<RoundtripProbe> {
  await openBackups(page);
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出 3D 模型（GLB）", exact: true })
    .click();
  const download = await downloading;
  const path = info.outputPath(`${name}.glb`);
  await download.saveAs(path);
  const bytes = await readFile(path);
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
  expect(bytes.readUInt32LE(8)).toBe(bytes.length);
  const json = JSON.parse(
    bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
  );
  for (const node of json.nodes ?? [])
    if (node.extras?.norwegianFur)
      for (const primitive of json.meshes[node.mesh].primitives) {
        if (node.extras.undercoat) {
          expect(primitive.attributes.TEXCOORD_0).toBeDefined();
          expect(
            json.materials[primitive.material].pbrMetallicRoughness
              .baseColorTexture,
          ).toBeDefined();
          continue;
        }
        // The portable geometry carries both triangle windings. Keeping this
        // material single-sided prevents reverse skin normals from darkening
        // half of the white fibres in other GLB viewers.
        expect(json.materials[primitive.material].doubleSided ?? false).toBe(
          false,
        );
        expect(primitive.attributes.COLOR_0).toBeDefined();
      }
  await page.addScriptTag({ content: await probeBundle() });
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "model/gltf-binary",
      "Content-Length": bytes.length,
      "Access-Control-Allow-Origin": "http://localhost:3000",
    });
    response.end(bytes);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No roundtrip server");
  try {
    return await page.evaluate(
      ({ original, exported }) =>
        (
          window as unknown as {
            __probeNorwegianRoundtrip(
              original: string,
              exported: string,
            ): Promise<RoundtripProbe>;
          }
        ).__probeNorwegianRoundtrip(original, exported),
      {
        original: originalUrl,
        exported: `http://127.0.0.1:${address.port}/cat.glb`,
      },
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const legacy = JSON.stringify({
  schemaVersion: 2,
  templateId: "structural-cat-v2",
  shape: { headWidth: 100, furDensity: 70, furLength: 50 },
});

test("cat foundation editor preserves the source rig and changes real geometry through export, save and reload", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await mkdir(ARTIFACTS, { recursive: true });
  const errors: string[] = [];
  const bindingWarnings: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      /PropertyBinding|No target node|could not bind|track.*not found/i.test(
        message.text(),
      )
    )
      bindingWarnings.push(message.text());
  });
  await page.addInitScript(
    ({ key, value }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, value);
    },
    { key: LEGACY_STORAGE_KEY, value: legacy },
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/studio/base");
  await ready(page);
  await enableCompleteGroom(page);
  const width = page.getByRole("slider", { name: "头部宽度", exact: true });
  await expect(width).toHaveValue("50");
  await page.getByRole("button", { name: "灰模", exact: true }).click();
  await page.getByRole("button", { name: "正面", exact: true }).click();
  const baseline = await frame(page, "neutral-grey-front");
  const neutral = await exportAndProbe(page, info, "neutral");
  expect(neutral.exported.finite).toBe(true);
  expect(neutral.exported.template).toBe("cat-foundation-v1");
  expect(neutral.exported.skinnedMeshes).toBeGreaterThan(0);
  expect(neutral.exported.bones).toBe(neutral.source.bones);
  expect(neutral.exported.bones).toBeGreaterThanOrEqual(40);
  expect(Object.keys(neutral.source.pawGround)).toHaveLength(4);
  const soleHeights = Object.values(neutral.source.pawGround);
  expect(Math.max(...soleHeights) - Math.min(...soleHeights)).toBeLessThan(
    0.003,
  );
  expect(Math.max(...soleHeights.map(Math.abs))).toBeLessThan(0.003);
  expect(neutral.source.animationClips).toBeGreaterThan(0);
  // Fur is baked to this standing pose; exporting the original walking clip
  // beside static fibres would make external viewers detach the coat.
  expect(neutral.exported.animationClips).toBe(0);
  expect(neutral.source.animationTracks).toBeGreaterThan(0);
  expect(neutral.exported.animationTracks).toBe(0);
  expect(neutral.exported.animationDuration).toBe(0);
  expect(neutral.exported.animationTracksFinite).toBe(true);
  expect(neutral.source.unboundTracks).toEqual([]);
  expect(neutral.exported.unboundTracks).toEqual([]);
  expect(neutral.exported.surfaceUvVertices).toBe(
    neutral.source.surfaceUvVertices,
  );
  expect(neutral.exported.surfaceTexturedMeshes).toBe(
    neutral.source.surfaceTexturedMeshes,
  );
  expect(neutral.comparison.sameTopology).toBe(true);
  expect(neutral.comparison.matchedMeshes).toBe(neutral.source.meshes);
  expect(neutral.comparison.maxDisplacement).toBeLessThan(0.00003);
  expect(Object.keys(neutral.exported.targets).length).toBeGreaterThanOrEqual(
    20,
  );
  expect(neutral.exported.license).not.toBe("CC0-1.0");
  expect(Object.keys(neutral.exported.fur)).toHaveLength(3);
  for (const fur of Object.values(neutral.exported.fur)) {
    expect(fur.vertices).toBeGreaterThan(1000);
    expect(fur.triangles).toBeGreaterThan(1000);
    expect(fur.finite).toBe(true);
    expect(fur.rootSurfaceDistance).toBeLessThan(0.008);
  }
  await width.press("End");
  const edited = await frame(page, "wide-grey-front");
  const pixelChange = await changedPixels(baseline, edited);
  expect(pixelChange).toBeGreaterThan(500);
  const shaped = await exportAndProbe(page, info, "wide");
  expect(shaped.exported.finite).toBe(true);
  expect(shaped.exported.animationClips).toBe(0);
  expect(shaped.exported.animationTracks).toBe(0);
  expect(shaped.exported.animationTracksFinite).toBe(true);
  expect(shaped.exported.unboundTracks).toEqual([]);
  expect(shaped.comparison.sameTopology).toBe(true);
  expect(shaped.comparison.changedVertices).toBeGreaterThan(100);
  expect(shaped.comparison.maxDisplacement).toBeGreaterThan(0.01);
  expect(shaped.comparison.unchangedVertices).toBeGreaterThan(
    shaped.source.vertices * 0.35,
  );
  expect(shaped.exported.targets.Shape_headWidth_high).toBe(1);
  const neutralHead = neutral.exported.fur.Fur_Head;
  const editedHead = shaped.exported.fur.Fur_Head;
  expect(editedHead.rootSurfaceDistance).toBeLessThan(0.008);
  expect(
    editedHead.roots.some(
      (value, index) => Math.abs(value - neutralHead.roots[index]) > 0.001,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "保存外观", exact: true }).click();
  const saved = await page.evaluate(
    (key) => localStorage.getItem(key),
    STORAGE_KEY,
  );
  expect(JSON.parse(saved!)).toMatchObject({
    schemaVersion: 5,
    templateId: "cat-foundation-v1",
    coatType: "short",
    coatMode: "groom",
    shape: { headWidth: 100 },
  });
  expect(
    await page.evaluate((key) => localStorage.getItem(key), LEGACY_STORAGE_KEY),
  ).toBe(legacy);
  await page.reload();
  await ready(page);
  await expect(width).toHaveValue("100");
  await openBackups(page);
  // Earlier v3 saves have the same face topology and should recover their face
  // while acquiring the new groom defaults, without overwriting stored data.
  const previousV3 = {
    ...JSON.parse(saved!),
    schemaVersion: 3,
    templateId: "norwegian-cat-v1",
  };
  delete previousV3.coatType;
  delete previousV3.coatMode;
  for (const key of Object.keys(previousV3.shape))
    if (/Fur/.test(key)) delete previousV3.shape[key];
  await page.getByLabel("导入外观 JSON", { exact: true }).setInputFiles({
    name: "before-fur-v3.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(previousV3)),
  });
  await expect(width).toHaveValue("100");
  await page.getByRole("button", { name: "毛发", exact: true }).click();
  await expectCompleteCoatControls(page, {
    headFurDensity: 75,
    headFurLength: 40,
    ruffFurDensity: 75,
    ruffFurLength: 55,
    bodyFurDensity: 75,
    bodyFurLength: 45,
  });
  await ready(page);
  await page.getByRole("button", { name: "头型", exact: true }).click();
  await openBackups(page);
  await page.getByLabel("导入外观 JSON", { exact: true }).setInputFiles({
    name: "legacy.json",
    mimeType: "application/json",
    buffer: Buffer.from(legacy),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: /导入/ }),
  ).toBeVisible();
  await expect(width).toHaveValue("100");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
  ).toBe(saved);
  const jsonDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出外观 JSON", exact: true })
    .click();
  const json = await jsonDownload;
  const jsonPath = info.outputPath("appearance.json");
  await json.saveAs(jsonPath);
  expect(JSON.parse(await readFile(jsonPath, "utf8"))).toEqual(
    parseCreatorDesign(previousV3),
  );
  await page.getByRole("button", { name: "全身", exact: true }).click();
  await frame(page, "whole-body");
  const canvas = page.locator("canvas"),
    box = await canvas.boundingBox();
  const beforeRotation = await frame(page, "before-rotation");
  await page.mouse.move(
    box!.x + box!.width * 0.65,
    box!.y + box!.height * 0.45,
  );
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.4, box!.y + box!.height * 0.5, {
    steps: 8,
  });
  await page.mouse.up();
  const afterRotation = await frame(page, "after-rotation");
  expect(await changedPixels(beforeRotation, afterRotation)).toBeGreaterThan(
    1500,
  );
  await writeFile(
    `${ARTIFACTS}/roundtrip-validation.json`,
    JSON.stringify(
      {
        neutral,
        shaped,
        renderedPixelChange: pixelChange,
        legacyRecordPreserved: true,
        scope:
          "Real browser render, exported GLB reloaded with Three.js, local save/restore and template isolation. This does not certify art quality or physical mobile performance.",
      },
      null,
      2,
    ),
  );
  expect(errors).toEqual([]);
  expect(bindingWarnings).toEqual([]);
});

function strandMeanLength(fur: AssetProbe["fur"][string]) {
  const { positions, strandVertices, strandSegments } = fur;
  const stride = strandVertices * 3;
  let total = 0,
    count = 0;
  for (let start = 0; start + stride <= positions.length; start += stride) {
    let length = 0;
    for (let point = 1; point <= strandSegments; point++) {
      let squared = 0;
      for (let axis = 0; axis < 3; axis++) {
        const current =
          (positions[start + point * 6 + axis] +
            positions[start + point * 6 + 3 + axis]) /
          2;
        const previous =
          (positions[start + (point - 1) * 6 + axis] +
            positions[start + (point - 1) * 6 + 3 + axis]) /
          2;
        squared += (current - previous) ** 2;
      }
      length += Math.sqrt(squared);
    }
    total += length;
    count++;
  }
  return total / Math.max(1, count);
}

test("regional coat controls change exported strands and lengths independently and recover saved settings", async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  await mkdir(ARTIFACTS, { recursive: true });
  await page.goto("/studio/base");
  await ready(page);
  await enableCompleteGroom(page);
  await page.getByRole("button", { name: "全身", exact: true }).click();
  await page.getByRole("button", { name: "毛发", exact: true }).click();
  const density = page.getByRole("slider", { name: "头部毛量", exact: true });
  const headLength = page.getByRole("slider", {
    name: "头部毛长",
    exact: true,
  });
  const bodyLength = page.getByRole("slider", {
    name: "身体毛长",
    exact: true,
  });
  const baseline = await exportAndProbe(page, info, "fur-baseline");
  const baselineFrame = await frame(page, "coat-whole-default");
  await density.press("Home");
  const baldHead = await exportAndProbe(page, info, "fur-head-zero");
  expect(baldHead.exported.fur.Fur_Head).toBeUndefined();
  expect(baldHead.exported.fur.Fur_Body.positions).toEqual(
    baseline.exported.fur.Fur_Body.positions,
  );
  expect(baldHead.exported.fur.Fur_Ruff.positions).toEqual(
    baseline.exported.fur.Fur_Ruff.positions,
  );
  expect(baldHead.comparison.maxDisplacement).toBeLessThan(0.00003);
  await density.press("End");
  await headLength.press("End");
  await bodyLength.press("Home");
  const edited = await exportAndProbe(page, info, "fur-long-head-short-body");
  const beforeHead = baseline.exported.fur.Fur_Head,
    afterHead = edited.exported.fur.Fur_Head;
  expect(afterHead.triangles).toBeGreaterThan(beforeHead.triangles);
  expect(strandMeanLength(afterHead)).toBeGreaterThan(
    strandMeanLength(beforeHead) * 1.15,
  );
  afterHead.roots.forEach((coordinate, index) =>
    expect(coordinate).toBeCloseTo(beforeHead.roots[index], 5),
  );
  expect(afterHead.rootSurfaceDistance).toBeLessThan(0.008);
  expect(strandMeanLength(edited.exported.fur.Fur_Body)).toBeLessThan(
    strandMeanLength(baseline.exported.fur.Fur_Body) * 0.85,
  );
  expect(edited.exported.fur.Fur_Ruff.positions).toEqual(
    baseline.exported.fur.Fur_Ruff.positions,
  );
  expect(edited.comparison.maxDisplacement).toBeLessThan(0.00003);
  const changedFrame = await frame(page, "coat-long-head-short-body");
  expect(await changedPixels(baselineFrame, changedFrame)).toBeGreaterThan(300);
  await page.getByRole("button", { name: "保存外观", exact: true }).click();
  const saved = await page.evaluate(
    (key) => localStorage.getItem(key),
    STORAGE_KEY,
  );
  expect(JSON.parse(saved!).shape).toMatchObject({
    headFurDensity: 100,
    headFurLength: 100,
    bodyFurLength: 0,
  });
  await page.reload();
  await ready(page);
  await page.getByRole("button", { name: "毛发", exact: true }).click();
  await expect(density).toHaveValue("100");
  await expect(headLength).toHaveValue("100");
  await expect(bodyLength).toHaveValue("0");
  // A face preset must preserve the owner's independently chosen coat.
  await page.getByRole("button", { name: "圆润脸", exact: true }).click();
  await expect(headLength).toHaveValue("100");
  await expect(bodyLength).toHaveValue("0");
  await page.getByRole("button", { name: "重置部位", exact: true }).click();
  await expect(density).toHaveValue(
    String(getCatCoatProfile("short").defaults.headFurDensity),
  );
  await expect(headLength).toHaveValue(
    String(getCatCoatProfile("short").defaults.headFurLength),
  );
  await expect(bodyLength).toHaveValue(
    String(getCatCoatProfile("short").defaults.bodyFurLength),
  );
  for (const label of ["头部毛量", "胸颈毛量", "身体毛量"])
    await page.getByRole("slider", { name: label, exact: true }).press("Home");
  const ungroomed = await exportAndProbe(
    page,
    info,
    "fur-none-original-animation",
  );
  expect(ungroomed.exported.fur).toEqual({});
  expect(ungroomed.exported.animationClips).toBe(0);
  expect(ungroomed.exported.animationTracks).toBe(0);
  expect(ungroomed.exported.animationTracksFinite).toBe(true);
  expect(ungroomed.exported.unboundTracks).toEqual([]);
  await writeFile(
    `${ARTIFACTS}/coat-validation.json`,
    JSON.stringify(
      {
        baseline: baseline.exported.fur,
        noHead: baldHead.exported.fur,
        edited: edited.exported.fur,
        withoutGroom: {
          animationClips: ungroomed.exported.animationClips,
          animationTracks: ungroomed.exported.animationTracks,
        },
        lengths: {
          headBefore: strandMeanLength(beforeHead),
          headAfter: strandMeanLength(afterHead),
          bodyBefore: strandMeanLength(baseline.exported.fur.Fur_Body),
          bodyAfter: strandMeanLength(edited.exported.fur.Fur_Body),
        },
        scope:
          "Actual exported geometric strands reloaded with Three.js. Density changes triangle count; length changes centreline arc length; sampled roots stay on skin. This does not certify C-reference realism.",
      },
      null,
      2,
    ),
  );
});

test("three coat foundations switch real geometry and groom profiles while preserving the face and saved choice", async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  await mkdir(ARTIFACTS, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/studio/base");
  await ready(page);
  await expect(
    page.getByRole("button", { name: "长毛猫", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await enableCompleteGroom(page);
  await expect(
    page.getByRole("button", { name: "短毛猫", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const width = page.getByRole("slider", { name: "头部宽度", exact: true });
  await width.press("End");
  await page.getByRole("button", { name: "全身", exact: true }).click();
  const shortImage = await frame(page, "short-standing");
  const short = await exportAndProbe(page, info, "short-template");
  expect(short.exported.coatType).toBe("short");
  expect(short.exported.targets.Shape_headWidth_high).toBe(1);
  expect(Object.keys(short.exported.fur)).toHaveLength(3);
  expect(short.exported.undercoat.meshes).toBe(0);

  await page.getByRole("button", { name: "无毛猫", exact: true }).click();
  await ready(page);
  await expect(width).toHaveValue("100");
  const hairlessImage = await frame(page, "hairless-standing");
  expect(await changedPixels(shortImage, hairlessImage)).toBeGreaterThan(1500);
  const hairless = await exportAndProbe(
    page,
    info,
    "hairless-template",
    "/models/creator/sphynx-cat.glb",
  );
  expect(hairless.exported.coatType).toBe("hairless");
  expect(hairless.exported.fur).toEqual({});
  expect(hairless.exported.undercoat.meshes).toBe(0);
  expect(hairless.exported.surfaceVertices).not.toBe(
    short.exported.surfaceVertices,
  );
  expect(hairless.exported.meshNames.join(" ")).not.toBe(
    short.exported.meshNames.join(" "),
  );
  expect(hairless.exported.surfaceUvVertices).toBeGreaterThan(1000);
  expect(hairless.exported.surfaceTexturedMeshes).toBeGreaterThan(0);
  expect(hairless.exported.targets.Shape_headWidth_high).toBe(1);
  expect(hairless.comparison.sameTopology).toBe(true);
  expect(hairless.comparison.changedVertices).toBeGreaterThan(100);
  expect(hairless.comparison.maxDisplacement).toBeGreaterThan(0.002);
  expect(hairless.exported.finite).toBe(true);
  expect(hairless.exported.bones).toBe(hairless.source.bones);
  await page.getByRole("button", { name: "保存外观", exact: true }).click();
  const saved = await page.evaluate(
    (key) => localStorage.getItem(key),
    STORAGE_KEY,
  );
  expect(JSON.parse(saved!)).toMatchObject({
    schemaVersion: 5,
    templateId: "cat-foundation-v1",
    coatType: "hairless",
    coatMode: "groom",
    shape: { headWidth: 100 },
  });
  await page.reload();
  await ready(page);
  await expect(
    page.getByRole("button", { name: "无毛猫", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(width).toHaveValue("100");
  await openBackups(page);
  await page.getByLabel("导入外观 JSON", { exact: true }).setInputFiles({
    name: "unknown-coat.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ ...JSON.parse(saved!), coatType: "unknown" }),
    ),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: /导入失败/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "无毛猫", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(width).toHaveValue("100");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
  ).toBe(saved);
  await page.getByRole("button", { name: "短毛猫", exact: true }).click();
  await ready(page);
  await expect(width).toHaveValue("100");
  await page.getByRole("button", { name: "长毛猫", exact: true }).click();
  await ready(page);
  await expect(width).toHaveValue("100");
  const longImage = await frame(page, "long-standing");
  expect(await changedPixels(shortImage, longImage)).toBeGreaterThan(500);
  const long = await exportAndProbe(page, info, "long-template");
  expect(long.exported.coatType).toBe("long");
  expect(long.exported.undercoat.meshes).toBeGreaterThan(0);
  expect(long.exported.undercoat.vertices).toBeGreaterThan(1000);
  expect(long.exported.undercoat.uvVertices).toBe(
    long.exported.undercoat.vertices,
  );
  expect(long.exported.undercoat.texturedMeshes).toBeGreaterThan(0);
  expect(long.exported.undercoat.finite).toBe(true);
  expect(strandMeanLength(long.exported.fur.Fur_Body)).toBeGreaterThan(
    strandMeanLength(short.exported.fur.Fur_Body) * 2,
  );

  // Equal slider numbers still select different groom families. This catches
  // replacing three templates with three labels for the same parameter preset.
  const equalSliders = {
    ...defaultCreatorDesign,
    coatType: "long",
    coatMode: "groom",
    shape: {
      ...defaultCreatorDesign.shape,
      ...getCatCoatProfile("short").defaults,
      headWidth: 100,
    },
  };
  await openBackups(page);
  await page.getByLabel("导入外观 JSON", { exact: true }).setInputFiles({
    name: "same-sliders-long.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(equalSliders)),
  });
  // Both sides are already long/groom, so ready alone cannot prove File.text()
  // and the reducer replacement finished. Verify every imported value first.
  await expect(
    page.getByRole("status").filter({ hasText: "猫咪外观已导入" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "毛发", exact: true }).click();
  for (const [key, value] of Object.entries(
    getCatCoatProfile("short").defaults,
  ))
    await expect(page.locator(`#creator-${key}`)).toHaveValue(String(value));
  await page.getByRole("button", { name: "头型", exact: true }).click();
  await ready(page);
  const sameValuesLong = await exportAndProbe(page, info, "long-equal-sliders");
  expect(
    strandMeanLength(sameValuesLong.exported.fur.Fur_Body),
  ).toBeGreaterThan(strandMeanLength(short.exported.fur.Fur_Body) * 1.7);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "长毛猫", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(width).toHaveValue("100");
  await page.getByRole("button", { name: "毛发", exact: true }).click();
  for (const label of ["头部毛量", "胸颈毛量", "身体毛量"])
    await page.getByRole("slider", { name: label, exact: true }).press("Home");
  const longWithoutCoat = await exportAndProbe(page, info, "long-no-density");
  expect(longWithoutCoat.exported.undercoat.meshes).toBe(0);
  expect(longWithoutCoat.exported.fur).toEqual({});
  expect(longWithoutCoat.exported.animationClips).toBe(0);
  expect(errors).toEqual([]);
  await writeFile(
    `${ARTIFACTS}/template-validation.json`,
    JSON.stringify(
      {
        hairless: {
          surfaceVertices: hairless.exported.surfaceVertices,
          bones: hairless.exported.bones,
          furMeshes: Object.keys(hairless.exported.fur),
          texturedMeshes: hairless.exported.surfaceTexturedMeshes,
          faceGeometryChange: hairless.comparison,
        },
        short: {
          surfaceVertices: short.exported.surfaceVertices,
          bodyArcLength: strandMeanLength(short.exported.fur.Fur_Body),
        },
        long: {
          bodyArcLength: strandMeanLength(long.exported.fur.Fur_Body),
          equalSliderBodyArcLength: strandMeanLength(
            sameValuesLong.exported.fur.Fur_Body,
          ),
          undercoat: long.exported.undercoat,
          zeroDensityUndercoat: longWithoutCoat.exported.undercoat,
        },
        faceParametersPreserved: true,
        scope:
          "Actual exported GLB geometry and distinct groom profiles; browser screenshots and saved template restoration. No C-reference art-quality certification.",
      },
      null,
      2,
    ),
  );
});

test("phone touch changes the cat silhouette and keeps editing controls reachable in both orientations", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await mkdir(ARTIFACTS, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto("http://localhost:3000/studio/base");
    await ready(page);
    await page.getByRole("button", { name: "灰模", exact: true }).tap();
    await page.getByRole("button", { name: "正面", exact: true }).tap();
    const neutral = await frame(page, "phone-neutral-grey");
    const canvasBounds = await page.locator("canvas").boundingBox();
    // Tap the visible left eye in the fitted front view, exercising the real
    // raycast/landmark selection rather than selecting a sidebar category.
    await page.touchscreen.tap(
      canvasBounds!.x + canvasBounds!.width * 0.4,
      canvasBounds!.y + canvasBounds!.height * 0.54,
    );
    await expect(
      page.getByRole("button", { name: "眼睛", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "头型", exact: true }).tap();
    const width = page.getByRole("slider", { name: "头部宽度", exact: true });
    await width.scrollIntoViewIfNeeded();
    const bounds = await width.boundingBox();
    await page.touchscreen.tap(
      bounds!.x + bounds!.width * 0.94,
      bounds!.y + bounds!.height / 2,
    );
    expect(Number(await width.inputValue())).toBeGreaterThan(75);
    const wide = await frame(page, "phone-wide-grey");
    expect(await changedPixels(neutral, wide)).toBeGreaterThan(400);
    await page.getByRole("button", { name: "撤销", exact: true }).tap();
    await expect(width).toHaveValue("50");
    await page.getByRole("button", { name: "眼睛", exact: true }).tap();
    const spacing = page.getByRole("slider", { name: "眼睛间距", exact: true });
    await spacing.press("End");
    await expect(spacing).toHaveValue("100");
    await page.getByRole("button", { name: "重置部位", exact: true }).tap();
    await expect(spacing).toHaveValue("50");
    await page.getByRole("button", { name: "材质预览", exact: true }).tap();
    await page.getByRole("button", { name: "短毛猫", exact: true }).tap();
    await page.getByRole("button", { name: "全身", exact: true }).tap();
    await page.getByRole("button", { name: "毛发", exact: true }).tap();
    await page
      .getByRole("button", { name: "完整被毛", exact: true })
      .tap();
    await ready(page);
    const coatBefore = await frame(page, "phone-coat-default");
    const bodyFurLength = page.getByRole("slider", {
      name: "身体毛长",
      exact: true,
    });
    await bodyFurLength.scrollIntoViewIfNeeded();
    const furSlider = await bodyFurLength.boundingBox();
    await page.touchscreen.tap(
      furSlider!.x + furSlider!.width * 0.96,
      furSlider!.y + furSlider!.height / 2,
    );
    expect(Number(await bodyFurLength.inputValue())).toBeGreaterThan(80);
    const coatAfter = await frame(page, "phone-coat-long");
    expect(await changedPixels(coatBefore, coatAfter)).toBeGreaterThan(60);
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
      for (const label of [
        "保存外观",
        "重置部位",
        "全身",
        "无毛猫",
        "短毛猫",
        "长毛猫",
      ]) {
        const button = page.getByRole("button", { name: label, exact: true });
        await button.scrollIntoViewIfNeeded();
        await rendered(page);
        expect(
          await button.evaluate((node) => {
            const b = node.getBoundingClientRect(),
              top = document.elementFromPoint(
                b.x + b.width / 2,
                b.y + b.height / 2,
              );
            return top === node || node.contains(top);
          }),
          `${label} should be reachable at ${viewport.width}×${viewport.height}`,
        ).toBe(true);
      }
      await page.screenshot({
        path: `${ARTIFACTS}/phone-${viewport.width}x${viewport.height}.png`,
      });
    }
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("previous Norwegian v3 storage migrates the saved face and coat without overwriting its record", async ({
  page,
}) => {
  const previous = JSON.stringify({
    schemaVersion: 3,
    templateId: "norwegian-cat-v1",
    shape: {
      ...defaultCreatorDesign.shape,
      headWidth: 67,
      headFurDensity: 47,
      headFurLength: 19,
      bodyFurLength: 36,
    },
  });
  await page.addInitScript(
    ({ key, value }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, value);
    },
    { key: PREVIOUS_STORAGE_KEY, value: previous },
  );
  await page.goto("/studio/base");
  await ready(page);
  await expect(
    page.getByRole("button", { name: "长毛猫", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("slider", { name: "头部宽度", exact: true }),
  ).toHaveValue("67");
  await page.getByRole("button", { name: "毛发", exact: true }).click();
  await expectCompleteCoatControls(page, JSON.parse(previous).shape);
  await ready(page);
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      PREVIOUS_STORAGE_KEY,
    ),
  ).toBe(previous);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
  ).toBeNull();
  await page.getByRole("button", { name: "保存外观", exact: true }).click();
  const stored = await page.evaluate(
    (key) => localStorage.getItem(key),
    STORAGE_KEY,
  );
  expect(JSON.parse(stored!)).toMatchObject({
    schemaVersion: 5,
    templateId: "cat-foundation-v1",
    coatType: "long",
    coatMode: "groom",
    shape: { headWidth: 67, headFurDensity: 47, bodyFurLength: 36 },
  });
  expect(JSON.parse(stored!).shape).toEqual(JSON.parse(previous).shape);
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      PREVIOUS_STORAGE_KEY,
    ),
  ).toBe(previous);
  await page.reload();
  await ready(page);
  await expect(
    page.getByRole("button", { name: "长毛猫", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "毛发", exact: true }).click();
  await expectCompleteCoatControls(page, JSON.parse(previous).shape);
});

test("previous v4 source storage and import restore the complete coat while v5 keeps an explicit source choice", async ({
  page,
}) => {
  const previous = {
    schemaVersion: 4,
    templateId: "cat-foundation-v1",
    coatType: "long",
    coatMode: "source",
    shape: {
      ...defaultCreatorDesign.shape,
      headWidth: 67,
      headFurDensity: 47,
      headFurLength: 19,
      ruffFurDensity: 53,
      ruffFurLength: 29,
      bodyFurDensity: 61,
      bodyFurLength: 36,
    },
  };
  const rawPrevious = JSON.stringify(previous);
  await page.addInitScript(
    ({ key, value }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, value);
    },
    { key: STORAGE_KEY, value: rawPrevious },
  );
  await page.goto("/studio/base");
  await ready(page);
  await expect(
    page.getByRole("slider", { name: "头部宽度", exact: true }),
  ).toHaveValue("67");
  await page.getByRole("button", { name: "毛发", exact: true }).click();
  await expectCompleteCoatControls(page, previous.shape);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
  ).toBe(rawPrevious);

  await openBackups(page);
  await page.getByLabel("导入外观 JSON", { exact: true }).setInputFiles({
    name: "previous-v4-source.json",
    mimeType: "application/json",
    buffer: Buffer.from(rawPrevious),
  });
  await expect(
    page.getByRole("status").filter({ hasText: "猫咪外观已导入" }),
  ).toBeVisible();
  await expectCompleteCoatControls(page, previous.shape);
  await page.getByRole("button", { name: "保存外观", exact: true }).click();
  const saved = JSON.parse(
    (await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))!,
  );
  expect(saved).toEqual({ ...previous, schemaVersion: 5, coatMode: "groom" });
  await page.reload();
  await ready(page);
  await page.getByRole("button", { name: "毛发", exact: true }).click();
  await expectCompleteCoatControls(page, previous.shape);

  const explicitSource = { ...saved, coatMode: "source" };
  await openBackups(page);
  await page.getByLabel("导入外观 JSON", { exact: true }).setInputFiles({
    name: "current-v5-explicit-source.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(explicitSource)),
  });
  await expect(
    page.getByRole("button", { name: "仅看原模型", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("slider")).toHaveCount(0);
  await page.getByRole("button", { name: "保存外观", exact: true }).click();
  expect(
    JSON.parse(
      (await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY))!,
    ),
  ).toEqual(explicitSource);
  await page.reload();
  await ready(page);
  await page.getByRole("button", { name: "毛发", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "仅看原模型", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("slider")).toHaveCount(0);
  await page.getByRole("button", { name: "完整被毛", exact: true }).click();
  await expectCompleteCoatControls(page, previous.shape);
});

test("model download failure can be retried without losing the current face adjustments", async ({
  page,
}) => {
  let retryAllowed = false;
  let failedRequests = 0;
  await page.route("**/models/creator/norwegian-cat.glb", async (route) => {
    // React development mode can mount the loader effect twice. Keep the first
    // load cycle unavailable until the user explicitly presses retry.
    if (!retryAllowed) {
      failedRequests++;
      await route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "Temporary model load failure",
      });
    } else await route.continue();
  });
  await page.goto("/studio/base");
  await expect(
    page.getByRole("alert").filter({ hasText: "猫头暂未加载成功" }),
  ).toBeVisible();
  const width = page.getByRole("slider", { name: "头部宽度", exact: true });
  await expect(width).toBeEnabled();
  await width.press("End");
  await expect(width).toHaveValue("100");
  expect(failedRequests).toBeGreaterThan(0);
  retryAllowed = true;
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await ready(page);
  await expect(width).toHaveValue("100");
  await expect(
    page.getByRole("alert").filter({ hasText: "猫头暂未加载成功" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "灰模", exact: true }).click();
  await page.getByRole("button", { name: "正面", exact: true }).click();
  const recovered = await frame(page, "retry-keeps-wide-face");
  await page.getByRole("button", { name: "自然脸", exact: true }).click();
  const neutral = await frame(page, "retry-neutral-comparison");
  expect(await changedPixels(recovered, neutral)).toBeGreaterThan(500);
  let hairlessRetryAllowed = false;
  await page.route("**/models/creator/sphynx-cat.glb", async (route) => {
    if (!hairlessRetryAllowed)
      await route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "Temporary hairless foundation load failure",
      });
    else await route.continue();
  });
  await width.press("End");
  await page.getByRole("button", { name: "无毛猫", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /暂未加载成功/ }),
  ).toBeVisible();
  await expect(width).toHaveValue("100");
  await expect(
    page.getByRole("button", { name: "无毛猫", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  hairlessRetryAllowed = true;
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await ready(page);
  await expect(width).toHaveValue("100");
  await expect(
    page.getByRole("button", { name: "无毛猫", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
