/** Read-only10/11 depth-layer geometry and protected-cohort comparison. */
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadArchivedGroom } from "./cat-groom-audit-runtime.mjs";

const output = "artifacts/fur-realism/round-11/depth-check.json";
const sources = [
  "lib/norwegian-fur.ts",
  "lib/cat-groom-guides.ts",
  "lib/cat-coat-anatomy.ts",
  "lib/cat-coat-profiles.ts",
  "public/models/creator/norwegian-cat.glb",
];
const sourceHashes = async () =>
  Object.fromEntries(
    await Promise.all(
      sources.map(async (p) => [
        p,
        createHash("sha256")
          .update(await fs.readFile(p))
          .digest("hex"),
      ]),
    ),
  );
const initialHashes = await sourceHashes();
const digest = (a) =>
  createHash("sha256")
    .update(Buffer.from(a.buffer, a.byteOffset, a.byteLength))
    .digest("hex");
const sourceBytes = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const bundles = {
  before: "artifacts/fur-realism/round-10/collar-probe.js",
  after: "artifacts/fur-realism/round-11/performance-probe.js",
};
const archives = {};
for (const [label, bundle] of Object.entries(bundles)) {
  const runtime = await loadArchivedGroom(bundle),
    { api, model, fur, state } = runtime;
  const staticData = state.regions.map((region) => {
    const bindings = new Float64Array(
      region.roots.flatMap((r) => [
        r.a,
        r.b,
        r.c,
        r.u,
        r.v,
        r.w,
        r.kind,
        r.shortLength,
        r.longLength,
        r.hairWidth,
        r.hairLift,
        r.hairCrimp,
        r.layer,
        r.variation,
        r.roll,
        r.phase,
        r.curl,
        r.flowLength,
        r.guardLength,
        r.bodyStyling,
        r.flow.u,
        r.flow.v,
        r.flow.length,
        r.gather.u,
        r.gather.v,
        r.gather.length,
        r.backLay,
      ]),
    );
    const depth = region.roots
      .map((r) => r.downDepth)
      .filter((v) => v !== undefined);
    return {
      region: region.name,
      capacity: region.capacity,
      roots: region.roots.length,
      rootCacheSha256: digest(bindings),
      shortGuidesSha256: digest(region.groomCurve),
      longGuidesSha256: digest(region.longGroomCurve),
      longStyleSha256: digest(region.longStyle),
      newDepthCache: depth.length
        ? {
            count: depth.length,
            min: Math.min(...depth),
            max: Math.max(...depth),
            allFinite: depth.every(Number.isFinite),
          }
        : null,
    };
  });
  const cases = [];
  let tick = 0;
  model.motion.setBreathing(false);
  model.motion.setIdleBlink(false);
  try {
    for (const profile of ["short-default", "long-default", "long-maximum"])
      for (const pose of ["stand", "rest"]) {
        const coat = profile.startsWith("short") ? "short" : "long";
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
        if (profile === "long-maximum")
          for (const region of ["head", "ruff", "body"])
            for (const p of ["FurLength", "FurDensity"])
              design.shape[region + p] = 100;
        api.applyCreatorDesign(model, design);
        fur.setDetail(1);
        fur.refresh({ full: true });
        const regions = [];
        for (const region of state.regions) {
          const geometry = region.mesh.geometry,
            attributes = {},
            protectedGroups = {};
          let invalidGeometry = 0;
          for (const key of [
            "position",
            "normal",
            "furWidth",
            "uv",
            "color",
            "furFilterAxis",
          ]) {
            const attribute = geometry.attributes[key];
            if (!attribute) continue;
            attributes[key] = {
              sha256: digest(attribute.array),
              count: attribute.count,
              itemSize: attribute.itemSize,
            };
            for (const value of attribute.array)
              if (!Number.isFinite(value)) invalidGeometry++;
          }
          attributes.index = {
            sha256: digest(geometry.index.array),
            count: geometry.index.count,
          };
          if (region.name === "body") {
            const groups = Object.fromEntries(
              ["outer", "limb", "tail"].map((name) => [
                name,
                {
                  roots: 0,
                  hashes: Object.fromEntries(
                    ["position", "normal", "furWidth"].map((k) => [
                      k,
                      createHash("sha256"),
                    ]),
                  ),
                },
              ]),
            );
            for (let i = 0; i < region.roots.length; i++) {
              const root = region.roots[i],
                roles = [];
              if (root.hairKind !== "down") roles.push("outer");
              if (root.kind === 1) roles.push("limb");
              if (root.kind === 2) roles.push("tail");
              for (const role of roles) {
                const group = groups[role];
                group.roots++;
                for (const key of ["position", "normal", "furWidth"]) {
                  const attr = geometry.attributes[key],
                    components = region.strandVertices * attr.itemSize,
                    offset = i * components;
                  group.hashes[key].update(
                    Buffer.from(
                      attr.array.buffer,
                      attr.array.byteOffset +
                        offset * attr.array.BYTES_PER_ELEMENT,
                      components * attr.array.BYTES_PER_ELEMENT,
                    ),
                  );
                }
              }
            }
            for (const [name, group] of Object.entries(groups))
              protectedGroups[name] = {
                roots: group.roots,
                attributes: Object.fromEntries(
                  Object.entries(group.hashes).map(([key, hash]) => [
                    key,
                    hash.digest("hex"),
                  ]),
                ),
              };
          }
          regions.push({
            region: region.name,
            strands: region.mesh.userData.strandCount,
            strandSegments: region.strandSegments,
            attributes,
            protectedGroups,
            invalidGeometry,
          });
        }
        cases.push({ profile, pose, regions });
      }
    archives[label] = {
      bundle,
      bundleSha256: runtime.bundleSha256,
      assetSha256: runtime.glbSha256,
      staticData,
      cases,
    };
  } finally {
    model.dispose();
  }
}
const staticComparison = archives.after.staticData.map((r, i) => {
  const b = archives.before.staticData[i];
  return {
    region: r.region,
    roots: r.roots,
    capacity: r.capacity,
    rootCacheUnchanged: r.rootCacheSha256 === b.rootCacheSha256,
    shortGuidesUnchanged: r.shortGuidesSha256 === b.shortGuidesSha256,
    longGuidesUnchanged: r.longGuidesSha256 === b.longGuidesSha256,
    longStyleUnchanged: r.longStyleSha256 === b.longStyleSha256,
    depthFinite:
      r.newDepthCache.allFinite &&
      r.newDepthCache.min >= 0 &&
      r.newDepthCache.max <= 1,
  };
});
const comparisons = archives.after.cases.flatMap((c, i) =>
  c.regions.map((r, j) => {
    const b = archives.before.cases[i].regions[j];
    const fullProtected = c.profile === "short-default" || r.region !== "body";
    return {
      profile: c.profile,
      pose: c.pose,
      region: r.region,
      invalidGeometry: r.invalidGeometry,
      fullGeometryProtected: fullProtected,
      allAttributesUnchanged: fullProtected
        ? JSON.stringify(r.attributes) === JSON.stringify(b.attributes)
        : null,
      outerUnchanged:
        r.region === "body"
          ? JSON.stringify(r.protectedGroups.outer) ===
            JSON.stringify(b.protectedGroups.outer)
          : null,
      limbUnchanged:
        r.region === "body"
          ? JSON.stringify(r.protectedGroups.limb) ===
            JSON.stringify(b.protectedGroups.limb)
          : null,
      tailUnchanged:
        r.region === "body"
          ? JSON.stringify(r.protectedGroups.tail) ===
            JSON.stringify(b.protectedGroups.tail)
          : null,
    };
  }),
);
const finalHashes = await sourceHashes();
const report = {
  capturedAt: new Date().toISOString(),
  method:
    "Actual archived10 and current11 GLB/runtime, read-only Node, full capacity geometry. Protected hashes cover positions,normals,real half-width; full protected regions additionally include UV,color,index,axis. Every float attribute scanned finite in default/max standing/rest.",
  change:
    "Only long body kind0 down N gain and its derivative receive a root-cached depth-dependent factor. The old backLay field and all planting/profile/length/width/surface binding data remain byte-identical. New downDepth and trunkWeight consume no random numbers.",
  sourceHashes: initialHashes,
  sourceStable: JSON.stringify(initialHashes) === JSON.stringify(finalHashes),
  assetUnchanged: archives.before.assetSha256 === archives.after.assetSha256,
  totalCapacity: archives.after.staticData.reduce((n, r) => n + r.capacity, 0),
  staticComparison,
  comparisons,
  archives,
  pass:
    staticComparison.every(
      (r) =>
        r.rootCacheUnchanged &&
        r.shortGuidesUnchanged &&
        r.longGuidesUnchanged &&
        r.longStyleUnchanged &&
        r.depthFinite,
    ) &&
    comparisons.every(
      (r) =>
        r.invalidGeometry === 0 &&
        (!r.fullGeometryProtected || r.allAttributesUnchanged) &&
        (r.region !== "body" ||
          (r.outerUnchanged && r.limbUnchanged && r.tailUnchanged)),
    ) &&
    JSON.stringify(initialHashes) === JSON.stringify(finalHashes) &&
    archives.before.assetSha256 === archives.after.assetSha256,
};
await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      output,
      pass: report.pass,
      sourceStable: report.sourceStable,
      totalCapacity: report.totalCapacity,
      staticComparison,
      comparisons,
    },
    null,
    2,
  ),
);
if (!report.pass) process.exitCode = 1;
