/**
 * Read-only CPU audit of an archived production groom bundle. No browser or GPU.
 * Usage: node scripts/audit-cat-groom-scale.mjs [bundle.js] [report.json]
 * The capture bundle retains the exact implementation used by that visual round.
 * Closure instrumentation exists only in memory; it never edits runtime/assets.
 */
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import sharp from "sharp";

const bundlePath =
  process.argv[2] ?? "artifacts/fur-realism/round-03/performance-probe.js";
const outputPath =
  process.argv[3] ??
  "artifacts/fur-realism/verification/guide-scale-round03.json";
const source = await fs.readFile("public/models/creator/norwegian-cat.glb");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonLength = source.readUInt32LE(12);
const original = JSON.parse(source.subarray(20, 20 + jsonLength).toString());
const json = structuredClone(original);
const binChunk = source.subarray(20 + jsonLength);
const bin = binChunk.subarray(8);
const images = [];
for (const image of original.images ?? []) {
  const view = original.bufferViews[image.bufferView];
  const raw = await sharp(
    bin.subarray(
      view.byteOffset ?? 0,
      (view.byteOffset ?? 0) + view.byteLength,
    ),
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  images.push({
    pixels: raw.data,
    width: raw.info.width,
    height: raw.info.height,
  });
}
// Remove DOM image loading from a transient GLB copy. Restore original diffuse
// pixels below, so the same production UV sampler/nose exclusions still run.
for (const material of json.materials ?? []) {
  for (const key of Object.keys(material))
    if (key.endsWith("Texture")) delete material[key];
  for (const key of Object.keys(material.pbrMetallicRoughness ?? {}))
    if (key.endsWith("Texture")) delete material.pbrMetallicRoughness[key];
  for (const extension of Object.values(material.extensions ?? {}))
    for (const key of Object.keys(extension))
      if (key.endsWith("Texture")) delete extension[key];
}
delete json.images;
delete json.textures;
delete json.samplers;
const encoded = Buffer.from(JSON.stringify(json));
const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20);
encoded.copy(padded);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(20 + padded.length + binChunk.length, 8);
header.writeUInt32LE(padded.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);
const geometryOnly = Buffer.concat([header, padded, binChunk]);

globalThis.window = globalThis;
globalThis.document = {
  createElement(name) {
    if (name !== "canvas")
      throw new Error(`Unexpected DOM dependency: ${name}`);
    let image;
    return {
      width: 0,
      height: 0,
      getContext() {
        return {
          drawImage(value) {
            image = value;
          },
          getImageData() {
            return { data: image.pixels };
          },
        };
      },
    };
  },
};
const archivedBundle = await fs.readFile(bundlePath, "utf8");
const closureReturn = archivedBundle.lastIndexOf("    return resource;");
if (
  closureReturn < 0 ||
  !archivedBundle.includes("window.__furFlowPerformance =")
)
  throw new Error("Expected an unminified archived capture bundle.");
let instrumented =
  archivedBundle.slice(0, closureReturn) +
  "    globalThis.__groomAuditState = {regions,evaluated,normals};\n" +
  archivedBundle.slice(closureReturn);
instrumented = instrumented.replace(
  /const gravity = length \* groom\.gravity \* \(region\.name === "head" \? 0\.28 : 1\);/,
  "$&\n      root.__auditGravity = gravity;",
);
instrumented = instrumented.replace(
  "window.__furFlowPerformance =",
  `
globalThis.__groomAuditModules = {GLTFLoader,Texture,SRGBColorSpace,Box3,Vector3,
ownCreatorModel,applyCreatorDesign,defaultCreatorDesign,getCatCoatProfile,createNorwegianFur};
window.__furFlowPerformance =`,
);
vm.runInThisContext(instrumented, { filename: bundlePath });
const api = globalThis.__groomAuditModules;
const gltf = await new api.GLTFLoader().parseAsync(
  geometryOnly.buffer.slice(
    geometryOnly.byteOffset,
    geometryOnly.byteOffset + geometryOnly.length,
  ),
  "",
);
gltf.scene.traverse((node) => {
  if (!node.isMesh) return;
  for (const material of Array.isArray(node.material)
    ? node.material
    : [node.material]) {
    const association = gltf.parser.associations.get(material);
    const baseColor =
      original.materials[association?.materials]?.pbrMetallicRoughness
        ?.baseColorTexture;
    if (!baseColor) continue;
    const texture = new api.Texture(
      images[original.textures[baseColor.index].source],
    );
    texture.flipY = false;
    texture.colorSpace = api.SRGBColorSpace;
    const transform = baseColor.extensions?.KHR_texture_transform;
    if (transform?.offset) texture.offset.fromArray(transform.offset);
    if (transform?.scale) texture.repeat.fromArray(transform.scale);
    if (transform?.rotation) texture.rotation = transform.rotation;
    material.map = texture;
  }
});
const model = api.ownCreatorModel(gltf.scene, gltf.animations, "norwegian");
const surface = model.meshes
  .filter((mesh) => mesh.isSkinnedMesh)
  .sort(
    (a, b) =>
      b.geometry.attributes.position.count -
      a.geometry.attributes.position.count,
  )[0];
const fur = await api.createNorwegianFur(model.scene, surface);
model.fur = fur;
model.scene.add(...fur.meshes);
fur.setDetail(1);
const state = globalThis.__groomAuditState;
const bounds = new api.Box3();
for (let i = 0; i < state.evaluated.length; i += 3)
  bounds.expandByPoint(new api.Vector3().fromArray(state.evaluated, i));
const height = bounds.max.y - bounds.min.y;
const mmPerUnit = 300 / height;
function distribution(values) {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const at = (t) => values[Math.floor((values.length - 1) * t)];
  return {
    min: at(0),
    p05: at(0.05),
    median: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: at(1),
  };
}
const report = {
  capturedAt: new Date().toISOString(),
  method:
    "Actual archived production GLB/runtime; in-memory closure instrumentation, original decoded diffuse pixels, no browser/GPU",
  bundle: bundlePath,
  bundleSha256: hash(archivedBundle),
  glbSha256: hash(source),
  surfaceVertices: surface.geometry.attributes.position.count,
  canonicalHeight: height,
  mmPerUnit,
  scaleNote:
    "300 mm illustrative cat height, not a physical calibration supplied by the model author",
  clearanceNote:
    "Projection to each barycentric root's interpolated skin normal at sampled curve points; this is NOT a whole-body SDF/intersection/collision test",
  angleNote:
    "Degrees between adjacent ACTUAL ribbon-centre segments, not analytic spline derivatives. Non-root vertices touching the floor clamp are separated/excluded. Segment lengths below 1e-7 scene units are excluded as degenerate.",
  profiles: [],
};
try {
  for (const variant of [
    { name: "short-default", coatType: "short", maximum: false },
    { name: "long-default", coatType: "long", maximum: false },
    { name: "long-maximum", coatType: "long", maximum: true },
  ]) {
    const { coatType } = variant;
    const design = {
      ...api.defaultCreatorDesign,
      coatType,
      shape: {
        ...api.defaultCreatorDesign.shape,
        ...api.getCatCoatProfile(coatType).defaults,
      },
    };
    if (variant.maximum)
      for (const region of ["head", "ruff", "body"])
        for (const control of ["FurDensity", "FurLength"])
          design.shape[`${region}${control}`] = 100;
    api.applyCreatorDesign(model, design);
    fur.refresh({ full: true });
    const rows = [];
    for (const region of state.regions) {
      const count = Number(region.mesh.userData.strandCount);
      const segments = Number(region.mesh.userData.strandSegments);
      const stride = Number(region.mesh.userData.strandVertices);
      const position = region.mesh.geometry.attributes.position;
      const corners = () => ({
        strands: 0,
        degenerateJoints: 0,
        joint: [],
        strandMaximum: [],
        above30: 0,
        above45: 0,
        above60: 0,
        minimumAdjacentSegmentMm: Infinity,
      });
      const group = () => ({
        arc: [],
        tip: [],
        min: [],
        max: [],
        inward: 0,
        withoutGround: corners(),
        groundClipped: corners(),
      });
      const all = group(),
        kinds = { down: group(), awn: group(), guard: group() },
        back = group();
      let backWithOldInwardGravity = 0;
      const n = new api.Vector3(),
        rootPoint = new api.Vector3(),
        p = new api.Vector3(),
        previous = new api.Vector3(),
        delta = new api.Vector3();
      const centers = new Float64Array((segments + 1) * 3);
      const jointAngles = new Float64Array(Math.max(0, segments - 1));
      for (let strand = 0; strand < count; strand++) {
        const root = region.roots[strand];
        const a = root.a * 3,
          b = root.b * 3,
          c = root.c * 3;
        for (let axis = 0; axis < 3; axis++) {
          n.setComponent(
            axis,
            state.normals[a + axis] * root.u +
              state.normals[b + axis] * root.v +
              state.normals[c + axis] * root.w,
          );
          rootPoint.setComponent(
            axis,
            state.evaluated[a + axis] * root.u +
              state.evaluated[b + axis] * root.v +
              state.evaluated[c + axis] * root.w,
          );
        }
        n.normalize();
        let arc = 0,
          minimum = Infinity,
          maximum = -Infinity,
          tip = 0,
          oldMinimum = Infinity,
          groundClipped = false;
        for (let sample = 0; sample <= segments; sample++) {
          const vertex = strand * stride + sample * 2;
          p.set(
            (position.getX(vertex) + position.getX(vertex + 1)) * 0.5,
            (position.getY(vertex) + position.getY(vertex + 1)) * 0.5,
            (position.getZ(vertex) + position.getZ(vertex + 1)) * 0.5,
          );
          p.toArray(centers, sample * 3);
          if (
            sample > 0 &&
            Math.min(position.getY(vertex), position.getY(vertex + 1)) <=
              bounds.min.y + 0.002 + 1e-6
          )
            groundClipped = true;
          if (sample > 0) arc += p.distanceTo(previous);
          previous.copy(p);
          tip = delta.subVectors(p, rootPoint).dot(n);
          minimum = Math.min(minimum, tip);
          maximum = Math.max(maximum, tip);
          oldMinimum = Math.min(
            oldMinimum,
            tip -
              Number(root.__auditGravity ?? 0) *
                Math.max(n.y, 0) *
                (sample / segments) ** 2,
          );
        }
        let validJoints = 0,
          degenerateJoints = 0,
          maximumAngle = -Infinity,
          minimumAdjacentSegment = Infinity;
        for (let joint = 1; joint < segments; joint++) {
          const a = (joint - 1) * 3,
            b = joint * 3,
            c = (joint + 1) * 3;
          const ax = centers[b] - centers[a],
            ay = centers[b + 1] - centers[a + 1],
            az = centers[b + 2] - centers[a + 2];
          const bx = centers[c] - centers[b],
            by = centers[c + 1] - centers[b + 1],
            bz = centers[c + 2] - centers[b + 2];
          const al = Math.hypot(ax, ay, az),
            bl = Math.hypot(bx, by, bz);
          if (Math.min(al, bl) < 1e-7) {
            degenerateJoints++;
            continue;
          }
          minimumAdjacentSegment = Math.min(minimumAdjacentSegment, al, bl);
          const angle =
            (Math.acos(
              Math.max(
                -1,
                Math.min(1, (ax * bx + ay * by + az * bz) / (al * bl)),
              ),
            ) *
              180) /
            Math.PI;
          jointAngles[validJoints++] = angle;
          maximumAngle = Math.max(maximumAngle, angle);
        }
        const targets = [all, kinds[root.hairKind]];
        if (n.y > 0.85 && root.kind === 0 && region.name === "body") {
          targets.push(back);
          if (oldMinimum * mmPerUnit < -0.02) backWithOldInwardGravity++;
        }
        for (const target of targets) {
          target.arc.push(arc * mmPerUnit);
          target.tip.push(tip * mmPerUnit);
          target.min.push(minimum * mmPerUnit);
          target.max.push(maximum * mmPerUnit);
          if (minimum * mmPerUnit < -0.02) target.inward++;
          const curve = groundClipped
            ? target.groundClipped
            : target.withoutGround;
          curve.strands++;
          curve.degenerateJoints += degenerateJoints;
          curve.minimumAdjacentSegmentMm = Math.min(
            curve.minimumAdjacentSegmentMm,
            minimumAdjacentSegment * mmPerUnit,
          );
          if (validJoints > 0) curve.strandMaximum.push(maximumAngle);
          for (let joint = 0; joint < validJoints; joint++) {
            const angle = jointAngles[joint];
            curve.joint.push(angle);
            if (angle > 30) curve.above30++;
            if (angle > 45) curve.above45++;
            if (angle > 60) curve.above60++;
          }
        }
      }
      const summarizeCorners = (items) => ({
        strands: items.strands,
        validJoints: items.joint.length,
        degenerateJoints: items.degenerateJoints,
        minimumAdjacentSegmentMm: Number.isFinite(
          items.minimumAdjacentSegmentMm,
        )
          ? items.minimumAdjacentSegmentMm
          : null,
        jointDegrees: distribution(items.joint),
        strandMaximumDegrees: distribution(items.strandMaximum),
        jointFractionAbove30: items.joint.length
          ? items.above30 / items.joint.length
          : null,
        jointFractionAbove45: items.joint.length
          ? items.above45 / items.joint.length
          : null,
        jointFractionAbove60: items.joint.length
          ? items.above60 / items.joint.length
          : null,
      });
      const summarize = (items) => ({
        count: items.arc.length,
        inwardBelowMinus002Mm: items.inward,
        arcLengthMm: distribution(items.arc),
        tipNormalMm: distribution(items.tip),
        minNormalMm: distribution(items.min),
        maxNormalMm: distribution(items.max),
        cornerAngles: {
          withoutGround: summarizeCorners(items.withoutGround),
          groundClipped: summarizeCorners(items.groundClipped),
        },
      });
      rows.push({
        region: region.name,
        strandSegments: segments,
        strandVertices: stride,
        all: summarize(all),
        byKind: Object.fromEntries(
          Object.entries(kinds).map(([kind, items]) => [
            kind,
            summarize(items),
          ]),
        ),
        back: back.arc.length
          ? {
              ...summarize(back),
              counterfactualOldWorldDownInward: backWithOldInwardGravity,
            }
          : null,
      });
    }
    report.profiles.push({
      profile: variant.name,
      coatType,
      shape: design.shape,
      defaults: api.getCatCoatProfile(coatType).defaults,
      guideCount: state.regions[0].mesh.userData.canonicalGroom.guides.length,
      regions: rows,
    });
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        output: outputPath,
        height,
        mmPerUnit,
        profiles: report.profiles.map((p) => ({
          profile: p.profile,
          regions: p.regions.map((r) => ({
            region: r.region,
            kinds: Object.fromEntries(
              Object.entries(r.byKind).map(([kind, values]) => [
                kind,
                {
                  count: values.count,
                  groundClipped: values.cornerAngles.groundClipped.strands,
                  joints: values.cornerAngles.withoutGround.jointDegrees,
                  perStrandMax:
                    values.cornerAngles.withoutGround.strandMaximumDegrees,
                  above30:
                    values.cornerAngles.withoutGround.jointFractionAbove30,
                },
              ]),
            ),
          })),
        })),
      },
      null,
      2,
    ),
  );
} finally {
  model.dispose();
}
