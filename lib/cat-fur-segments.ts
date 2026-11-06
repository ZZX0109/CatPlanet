import * as THREE from "three";
import { getCatFurMaterialSettings } from "./cat-fur-material";
import {
  createCatFurSegmentMaterial,
  configureCatFurSegmentMaterial,
} from "./cat-fur-segment-material";

const endpointAttributes = [
  "furStart",
  "furEnd",
  "furNormalStart",
  "furNormalEnd",
  "furColourStart",
  "furColourEnd",
  "furWidthStart",
  "furWidthEnd",
] as const;
type EndpointKey = (typeof endpointAttributes)[number];

function allocate(capacity: number) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0],
      3,
    ),
  );
  geometry.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3),
  );
  geometry.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2),
  );
  geometry.setIndex([0, 1, 2, 1, 3, 2]);
  const attributes = {} as Record<EndpointKey, THREE.InstancedBufferAttribute>;
  for (const name of endpointAttributes) {
    const attribute = new THREE.InstancedBufferAttribute(
      new Float32Array(capacity * 3),
      3,
    ).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
    attributes[name] = attribute;
  }
  const filterEnds = new THREE.InstancedBufferAttribute(
    new Int8Array(capacity * 2),
    2,
    false,
  ).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("furFilterEnds", filterEnds);
  geometry.instanceCount = 0;
  return { geometry, attributes, filterEnds };
}

/**
 * A render-only view of the actual groom's finite centreline segments.
 * The source ribbon arrays remain authoritative for editing and static export.
 * The caller attaches this proxy only during the weighted hair pass.
 */
export function createCatFurSegmentPreview(source: THREE.Mesh) {
  const material = createCatFurSegmentMaterial();
  let buffers = allocate(0);
  const mesh = new THREE.Mesh(buffers.geometry, material);
  mesh.name = `${source.name}_FiniteSegmentPreview`;
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = () => {};
  mesh.visible = false;
  mesh.userData = {
    norwegianFur: true,
    furSegmentPreview: true,
    furRegion: source.userData.furRegion,
  };
  let capacity = 0;
  let active = 0;
  let strands = 0;
  let segments = 0;
  let previousSignature = "";
  let disposed = false;
  const sourceMaterial = () => {
    const original = Array.isArray(source.material)
      ? source.material[0]
      : source.material;
    if (!(original instanceof THREE.MeshStandardMaterial))
      throw new Error("Finite fur preview requires the source fibre material.");
    return original;
  };

  function sync() {
    if (disposed) return false;
    const original = sourceMaterial();
    const geometry = source.geometry;
    const p = geometry.getAttribute("position") as THREE.BufferAttribute;
    const n = geometry.getAttribute("normal") as THREE.BufferAttribute;
    const c = geometry.getAttribute("color") as THREE.BufferAttribute;
    const w = geometry.getAttribute("furWidth") as THREE.BufferAttribute;
    const axis = geometry.getAttribute("furFilterAxis") as
      THREE.BufferAttribute | undefined;
    segments = Number(source.userData.strandSegments);
    const stride = Number(source.userData.strandVertices);
    const indexStride = Number(source.userData.strandIndices ?? segments * 12);
    if (
      !p ||
      !n ||
      !c ||
      !w ||
      !Number.isInteger(segments) ||
      segments < 1 ||
      stride !== (segments + 1) * 2 ||
      !Number.isInteger(indexStride) ||
      indexStride < segments * 6 ||
      geometry.drawRange.start !== 0
    )
      throw new Error(
        "Finite fur preview requires complete strand metadata and a draw prefix.",
      );
    const totalStrands = Math.floor(p.count / stride);
    strands = Math.max(
      0,
      Math.min(
        totalStrands,
        Math.floor(geometry.drawRange.count / indexStride),
      ),
    );
    active = strands * segments;
    // Grow in moderate blocks; shrink only after a substantial LOD decrease.
    // No allocation is based on the source's unused 130k-strand capacity.
    if (active > capacity || (active > 0 && active < capacity / 3)) {
      const nextCapacity = Math.ceil(active / 256) * 256;
      if (nextCapacity !== capacity) {
        const previous = buffers.geometry;
        buffers = allocate(nextCapacity);
        capacity = nextCapacity;
        mesh.geometry = buffers.geometry;
        previous.dispose();
        previousSignature = "";
      }
    }
    const signature = `${geometry.uuid}|${p.version}|${n.version}|${c.version}|${w.version}|${axis?.version ?? -1}|${active}|${segments}`;
    if (signature !== previousSignature && active > 0) {
      const arrays = Object.fromEntries(
        endpointAttributes.map((key) => [key, buffers.attributes[key].array]),
      ) as Record<EndpointKey, Float32Array>;
      const filterEnds = buffers.filterEnds.array as Int8Array;
      let instance = 0;
      for (let strand = 0; strand < strands; strand++) {
        const start = strand * stride;
        for (let segment = 0; segment < segments; segment++, instance++) {
          const a = start + segment * 2;
          const b = a + 2;
          const out = instance * 3;
          filterEnds[instance * 2] = axis ? Math.sign(axis.getX(a)) : 1;
          filterEnds[instance * 2 + 1] = axis ? Math.sign(axis.getX(b)) : 1;
          for (let axis = 0; axis < 3; axis++) {
            arrays.furStart[out + axis] =
              (p.getComponent(a, axis) + p.getComponent(a + 1, axis)) * 0.5;
            arrays.furEnd[out + axis] =
              (p.getComponent(b, axis) + p.getComponent(b + 1, axis)) * 0.5;
            arrays.furNormalStart[out + axis] = n.getComponent(a, axis);
            arrays.furNormalEnd[out + axis] = n.getComponent(b, axis);
            arrays.furColourStart[out + axis] = c.getComponent(a, axis);
            arrays.furColourEnd[out + axis] = c.getComponent(b, axis);
            arrays.furWidthStart[out + axis] = w.getComponent(a, axis);
            arrays.furWidthEnd[out + axis] = w.getComponent(b, axis);
          }
        }
      }
      for (const attribute of Object.values(buffers.attributes)) {
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(0, active * 3);
        attribute.needsUpdate = true;
      }
      buffers.filterEnds.clearUpdateRanges();
      buffers.filterEnds.addUpdateRange(0, active * 2);
      buffers.filterEnds.needsUpdate = true;
      previousSignature = signature;
    }
    buffers.geometry.instanceCount = active;
    mesh.visible = active > 0;
    const settings = getCatFurMaterialSettings(original);
    configureCatFurSegmentMaterial(material, {
      ...settings,
      renderPass: "accumulation",
      strandSegments: segments,
    });
    material.color.copy(original.color);
    material.roughness = original.roughness;
    material.metalness = original.metalness;
    material.opacity = original.opacity;
    material.envMapIntensity = original.envMapIntensity;
    mesh.matrix.copy(source.matrix);
    mesh.matrixWorldNeedsUpdate = true;
    mesh.userData.sourceStrands = strands;
    mesh.userData.sourceSegments = segments;
    return active > 0;
  }

  return {
    mesh,
    sync,
    getInfo() {
      return {
        strands,
        segmentsPerStrand: segments,
        instances: active,
        capacitySegments: capacity,
        bytes:
          Object.values(buffers.geometry.attributes).reduce(
            (sum, attribute) => sum + attribute.array.byteLength,
            0,
          ) + (buffers.geometry.index?.array.byteLength ?? 0),
        sourceGeometry: source.geometry.uuid,
        filter: getCatFurMaterialSettings(sourceMaterial()).coverageFilter,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mesh.removeFromParent();
      buffers.geometry.dispose();
      material.dispose();
    },
  };
}
