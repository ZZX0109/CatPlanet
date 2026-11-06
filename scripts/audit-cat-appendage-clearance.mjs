/** Paired closest-posed-skin audit of real down geometry; not a collision proof. */
import fs from "node:fs/promises";
import path from "node:path";
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { loadArchivedGroom } from "./cat-groom-audit-runtime.mjs";

const [
  oldBundle = "artifacts/fur-realism/round-12/performance-probe.js",
  newBundle = "artifacts/fur-realism/round-13/performance-probe.js",
  output = "artifacts/fur-realism/round-13/skin-clearance-audit.json",
] = process.argv.slice(2);
const sensitivity = process.argv.includes("--sensitivity");
globalThis.__catDepthTrialAlpha = 0.7;
const load = (bundle) =>
  loadArchivedGroom(bundle, {
    transformBundle: (source) => {
      let transformed = source.replace(
        "globalThis.__groomAuditState = {regions,evaluated,normals};",
        "globalThis.__groomAuditState = {regions,evaluated,normals,membership};",
      );
      if (sensitivity && bundle === newBundle) {
        const needle = "root.appendageWeight * 0.7 *";
        if (!transformed.includes(needle))
          throw Error("Depth sensitivity expression not found");
        transformed = transformed.replace(
          needle,
          "root.appendageWeight * globalThis.__catDepthTrialAlpha *",
        );
      }
      return transformed;
    },
  });
const before = await load(oldBundle),
  after = await load(newBundle);
const distribution = (values) => {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const at = (p) => values[Math.floor((values.length - 1) * p)];
  return {
    n: values.length,
    min: at(0),
    p01: at(0.01),
    p05: at(0.05),
    median: at(0.5),
    p95: at(0.95),
    max: at(1),
    negativeBeyond001mm: values.filter((v) => v < -0.001).length,
    negativeBeyond01mm: values.filter((v) => v < -0.1).length,
  };
};
const unit = (v) => {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};
function makeClosest(runtime) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(runtime.state.evaluated.slice(), 3),
  );
  geometry.setIndex(
    new THREE.BufferAttribute(runtime.surface.geometry.index.array.slice(), 1),
  );
  const bvh = new MeshBVH(geometry, { indirect: true, maxLeafTris: 8 }),
    index = geometry.index;
  const point = new THREE.Vector3(),
    a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    bary = new THREE.Vector3(),
    hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const keys = ["head", "limb", "tail", "hind"];
  return {
    dispose: () => geometry.dispose(),
    query(q, root) {
      bvh.closestPointToPoint(point.fromArray(q), hit);
      const ids = [0, 1, 2].map((i) => index.getX(hit.faceIndex * 3 + i));
      a.fromArray(runtime.state.evaluated, ids[0] * 3);
      b.fromArray(runtime.state.evaluated, ids[1] * 3);
      c.fromArray(runtime.state.evaluated, ids[2] * 3);
      THREE.Triangle.getBarycoord(hit.point, a, b, c, bary);
      const w = [bary.x, bary.y, bary.z],
        normal = [0, 0, 0],
        semantics = {};
      for (let i = 0; i < 3; i++)
        for (let k = 0; k < 3; k++)
          normal[k] += runtime.state.normals[ids[i] * 3 + k] * w[i];
      for (const key of keys)
        semantics[key] = ids.reduce(
          (s, id, i) => s + (runtime.state.membership[key]?.[id] ?? 0) * w[i],
          0,
        );
      const expected = {};
      for (const key of keys)
        expected[key] =
          (runtime.state.membership[key]?.[root.a] ?? 0) * root.u +
          (runtime.state.membership[key]?.[root.b] ?? 0) * root.v +
          (runtime.state.membership[key]?.[root.c] ?? 0) * root.w;
      const N = unit(normal),
        difference = q.map((v, k) => v - hit.point.getComponent(k));
      const sign = Math.sign(difference.reduce((s, v, k) => s + v * N[k], 0));
      const kindCompatible =
        root.kind === 2
          ? semantics.tail > 0.45
          : root.kind === 1
            ? semantics.limb > 0.35
            : semantics.head < 0.4 &&
              semantics.limb < 0.4 &&
              semantics.tail < 0.4;
      const vectorCompatible = keys.every(
        (key) => Math.abs(semantics[key] - expected[key]) <= 0.45,
      );
      return {
        signedMM: sign * hit.distance * runtime.mmPerUnit,
        compatible: kindCompatible && vectorCompatible,
        face: hit.faceIndex,
        semantics,
      };
    },
  };
}
const report = {
  capturedAt: new Date().toISOString(),
  before: {
    bundle: oldBundle,
    sha: before.bundleSha256,
    asset: before.glbSha256,
  },
  after: { bundle: newBundle, sha: after.bundleSha256, asset: after.glbSha256 },
  sampleEvery: 17,
  sensitivityInMemoryOnly: sensitivity,
  method:
    "Actual paired body down centreline samples at each segment midpoint and endpoint; full posed source-skin BVH closest point, signed by barycentric source normal. No root-normal height substitution.",
  semanticFilter:
    "Nearest hit must match kind (tail>.45,limb>.35,nonappendage head/limb/tail<.4) and head/limb/tail/hind membership differences from the source root must each be<=.45. Reject incompatible closest hits without searching a more convenient surface.",
  limitations: [
    "Millimetres assume a300mm skin height, not a physical measurement.",
    "An interpolated normal sign at the nearest triangle is local and is not a watertight SDF or a full collision proof. Semantic filters cannot distinguish every nearby surface of the same limb class.",
    "Finite midpoint/endpoint sampling can miss inter-sample penetrations; report raw and rejected populations rather than hiding them.",
    "Paired primary summaries exclude either-state ground contact and either-state semantic mismatch. Both excluded populations retain separate clearance distributions.",
  ],
  profiles: [],
};
try {
  for (const pose of ["stand", "rest"]) {
    for (const runtime of [before, after]) {
      runtime.model.motion.setBreathing(false);
      runtime.model.motion.setIdleBlink(false);
      runtime.model.motion.setPose(pose, true);
      runtime.model.motion.update(1, { reducedMotion: true });
      runtime.api.applyCreatorDesign(runtime.model, {
        ...runtime.api.defaultCreatorDesign,
        coatType: "long",
        shape: {
          ...runtime.api.defaultCreatorDesign.shape,
          ...runtime.api.getCatCoatProfile("long").defaults,
          headFurDensity: 100,
          ruffFurDensity: 100,
          bodyFurDensity: 100,
        },
      });
      runtime.fur.setDetail(1);
      runtime.fur.refresh({ full: true });
    }
    const old = before.state.regions.find((r) => r.name === "body"),
      next = after.state.regions.find((r) => r.name === "body"),
      ca = makeClosest(before),
      cb = makeClosest(after);
    for (const alpha of sensitivity ? [0.4, 0.5, 0.6, 0.7] : [0.7]) {
      if (sensitivity) {
        globalThis.__catDepthTrialAlpha = alpha;
        next.length = -1;
        next.pendingFull = true;
        after.fur.refresh({ full: true });
      }
      const groups = new Map(),
        worst = [];
      const group = (name) => {
        if (!groups.has(name))
          groups.set(name, {
            name,
            roots: 0,
            samples: 0,
            contact: 0,
            semanticMismatch: 0,
            rawOld: [],
            rawNew: [],
            pairedOld: [],
            pairedNew: [],
            contactOld: [],
            contactNew: [],
            mismatchOld: [],
            mismatchNew: [],
            radiusMarginOld: [],
            radiusMarginNew: [],
            newNegativeOnly: 0,
            newDeep02mm: 0,
            newDeep05mm: 0,
            newDeep02mmRoots: new Set(),
            newDeep05mmRoots: new Set(),
            alreadyNegativeBefore: 0,
            alreadyNegativeAfterBelow02mm: 0,
            alreadyNegativeAfterBelow05mm: 0,
            newNegativeOnlyRoots: new Set(),
            beforeNegativeRoots: new Set(),
            afterNegativeRoots: new Set(),
          });
        return groups.get(name);
      };
      const sample = (region, i, t) => {
        const lower = Math.min(region.strandSegments - 1, Math.floor(t)),
          f = t - lower,
          attr = region.mesh.geometry.attributes,
          base = i * region.strandVertices;
        const position = [0, 0, 0];
        let leftY = 0,
          rightY = 0,
          radius = 0;
        for (let node = 0; node < 2; node++) {
          const w = node ? f : 1 - f,
            vertex = base + (lower + node) * 2;
          for (let k = 0; k < 3; k++)
            position[k] +=
              (attr.position.getComponent(vertex, k) +
                attr.position.getComponent(vertex + 1, k)) *
              0.5 *
              w;
          leftY += attr.position.getY(vertex) * w;
          rightY += attr.position.getY(vertex + 1) * w;
          radius +=
            Math.hypot(
              attr.furWidth.getX(vertex),
              attr.furWidth.getY(vertex),
              attr.furWidth.getZ(vertex),
            ) * w;
        }
        return {
          position,
          minY: Math.min(leftY, rightY),
          radiusMM: radius * before.mmPerUnit,
        };
      };
      for (let i = 0; i < old.roots.length; i += 17) {
        const root = old.roots[i],
          other = next.roots[i];
        if (root.hairKind !== "down" || !(other.appendageWeight > 0)) continue;
        const anatomy =
            root.kind === 2 ? "tail" : root.kind === 1 ? "limb" : "transition",
          layer =
            root.downDepth <= 0.35
              ? "low"
              : root.downDepth <= 0.7
                ? "middle"
                : "upper",
          g = group(anatomy + "/" + layer);
        g.roots++;
        for (let s = 0.5; s <= old.strandSegments; s += 0.5) {
          const qa = sample(old, i, s),
            qb = sample(next, i, s),
            a = ca.query(qa.position, root),
            b = cb.query(qb.position, other);
          g.samples++;
          g.rawOld.push(a.signedMM);
          g.rawNew.push(b.signedMM);
          const contact =
            qa.minY <= before.bounds.min.y + 0.002001 ||
            qb.minY <= after.bounds.min.y + 0.002001;
          if (contact) {
            g.contact++;
            g.contactOld.push(a.signedMM);
            g.contactNew.push(b.signedMM);
            continue;
          }
          if (!a.compatible || !b.compatible) {
            g.semanticMismatch++;
            g.mismatchOld.push(a.signedMM);
            g.mismatchNew.push(b.signedMM);
            continue;
          }
          g.pairedOld.push(a.signedMM);
          g.pairedNew.push(b.signedMM);
          g.radiusMarginOld.push(a.signedMM - qa.radiusMM);
          g.radiusMarginNew.push(b.signedMM - qb.radiusMM);
          if (a.signedMM >= 0 && b.signedMM < -0.2) {
            g.newDeep02mm++;
            g.newDeep02mmRoots.add(i);
          }
          if (a.signedMM >= 0 && b.signedMM < -0.5) {
            g.newDeep05mm++;
            g.newDeep05mmRoots.add(i);
          }
          if (a.signedMM < 0) {
            g.alreadyNegativeBefore++;
            if (b.signedMM < -0.2) g.alreadyNegativeAfterBelow02mm++;
            if (b.signedMM < -0.5) g.alreadyNegativeAfterBelow05mm++;
          }
          if (a.signedMM < -0.001) g.beforeNegativeRoots.add(i);
          if (b.signedMM < -0.001) g.afterNegativeRoots.add(i);
          if (a.signedMM >= -0.001 && b.signedMM < -0.001) {
            g.newNegativeOnly++;
            g.newNegativeOnlyRoots.add(i);
          }
          if (b.signedMM < -0.1)
            worst.push({
              root: i,
              node: s,
              group: g.name,
              downDepth: root.downDepth,
              appendageWeight: other.appendageWeight,
              oldSignedMM: a.signedMM,
              newSignedMM: b.signedMM,
              oldFace: a.face,
              newFace: b.face,
            });
        }
      }
      worst.sort((a, b) => a.newSignedMM - b.newSignedMM);
      const summary = [...groups.values()].map((g) =>
        Object.fromEntries(
          Object.entries(g).map(([key, value]) => [
            key,
            Array.isArray(value)
              ? distribution(value)
              : value instanceof Set
                ? { count: value.size, rootIds: [...value] }
                : value,
          ]),
        ),
      );
      report.profiles.push({
        pose,
        alpha,
        groups: summary,
        worstAcceptedAfter: worst.slice(0, 20),
      });
      console.log(
        JSON.stringify({
          pose,
          alpha,
          groups: summary.map((g) => ({
            group: g.name,
            roots: g.roots,
            paired: g.pairedNew?.n,
            oldMedian: g.pairedOld?.median,
            newMedian: g.pairedNew?.median,
            oldMin: g.pairedOld?.min,
            newMin: g.pairedNew?.min,
            newNegativeOnly: g.newNegativeOnly,
            newDeep02mm: g.newDeep02mm,
            newDeep05mm: g.newDeep05mm,
            newNegative: g.pairedNew?.negativeBeyond01mm,
            contact: g.contact,
            mismatch: g.semanticMismatch,
          })),
        }),
      );
    }
    ca.dispose();
    cb.dispose();
  }
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      output,
      sourceModelUnchanged: before.glbSha256 === after.glbSha256,
    }),
  );
} finally {
  before.fur.dispose();
  after.fur.dispose();
}
