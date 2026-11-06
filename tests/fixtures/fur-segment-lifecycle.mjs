import * as THREE from "three";
import {
  createCatFurMaterial,
  configureCatFurMaterial,
} from "../../lib/cat-fur-material";
import { createCatFurSegmentPreview } from "../../lib/cat-fur-segments";

// Deliberately tiny prefixes reproduce the previous 8-active / 256-capacity
// reallocation bug. No renderer is needed to observe ownership or buffer reuse.
export function runFurSegmentLifecycle() {
  const strands = 80;
  function makeGeometry(segments) {
    const stride = (segments + 1) * 2;
    const geometry = new THREE.BufferGeometry();
    const count = strands * stride;
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const color = new Float32Array(count * 3).fill(1);
    const width = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const indices = [];
    for (let strand = 0; strand < strands; strand++) {
      for (let sample = 0; sample <= segments; sample++) {
        for (let side = 0; side < 2; side++) {
          const i = strand * stride + sample * 2 + side;
          position.set(
            [strand + (side ? 0.01 : -0.01), sample / segments, 0.001 * strand],
            i * 3,
          );
          normal.set([0, 0, 1], i * 3);
          width.set([0.01, 0, 0], i * 3);
          uv.set([side, sample / segments], i * 2);
        }
        if (sample < segments) {
          const i = strand * stride + sample * 2;
          indices.push(
            i,
            i + 1,
            i + 2,
            i + 1,
            i + 3,
            i + 2,
            i + 2,
            i + 1,
            i,
            i + 2,
            i + 3,
            i + 1,
          );
        }
      }
    }
    for (const [name, array, size] of [
      ["position", position, 3],
      ["normal", normal, 3],
      ["color", color, 3],
      ["furWidth", width, 3],
      ["uv", uv, 2],
    ])
      geometry.setAttribute(name, new THREE.BufferAttribute(array, size));
    geometry.setAttribute(
      "furFilterAxis",
      new THREE.BufferAttribute(new Int8Array(count).fill(1), 1),
    );
    geometry.setIndex(indices);
    geometry.setDrawRange(0, segments * 12);
    return geometry;
  }
  const material = createCatFurMaterial();
  configureCatFurMaterial(material, {
    coverageFilter: "box",
    renderPass: "accumulation",
  });
  const original = makeGeometry(8);
  const source = new THREE.Mesh(original, material);
  const metadata = (segments) =>
    Object.assign(source.userData, {
      furRegion: "body",
      norwegianFur: true,
      strandSegments: segments,
      strandVertices: (segments + 1) * 2,
      strandIndices: segments * 12,
      strandCount: strands,
      capacity: strands,
    });
  metadata(8);
  const parent = new THREE.Group();
  parent.add(source);
  const preview = createCatFurSegmentPreview(source);
  parent.add(preview.mesh);
  const liveDisposals = { geometry: 0, material: 0 };
  const proxyDisposals = { geometry: 0, material: 0 };
  const observed = new Set();
  function observeGeometry() {
    const geometry = preview.mesh.geometry;
    if (observed.has(geometry)) return;
    observed.add(geometry);
    geometry.addEventListener("dispose", () => proxyDisposals.geometry++);
  }
  original.addEventListener("dispose", () => liveDisposals.geometry++);
  material.addEventListener("dispose", () => liveDisposals.material++);
  preview.mesh.material.addEventListener(
    "dispose",
    () => proxyDisposals.material++,
  );
  const physicalBefore = original.attributes.position.array.slice();
  const rows = [];
  observeGeometry();
  function sample(label, activeStrands) {
    source.geometry.setDrawRange(
      0,
      activeStrands * source.userData.strandIndices,
    );
    const previous = preview.mesh.geometry;
    const disposalsBefore = proxyDisposals.geometry;
    const active = preview.sync();
    observeGeometry();
    const attributes = preview.mesh.geometry.attributes;
    const last = Math.max(0, preview.getInfo().instances - 1);
    rows.push({
      label,
      activeStrands,
      active,
      visible: preview.mesh.visible,
      sameGeometry: previous === preview.mesh.geometry,
      geometryDisposals: proxyDisposals.geometry - disposalsBefore,
      info: preview.getInfo(),
      updateRanges: Object.fromEntries(
        Object.entries(attributes)
          .filter(([name]) => name.startsWith("fur"))
          .map(([name, attribute]) => [
            name,
            attribute.updateRanges.map((range) => ({ ...range })),
          ]),
      ),
      firstStart: Array.from(attributes.furStart.array.slice(0, 3)),
      lastEnd: Array.from(
        attributes.furEnd.array.slice(last * 3, last * 3 + 3),
      ),
    });
  }
  sample("initial-small-prefix", 1);
  const stableGeometry = preview.mesh.geometry;
  const stableAttributes = Object.values(stableGeometry.attributes);
  for (let i = 0; i < 8; i++) sample("repeat-small-prefix", 1);
  const repeatedAttributeIdentity = stableAttributes.every(
    (attribute, i) =>
      Object.values(preview.mesh.geometry.attributes)[i] === attribute,
  );
  sample("grow", 40);
  sample("shrink", 1);
  sample("empty", 0);
  sample("restore", 1);
  sample("larger-prefix-within-capacity", 2);
  // Simulate shape/pose updating live buffers, not just a new draw count.
  const p = original.attributes.position;
  p.setX(0, p.getX(0) + 0.5);
  p.setX(1, p.getX(1) + 0.5);
  p.needsUpdate = true;
  sample("pose-update", 1);
  const replacement = makeGeometry(4);
  replacement.addEventListener("dispose", () => liveDisposals.geometry++);
  source.geometry = replacement;
  metadata(4);
  sample("coat-layout-change", 2);
  const beforeDispose = { ...proxyDisposals };
  preview.dispose();
  const once = { ...proxyDisposals };
  preview.dispose();
  const twice = { ...proxyDisposals };
  const result = {
    rows,
    repeatedAttributeIdentity,
    originalPhysicalUnchangedExceptRequestedPose: physicalBefore.every(
      (value, i) =>
        original.attributes.position.array[i] ===
        (i === 0 || i === 3 ? Math.fround(value + 0.5) : value),
    ),
    beforeDispose,
    once,
    twice,
    sourceDisposalsBeforeCleanup: { ...liveDisposals },
    proxyDetached: preview.mesh.parent === null,
    sourceStillAttached: source.parent === parent,
    sourceResourcesUnchanged:
      source.geometry === replacement && source.material === material,
    syncAfterDispose: preview.sync(),
  };
  original.dispose();
  replacement.dispose();
  material.dispose();
  return result;
}
