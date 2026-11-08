/** Structural/resource inspection only. This is not a visual, rig-semantic or license acceptance. */
import { createHash } from "node:crypto";
const COMPONENT_READERS = {
  5120: { size: 1, read: (b, p) => b.readInt8(p) },
  5121: { size: 1, read: (b, p) => b.readUInt8(p) },
  5122: { size: 2, read: (b, p) => b.readInt16LE(p) },
  5123: { size: 2, read: (b, p) => b.readUInt16LE(p) },
  5125: { size: 4, read: (b, p) => b.readUInt32LE(p) },
  5126: { size: 4, read: (b, p) => b.readFloatLE(p) },
};
const TYPE_LAYOUT = {
  SCALAR: [1, 1],
  VEC2: [1, 2],
  VEC3: [1, 3],
  VEC4: [1, 4],
  MAT2: [2, 2],
  MAT3: [3, 3],
  MAT4: [4, 4],
};
const uint = (v) => Number.isSafeInteger(v) && v >= 0 && v <= 0xffffffff;
const invalid = (message) => {
  throw Object.assign(Error(message), { code: "GLB_INVALID" });
};

/** Hard inspection ceilings, independent of a caller's declared model budgets.
 * Overrides may only LOWER these limits for constrained callers or tests. Scalar
 * reads count cumulative physical scans and lazy reads; identical finite/index/
 * time ranges are memoized. Large implicit zero arrays never allocate storage.
 */
export const GLB_INSPECTION_LIMITS = Object.freeze({
  maxFileBytes: 268435456,
  maxJsonBytes: 33554432,
  maxDescriptors: 50000,
  maxScalarReads: 200000000,
  maxHashBytes: 536870912,
});
const INTERNAL_BUDGET = Symbol("inspection-budget");
const resourceLimit = (message) => {
  throw Object.assign(Error(message), { code: "GLB_RESOURCE_LIMIT" });
};
function inspectionBudget(options = {}) {
  if (options[INTERNAL_BUDGET]) return options[INTERNAL_BUDGET];
  const limits = { ...GLB_INSPECTION_LIMITS };
  for (const [key, value] of Object.entries(options.limits ?? {})) {
    if (
      !Object.hasOwn(limits, key) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > limits[key]
    )
      invalid(
        "Inspection limit overrides may only lower known positive ceilings",
      );
    limits[key] = value;
  }
  const used = { maxDescriptors: 0, maxScalarReads: 0, maxHashBytes: 0 };
  return {
    limits,
    finiteRanges: new Set(),
    sparseIndices: new Map(),
    reserve(key, count) {
      if (
        !Number.isSafeInteger(count) ||
        count < 0 ||
        count > limits[key] - used[key]
      )
        resourceLimit("GLB cumulative inspection limit exceeded: " + key);
      used[key] += count;
    },
  };
}

/**
 * Lazy raw accessor readers (before normalized conversion). Sparse overrides are
 * resolved from their sorted index buffer; absent dense storage reads as zero.
 * No count-sized arrays are allocated, including implicit all-zero accessors.
 */
export function createAccessorReaders(doc, binBytes, options = {}) {
  const budget = inspectionBudget(options);
  const views = doc.bufferViews ?? [],
    accessors = doc.accessors ?? [];
  if (!Array.isArray(views) || !Array.isArray(accessors))
    invalid("Invalid accessor collections");
  budget.reserve("maxDescriptors", views.length + accessors.length);
  for (const view of views) {
    if (
      !view ||
      view.buffer !== 0 ||
      !uint(view.byteOffset ?? 0) ||
      !uint(view.byteLength) ||
      (view.byteOffset ?? 0) + view.byteLength > binBytes.length
    )
      invalid("Out of bounds bufferView");
    if (
      view.byteStride !== undefined &&
      (!uint(view.byteStride) ||
        view.byteStride < 4 ||
        view.byteStride > 252 ||
        view.byteStride % 4)
    )
      invalid("Invalid bufferView stride");
  }
  const viewAt = (index) => {
    if (!uint(index) || !views[index])
      invalid("Invalid accessor bufferView reference");
    return views[index];
  };
  return accessors.map((a) => {
    if (!a || !uint(a.count) || a.count < 1) invalid("Invalid accessor count");
    if (
      !Number.isInteger(a.componentType) ||
      !Object.hasOwn(COMPONENT_READERS, a.componentType) ||
      typeof a.type !== "string" ||
      !Object.hasOwn(TYPE_LAYOUT, a.type)
    )
      invalid("Invalid accessor component type or shape");
    const component = COMPONENT_READERS[a.componentType],
      shape = TYPE_LAYOUT[a.type];
    if (!component || !shape)
      invalid("Invalid accessor component type or shape");
    if (
      a.normalized !== undefined &&
      (typeof a.normalized !== "boolean" ||
        (a.normalized && ![5120, 5121, 5122, 5123].includes(a.componentType)))
    )
      invalid("Invalid normalized accessor component type");
    const [columns, rows] = shape,
      isMatrix = columns > 1;
    const columnStride = isMatrix
      ? Math.ceil((rows * component.size) / 4) * 4
      : rows * component.size;
    const elementStride = columns * columnStride;
    // The last column's trailing padding may be omitted from the bufferView.
    const elementExtent = (columns - 1) * columnStride + rows * component.size;
    const componentOffsets = Array.from(
      { length: columns * rows },
      (_, i) =>
        Math.floor(i / rows) * columnStride + (i % rows) * component.size,
    );
    const aligned = (view, offset, matrix = false, size = component.size) => {
      if (
        !uint(offset) ||
        offset % size ||
        ((view.byteOffset ?? 0) + offset) % size ||
        (matrix && ((view.byteOffset ?? 0) + offset) % 4)
      )
        invalid("Misaligned accessor or sparse byteOffset");
    };
    const range = (view, offset, count, stride, extent) => {
      const end = offset + (count - 1) * stride + extent;
      if (!Number.isSafeInteger(end) || end > view.byteLength)
        invalid("Accessor or sparse data exceeds bufferView range");
    };
    let base = null;
    if (a.bufferView !== undefined) {
      const view = viewAt(a.bufferView),
        offset = a.byteOffset ?? 0,
        stride = view.byteStride ?? elementStride;
      aligned(view, offset, isMatrix);
      if (
        stride < elementStride ||
        stride % component.size ||
        (isMatrix && stride % 4)
      )
        invalid("Invalid accessor element stride");
      range(view, offset, a.count, stride, elementExtent);
      base = { view, offset: (view.byteOffset ?? 0) + offset, stride };
    } else if (a.byteOffset !== undefined)
      invalid("Accessor byteOffset requires bufferView");
    let sparse = null;
    if (a.sparse !== undefined) {
      const sp = a.sparse;
      if (
        !sp ||
        !uint(sp.count) ||
        sp.count < 1 ||
        sp.count > a.count ||
        !sp.indices ||
        !sp.values
      )
        invalid("Invalid sparse accessor count or definition");
      if (![5121, 5123, 5125].includes(sp.indices.componentType))
        invalid("Invalid sparse index component type");
      const ic = COMPONENT_READERS[sp.indices.componentType];
      const indexView = viewAt(sp.indices.bufferView),
        valueView = viewAt(sp.values.bufferView);
      if (
        indexView.byteStride !== undefined ||
        valueView.byteStride !== undefined ||
        indexView.target !== undefined ||
        valueView.target !== undefined
      )
        invalid("Sparse bufferViews must not define stride or target");
      const indexOffset = sp.indices.byteOffset ?? 0,
        valueOffset = sp.values.byteOffset ?? 0;
      aligned(indexView, indexOffset, false, ic.size);
      aligned(valueView, valueOffset, isMatrix);
      range(indexView, indexOffset, sp.count, ic.size, ic.size);
      range(valueView, valueOffset, sp.count, elementStride, elementExtent);
      const indexAt = (i) =>
        ic.read(
          binBytes,
          (indexView.byteOffset ?? 0) + indexOffset + i * ic.size,
        );
      const indexKey = [
        (indexView.byteOffset ?? 0) + indexOffset,
        sp.count,
        sp.indices.componentType,
      ].join(":");
      let highestIndex = budget.sparseIndices.get(indexKey);
      if (highestIndex === undefined) {
        budget.reserve("maxScalarReads", sp.count);
        let previous = -1;
        for (let i = 0; i < sp.count; i++) {
          const index = indexAt(i);
          if (index <= previous)
            invalid(
              "Sparse indices must be sorted, unique and less than accessor count",
            );
          previous = index;
        }
        highestIndex = previous;
        budget.sparseIndices.set(indexKey, highestIndex);
      }
      if (highestIndex >= a.count)
        invalid(
          "Sparse indices must be sorted, unique and less than accessor count",
        );
      sparse = {
        count: sp.count,
        indexAt,
        valueOffset: (valueView.byteOffset ?? 0) + valueOffset,
      };
    }
    const findSparse = (index) => {
      if (!sparse) return -1;
      let lo = 0,
        hi = sparse.count - 1;
      while (lo <= hi) {
        budget.reserve("maxScalarReads", 1);
        const mid = lo + Math.floor((hi - lo) / 2),
          value = sparse.indexAt(mid);
        if (value === index) return mid;
        if (value < index) lo = mid + 1;
        else hi = mid - 1;
      }
      return -1;
    };
    const read = (index, c = 0) => {
      if (
        !uint(index) ||
        index >= a.count ||
        !Number.isInteger(c) ||
        c < 0 ||
        c >= componentOffsets.length
      )
        invalid("Accessor read outside logical range");
      budget.reserve("maxScalarReads", 1);
      const spIndex = findSparse(index);
      if (spIndex >= 0)
        return component.read(
          binBytes,
          sparse.valueOffset + spIndex * elementStride + componentOffsets[c],
        );
      return base
        ? component.read(
            binBytes,
            base.offset + index * base.stride + componentOffsets[c],
          )
        : 0;
    };
    // Scan physically stored floats, not count*components implicit zeros.
    if (a.componentType === 5126) {
      for (const store of [
        base && { offset: base.offset, count: a.count, stride: base.stride },
        sparse && {
          offset: sparse.valueOffset,
          count: sparse.count,
          stride: elementStride,
        },
      ].filter(Boolean)) {
        const key = [
          store.offset,
          store.count,
          store.stride,
          ...componentOffsets,
        ].join(":");
        if (budget.finiteRanges.has(key)) continue;
        budget.reserve("maxScalarReads", store.count * componentOffsets.length);
        for (let i = 0; i < store.count; i++)
          for (const c of componentOffsets)
            if (
              !Number.isFinite(
                component.read(binBytes, store.offset + i * store.stride + c),
              )
            )
              invalid("Nonfinite floating-point accessor");
        budget.finiteRanges.add(key);
      }
    }
    return {
      storageKey: JSON.stringify([
        a.componentType,
        a.type,
        a.count,
        base?.offset,
        base?.stride,
        sparse?.count,
        sparse?.valueOffset,
        a.sparse?.indices?.componentType,
        a.sparse
          ? (views[a.sparse.indices.bufferView].byteOffset ?? 0) +
            (a.sparse.indices.byteOffset ?? 0)
          : null,
      ]),
      count: a.count,
      componentType: a.componentType,
      type: a.type,
      components: componentOffsets.length,
      hasBaseBufferView: !!base,
      sparseCount: sparse?.count ?? 0,
      read,
      forEachStoredValue(visitor) {
        budget.reserve(
          "maxScalarReads",
          (base ? a.count : (sparse?.count ?? 0)) * componentOffsets.length +
            (sparse?.count ?? 0),
        );
        if (base) {
          let sp = 0,
            next = sparse ? sparse.indexAt(0) : -1;
          for (let i = 0; i < a.count; i++) {
            const overridden = i === next;
            for (let c = 0; c < componentOffsets.length; c++)
              visitor(
                component.read(
                  binBytes,
                  overridden
                    ? sparse.valueOffset +
                        sp * elementStride +
                        componentOffsets[c]
                    : base.offset + i * base.stride + componentOffsets[c],
                ),
                i,
                c,
              );
            if (overridden) {
              sp++;
              next = sp < sparse.count ? sparse.indexAt(sp) : -1;
            }
          }
        } else if (sparse) {
          for (let i = 0; i < sparse.count; i++) {
            const index = sparse.indexAt(i);
            for (let c = 0; c < componentOffsets.length; c++)
              visitor(
                component.read(
                  binBytes,
                  sparse.valueOffset + i * elementStride + componentOffsets[c],
                ),
                index,
                c,
              );
          }
        }
      },
    };
  });
}

export function inspectGlb(bytes, options = {}) {
  const budget = inspectionBudget(options);
  if (bytes.length > budget.limits.maxFileBytes)
    resourceLimit("GLB file exceeds inspection byte ceiling");
  const fail = (m) => {
    throw Object.assign(Error(m), { code: "GLB_INVALID" });
  };
  if (
    bytes.length < 28 ||
    bytes.readUInt32LE(0) !== 0x46546c67 ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length
  )
    fail("Invalid GLB header or file length");
  const jsonLength = bytes.readUInt32LE(12);
  if (
    jsonLength % 4 ||
    bytes.readUInt32LE(16) !== 0x4e4f534a ||
    20 + jsonLength + 8 > bytes.length
  )
    fail("Invalid JSON chunk");
  if (jsonLength > budget.limits.maxJsonBytes)
    resourceLimit("GLB JSON exceeds inspection byte ceiling");
  let doc;
  try {
    doc = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  } catch {
    fail("Invalid GLB JSON");
  }
  const binOffset = 28 + jsonLength,
    binLength = bytes.readUInt32LE(20 + jsonLength);
  if (
    bytes.readUInt32LE(24 + jsonLength) !== 0x004e4942 ||
    binLength % 4 ||
    binOffset + binLength !== bytes.length
  )
    fail("Invalid BIN chunk");
  if (
    doc.asset?.version !== "2.0" ||
    doc.buffers?.length !== 1 ||
    doc.buffers[0].uri ||
    !Number.isInteger(doc.buffers[0].byteLength) ||
    doc.buffers[0].byteLength > binLength ||
    binLength - doc.buffers[0].byteLength > 3
  )
    fail("Expected one embedded GLB 2.0 buffer");
  const views = doc.bufferViews ?? [],
    accessors = doc.accessors ?? [],
    nodes = doc.nodes ?? [],
    meshes = doc.meshes ?? [];
  if (
    !Array.isArray(views) ||
    !Array.isArray(accessors) ||
    !Array.isArray(nodes) ||
    !Array.isArray(meshes)
  )
    fail("Invalid GLB collections");
  for (const key of [
    "nodes",
    "meshes",
    "materials",
    "skins",
    "animations",
    "images",
    "textures",
    "samplers",
    "scenes",
  ]) {
    const list = doc[key] ?? [];
    if (!Array.isArray(list)) fail("Invalid GLB descriptor collection: " + key);
    budget.reserve("maxDescriptors", list.length);
  }
  const uint = (v) => Number.isSafeInteger(v) && v >= 0;
  for (const v of views)
    if (
      v.buffer !== 0 ||
      !uint(v.byteOffset ?? 0) ||
      !uint(v.byteLength) ||
      (v.byteOffset ?? 0) + v.byteLength > doc.buffers[0].byteLength
    )
      fail("Out of bounds bufferView");
  const accessorReaders = createAccessorReaders(
    doc,
    bytes.subarray(binOffset, binOffset + doc.buffers[0].byteLength),
    { [INTERNAL_BUDGET]: budget },
  );
  let vertices = 0,
    triangles = 0;
  const morphTargets = new Set(),
    bodyNodes = [],
    meshNodeNames = [];
  const primitiveInfo = [],
    meshNodeTriangleCounts = {},
    meshTriangleCounts = [],
    meshMorphCounts = [];
  const indexMaxima = new Map(),
    orderedTimes = new Set();
  for (const mesh of meshes) {
    if (!mesh || !Array.isArray(mesh.primitives))
      fail("Mesh has no primitives");
    budget.reserve("maxDescriptors", mesh.primitives.length);
    let meshTriangles = 0,
      morphCount = null;
    for (const p of mesh.primitives) {
      budget.reserve("maxDescriptors", Object.keys(p.attributes ?? {}).length);
      if (
        p.material !== undefined &&
        (!uint(p.material) || !doc.materials?.[p.material])
      )
        fail("Invalid primitive material reference");
      const pos = accessors[p.attributes?.POSITION];
      if (!pos || pos.type !== "VEC3" || pos.componentType !== 5126)
        fail("Missing float VEC3 positions");
      for (const [semantic, ref] of Object.entries(p.attributes ?? {}))
        if (!accessors[ref] || accessors[ref].count !== pos.count)
          fail("Primitive attribute accessor/count mismatch");
      vertices += pos.count;
      const count =
        p.indices === undefined ? pos.count : accessors[p.indices]?.count;
      if (!uint(count)) fail("Invalid indices");
      if (p.indices !== undefined) {
        const ia = accessors[p.indices];
        if (
          ia.type !== "SCALAR" ||
          ![5121, 5123, 5125].includes(ia.componentType)
        )
          fail("Indices must be unsigned SCALAR");
        if (
          ia.bufferView !== undefined &&
          views[ia.bufferView].byteStride !== undefined
        )
          fail("Index bufferView must not define byteStride");
        // Implicit entries are zero; inspect only stored values to bound work by
        // the input bytes rather than a huge all-zero logical accessor count.
        if (ia.normalized === true)
          fail("Index accessors must not be normalized");
        const reader = accessorReaders[p.indices];
        let maximum = indexMaxima.get(reader.storageKey);
        if (maximum === undefined) {
          maximum = 0;
          reader.forEachStoredValue((value) => {
            maximum = Math.max(maximum, value);
          });
          indexMaxima.set(reader.storageKey, maximum);
        }
        if (maximum >= pos.count) fail("Index outside POSITION range");
      }
      if ((p.mode ?? 4) !== 4)
        fail("Only triangle primitives currently supported");
      if (count % 3) fail("Triangle count is not integral");
      triangles += count / 3;
      meshTriangles += count / 3;
      const targets = p.targets ?? [];
      if (!Array.isArray(targets)) fail("Invalid morph targets");
      budget.reserve("maxDescriptors", targets.length);
      if (morphCount === null) morphCount = targets.length;
      else if (morphCount !== targets.length) morphCount = -1;
      if (
        mesh.extras?.targetNames &&
        mesh.extras.targetNames.length !== targets.length
      )
        fail("Morph target names/count mismatch");
      targets.forEach((t, i) => {
        budget.reserve("maxDescriptors", Object.keys(t).length);
        for (const [semantic, ref] of Object.entries(t))
          if (
            !["POSITION", "NORMAL", "TANGENT"].includes(semantic) ||
            !accessors[ref] ||
            accessors[ref].count !== pos.count ||
            accessors[ref].type !== "VEC3" ||
            accessors[ref].componentType !== 5126
          )
            fail("Invalid morph accessor");
        morphTargets.add(mesh.extras?.targetNames?.[i] ?? `unnamed:${i}`);
      });
      primitiveInfo.push({ mesh, primitive: p, positions: pos });
    }
    meshTriangleCounts.push(meshTriangles);
    meshMorphCounts.push(morphCount);
  }
  for (const [i, n] of nodes.entries()) {
    if (!n || !Array.isArray(n.children ?? [])) fail("Invalid node/children");
    budget.reserve("maxDescriptors", (n.children ?? []).length);
    for (const [key, len] of [
      ["translation", 3],
      ["rotation", 4],
      ["scale", 3],
      ["matrix", 16],
    ])
      if (
        n[key] !== undefined &&
        (!Array.isArray(n[key]) ||
          n[key].length !== len ||
          n[key].some((v) => !Number.isFinite(v)))
      )
        fail("Invalid/nonfinite node transform");
    if (n.skin !== undefined && !doc.skins?.[n.skin])
      fail("Invalid skin reference");
    if (
      n.rotation &&
      Math.abs(n.rotation.reduce((sum, v) => sum + v * v, 0) - 1) > 1e-4
    )
      fail("Quaternion must be normalized");
    if (
      n.matrix !== undefined &&
      ["translation", "rotation", "scale"].some((k) => n[k] !== undefined)
    )
      fail("Matrix and TRS conflict");
    if (n.mesh !== undefined) {
      if (!meshes[n.mesh]) fail("Invalid mesh node");
      meshNodeNames.push(n.name ?? `node:${i}`);
      meshNodeTriangleCounts[n.name ?? `node:${i}`] =
        meshTriangleCounts[n.mesh];
    }
    if (
      n.name === "bodySurface" ||
      n.extras?.role === "bodySurface" ||
      n.extras?.bodySurface === true
    )
      bodyNodes.push(n.name ?? `node:${i}`);
    for (const c of n.children ?? []) if (!nodes[c]) fail("Invalid child node");
  }
  const parents = new Map();
  for (const [i, n] of nodes.entries())
    for (const c of n.children ?? []) {
      if (parents.has(c)) fail("Node has multiple parents");
      parents.set(c, i);
    }
  // Iterative DFS avoids JS call-stack exhaustion for legal deep hierarchies.
  const colors = new Uint8Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    if (colors[i]) continue;
    const stack = [{ index: i, next: 0 }];
    colors[i] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1],
        children = nodes[top.index].children ?? [];
      if (top.next === children.length) {
        colors[top.index] = 2;
        stack.pop();
        continue;
      }
      const child = children[top.next++];
      if (colors[child] === 1) fail("Node cycle");
      if (!colors[child]) {
        colors[child] = 1;
        stack.push({ index: child, next: 0 });
      }
    }
  }
  const joints = new Set(),
    jointIndices = new Set();
  for (const s of doc.skins ?? []) {
    if (!s || !Array.isArray(s.joints)) fail("Invalid skin joints");
    budget.reserve("maxDescriptors", s.joints.length);
    if (s.inverseBindMatrices !== undefined) {
      const accessor = accessors[s.inverseBindMatrices];
      if (
        !uint(s.inverseBindMatrices) ||
        !accessor ||
        accessor.componentType !== 5126 ||
        accessor.type !== "MAT4" ||
        accessor.count < s.joints.length
      )
        fail("Invalid inverseBindMatrices accessor");
    }
    if (new Set(s.joints).size !== s.joints.length)
      fail("Duplicate joint index in skin");
    for (const j of s.joints) {
      if (!nodes[j]) fail("Invalid joint node");
      jointIndices.add(j);
      joints.add(nodes[j].name ?? `node:${j}`);
    }
  }
  for (const animation of doc.animations ?? []) {
    if (
      !Array.isArray(animation.samplers) ||
      !animation.samplers.length ||
      !Array.isArray(animation.channels) ||
      !animation.channels.length
    )
      fail("Animation requires samplers and channels");
    budget.reserve(
      "maxDescriptors",
      animation.samplers.length + animation.channels.length,
    );
    for (const sampler of animation.samplers) {
      const input = accessors[sampler.input],
        output = accessors[sampler.output];
      if (
        !uint(sampler.input) ||
        !uint(sampler.output) ||
        !input ||
        !output ||
        input.type !== "SCALAR" ||
        input.componentType !== 5126 ||
        output.componentType !== 5126 ||
        !["LINEAR", "STEP", "CUBICSPLINE"].includes(
          sampler.interpolation ?? "LINEAR",
        )
      )
        fail("Invalid animation sampler accessor/type/interpolation");
      const reader = accessorReaders[sampler.input];
      if (!reader.hasBaseBufferView && reader.sparseCount < input.count - 1)
        fail("Animation times must be nonnegative and strictly increasing");
      if (orderedTimes.has(reader.storageKey)) continue;
      let previous = -Infinity;
      for (let i = 0; i < input.count; i++) {
        const time = reader.read(i);
        if (time < 0 || time <= previous)
          fail("Animation times must be nonnegative and strictly increasing");
        previous = time;
      }
      orderedTimes.add(reader.storageKey);
    }
    for (const channel of animation.channels) {
      const sampler = animation.samplers[channel.sampler],
        target = channel.target;
      if (
        !uint(channel.sampler) ||
        !sampler ||
        !target ||
        !uint(target.node) ||
        !nodes[target.node] ||
        !["translation", "rotation", "scale", "weights"].includes(target.path)
      )
        fail("Invalid animation channel sampler/target reference");
      const input = accessors[sampler.input],
        output = accessors[sampler.output],
        factor = sampler.interpolation === "CUBICSPLINE" ? 3 : 1;
      const type =
        target.path === "rotation"
          ? "VEC4"
          : target.path === "weights"
            ? "SCALAR"
            : "VEC3";
      let multiplier = 1;
      if (target.path === "weights") {
        const mesh = meshes[nodes[target.node].mesh];
        multiplier = meshMorphCounts[nodes[target.node].mesh];
        if (!mesh || !multiplier || multiplier < 0)
          fail("Animation weights target has no consistent morph targets");
      }
      if (
        output.type !== type ||
        output.count !== input.count * factor * multiplier
      )
        fail("Animation output accessor type/count mismatch");
    }
  }
  let textureBytes = 0;
  const textureImages = [],
    imageHashes = new Map();
  for (const [index, image] of (doc.images ?? []).entries()) {
    if (image.uri || !views[image.bufferView])
      fail("External or invalid texture image");
    const view = views[image.bufferView],
      imageBytes = bytes.subarray(
        binOffset + (view.byteOffset ?? 0),
        binOffset + (view.byteOffset ?? 0) + view.byteLength,
      );
    textureBytes += view.byteLength;
    const imageKey = [view.byteOffset ?? 0, view.byteLength].join(":");
    let digest = imageHashes.get(imageKey);
    if (digest === undefined) {
      budget.reserve("maxHashBytes", view.byteLength);
      digest = createHash("sha256").update(imageBytes).digest("hex");
      imageHashes.set(imageKey, digest);
    }
    textureImages.push({
      name: image.name ?? `image-${index}`,
      bytes: view.byteLength,
      sha256: digest,
    });
  }
  return {
    vertices,
    triangles,
    joints: jointIndices.size,
    textureBytes,
    textureImages,
    meshNodeNames,
    meshNodeTriangleCounts,
    explicitBodySurfaceNodes: bodyNodes,
    morphTargets: [...morphTargets].sort(),
    bones: [...joints].sort(),
    animationClips: (doc.animations ?? []).map(
      (a, i) => a.name ?? `animation:${i}`,
    ),
    materials: (doc.materials ?? []).map((m, i) => m.name ?? `material:${i}`),
    semanticsVerified: false,
    visualVerified: false,
    licenseVerified: false,
    coordinateSemanticsVerified: false,
  };
}
