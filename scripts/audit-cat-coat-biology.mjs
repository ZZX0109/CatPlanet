/** Round09 regional mix and unchanged surface bindings; Node only, no GPU. */
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadArchivedGroom } from "./cat-groom-audit-runtime.mjs";

const output = "artifacts/fur-realism/round-09/biology-check.json";
const bundles = {
  before: "artifacts/fur-realism/round-08/performance-probe.js",
  after: "artifacts/fur-realism/round-09/performance-probe.js",
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const arrayDigest = (array) =>
  digest(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
const reference = JSON.parse(
  await fs.readFile(
    "artifacts/fur-realism/verification/guide-angles-round08.json",
    "utf8",
  ),
);
const sourcePaths = [
  "lib/norwegian-fur.ts",
  "lib/cat-coat-anatomy.ts",
  "lib/cat-groom-guides.ts",
  "lib/cat-fur-flow.ts",
  "public/models/creator/norwegian-cat.glb",
];
const sourceHashes = async () =>
  Object.fromEntries(
    await Promise.all(
      sourcePaths.map(async (p) => [p, digest(await fs.readFile(p))]),
    ),
  );
const initialHashes = await sourceHashes();
const archives = {};
for (const [label, bundle] of Object.entries(bundles)) {
  const runtime = await loadArchivedGroom(bundle, {
    transformBundle(source) {
      return source
        .replace(
          "globalThis.__groomAuditState = {regions,evaluated,normals};",
          "globalThis.__groomAuditState = {regions,evaluated,normals,membership,coatAnatomy};",
        )
        .replace(
          "window.__furFlowPerformance =",
          "globalThis.__biologyTransport=transportSurfaceVector;\nwindow.__furFlowPerformance =",
        );
    },
  });
  const transport = globalThis.__biologyTransport;
  const { api, model, fur, state } = runtime;
  model.motion.setBreathing(false);
  model.motion.setIdleBlink(false);
  const boundSkin = (root) => {
    const p = [0, 0, 0],
      n = [0, 0, 0],
      ab = [0, 0, 0],
      ac = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      p[a] =
        state.evaluated[root.a * 3 + a] * root.u +
        state.evaluated[root.b * 3 + a] * root.v +
        state.evaluated[root.c * 3 + a] * root.w;
      n[a] =
        state.normals[root.a * 3 + a] * root.u +
        state.normals[root.b * 3 + a] * root.v +
        state.normals[root.c * 3 + a] * root.w;
      ab[a] = state.evaluated[root.b * 3 + a] - state.evaluated[root.a * 3 + a];
      ac[a] = state.evaluated[root.c * 3 + a] - state.evaluated[root.a * 3 + a];
    }
    const len = Math.hypot(...n);
    for (let a = 0; a < 3; a++) n[a] /= len;
    return { p, n, ab, ac };
  };
  const frozen = state.regions.map((region) => {
    const anchors = new Float64Array(region.roots.length * 6),
      frames = new Float64Array(region.roots.length * 6),
      kinds = [];
    const regions = [];
    for (let i = 0; i < region.roots.length; i++) {
      const root = region.roots[i];
      anchors.set([root.a, root.b, root.c, root.u, root.v, root.w], i * 6);
      frames.set(
        [
          root.flow.u,
          root.flow.v,
          root.flow.length,
          root.gather.u,
          root.gather.v,
          root.gather.length,
        ],
        i * 6,
      );
      const { p, n } = boundSkin(root);
      const weights = {};
      for (const key of ["head", "limb", "hind", "tail"])
        weights[key] =
          state.membership[key][root.a] * root.u +
          state.membership[key][root.b] * root.v +
          state.membership[key][root.c] * root.w;
      const sampled = state.coatAnatomy.sample(p, n, weights);
      const names = [region.name];
      if (region.name === "body" && root.kind === 0) {
        if (n[1] > 0.7) names.push("back");
        if (sampled.zones.belly > 0.5) names.push("belly");
      }
      regions.push(names);
      kinds.push(root.hairKind);
    }
    return {
      region: region.name,
      capacity: region.capacity,
      roots: region.roots.length,
      anchorsSha256: arrayDigest(anchors),
      surfaceFramesSha256: arrayDigest(frames),
      cohorts: regions,
      kinds,
    };
  });
  const cases = [];
  let tick = 0;
  try {
    for (const coat of ["short", "long"])
      for (const pose of ["stand", "rest"]) {
        model.motion.setPose(pose, true);
        model.motion.update(++tick, { reducedMotion: true });
        const design = {
          ...api.defaultCreatorDesign,
          coatType: coat,
          shape: {
            ...api.defaultCreatorDesign.shape,
            ...api.getCatCoatProfile(coat).defaults,
          },
        };
        api.applyCreatorDesign(model, design);
        fur.setDetail(1);
        fur.refresh({ full: true });
        const groups = new Map(),
          checks = [];
        for (let ri = 0; ri < state.regions.length; ri++) {
          const region = state.regions[ri],
            attributes = region.mesh.geometry.attributes;
          const count = region.mesh.userData.strandCount;
          let invalidNodes = 0,
            invalidFrames = 0,
            maxNormalTangentDot = 0,
            maxTangentLengthError = 0,
            maxRootOffsetError = 0;
          const frameSamples = new Float64Array(count * 6);
          for (let i = 0; i < count; i++) {
            const root = region.roots[i],
              { p, n, ab, ac } = boundSkin(root),
              t = transport(root.flow, ab, ac, n, [0, 0, 0]);
            const len = Math.hypot(...t),
              dot = n.reduce((sum, value, axis) => sum + value * t[axis], 0);
            if (![...n, ...t].every(Number.isFinite) || len < 1e-8)
              invalidFrames++;
            maxNormalTangentDot = Math.max(maxNormalTangentDot, Math.abs(dot));
            maxTangentLengthError = Math.max(
              maxTangentLengthError,
              Math.abs(len - root.flow.length),
            );
            frameSamples.set([...n, ...t], i * 6);
            for (const name of frozen[ri].cohorts[i]) {
              if (!groups.has(name))
                groups.set(name, {
                  cohort: name,
                  total: 0,
                  down: 0,
                  awn: 0,
                  guard: 0,
                });
              const g = groups.get(name);
              g.total++;
              g[root.hairKind]++;
            }
            const start = i * region.strandVertices;
            for (let axis = 0; axis < 3; axis++) {
              const actual =
                (attributes.position.getComponent(start, axis) +
                  attributes.position.getComponent(start + 1, axis)) *
                0.5;
              maxRootOffsetError = Math.max(
                maxRootOffsetError,
                Math.abs(actual - p[axis] - n[axis] * 0.00045),
              );
            }
          }
          for (const key of ["position", "normal", "furWidth", "uv", "color"]) {
            const attribute = attributes[key];
            for (
              let i = 0;
              i < count * region.strandVertices * attribute.itemSize;
              i++
            )
              if (!Number.isFinite(attribute.array[i])) invalidNodes++;
          }
          checks.push({
            region: region.name,
            activeStrands: count,
            strandSegments: region.strandSegments,
            invalidAttributeValues: invalidNodes,
            invalidSurfaceFrames: invalidFrames,
            maxAbsSkinNormalDotFlow: maxNormalTangentDot,
            maxTangentLengthError,
            maxRootOffsetComponentError: maxRootOffsetError,
            transportedFramesSha256: arrayDigest(frameSamples),
          });
        }
        cases.push({
          coat,
          pose,
          groups: [...groups.values()].map((g) => ({
            ...g,
            share: {
              down: g.down / g.total,
              awn: g.awn / g.total,
              guard: g.guard / g.total,
            },
          })),
          checks,
        });
      }
    archives[label] = {
      bundle,
      bundleSha256: runtime.bundleSha256,
      currentAssetSha256: runtime.glbSha256,
      roots: frozen.map(({ cohorts, kinds, ...metadata }) => metadata),
      cases,
    };
  } finally {
    model.dispose();
  }
}
const rootComparisons = archives.after.roots.map((r, i) => ({
  ...r,
  before: archives.before.roots[i],
  anchorsIdentical: r.anchorsSha256 === archives.before.roots[i].anchorsSha256,
  framesIdentical:
    r.surfaceFramesSha256 === archives.before.roots[i].surfaceFramesSha256,
}));
const frameComparisons = archives.after.cases.flatMap((c, i) =>
  c.checks.map((r, j) => ({
    coat: c.coat,
    pose: c.pose,
    region: r.region,
    transportedFramesIdentical:
      r.transportedFramesSha256 ===
      archives.before.cases[i].checks[j].transportedFramesSha256,
  })),
);
const mixComparison = archives.after.cases
  .filter((c) => c.pose === "stand")
  .flatMap((c) =>
    c.groups.map((g) => ({
      coat: c.coat,
      cohort: g.cohort,
      before: archives.before.cases
        .find((b) => b.coat === c.coat && b.pose === c.pose)
        .groups.find((b) => b.cohort === g.cohort),
      after: g,
    })),
  );
const finalHashes = await sourceHashes();
const report = {
  capturedAt: new Date().toISOString(),
  method:
    "Read-only CPU, actual production GLB and archived source bundles; no GPU or browser. Root canonical frames and exact planting bindings compared byte-for-byte; default short/long standing/rest poses regenerated.",
  scope:
    "Representative rendering mix, not a follicle census or proof of visual realism. Body excludes limbs/tail for back and belly. Back means skinNormal.y>.7; belly means canonical anatomy belly weight>.5. Root frames are analytic surface-bound vectors, not optical shading normal/width recovery.",
  archivedRound08AssetSha256: reference.glbSha256,
  currentAssetMatchesArchived08:
    reference.glbSha256 ===
    initialHashes["public/models/creator/norwegian-cat.glb"],
  sourceHashes: initialHashes,
  sourceStableDuringAudit:
    JSON.stringify(initialHashes) === JSON.stringify(finalHashes),
  totalCapacity: archives.after.roots.reduce((sum, r) => sum + r.capacity, 0),
  rootComparisons,
  frameComparisons,
  mixComparison,
  archives,
  pass:
    rootComparisons.every(
      (r) =>
        r.anchorsIdentical && r.framesIdentical && r.roots === r.before.roots,
    ) &&
    frameComparisons.every((r) => r.transportedFramesIdentical) &&
    Object.values(archives).every((a) =>
      a.cases.every((c) =>
        c.checks.every(
          (r) =>
            r.invalidAttributeValues === 0 &&
            r.invalidSurfaceFrames === 0 &&
            r.maxAbsSkinNormalDotFlow < 1e-10 &&
            r.maxTangentLengthError < 1e-10 &&
            r.maxRootOffsetComponentError < 1e-6,
        ),
      ),
    ) &&
    reference.glbSha256 ===
      initialHashes["public/models/creator/norwegian-cat.glb"] &&
    JSON.stringify(initialHashes) === JSON.stringify(finalHashes),
};
await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      output,
      pass: report.pass,
      totalCapacity: report.totalCapacity,
      currentAssetMatchesArchived08: report.currentAssetMatchesArchived08,
      rootComparisons,
      frameComparisons,
      mixComparison,
    },
    null,
    2,
  ),
);
if (!report.pass) process.exitCode = 1;
