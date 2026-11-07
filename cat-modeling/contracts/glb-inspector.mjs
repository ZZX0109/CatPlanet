/** Structural/resource inspection only. This is not a visual, rig-semantic or license acceptance. */
import { createHash } from "node:crypto";
export function inspectGlb(bytes) {
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
  const uint = (v) => Number.isSafeInteger(v) && v >= 0;
  for (const v of views)
    if (
      v.buffer !== 0 ||
      !uint(v.byteOffset ?? 0) ||
      !uint(v.byteLength) ||
      (v.byteOffset ?? 0) + v.byteLength > doc.buffers[0].byteLength
    )
      fail("Out of bounds bufferView");
  const componentBytes = {
      5120: 1,
      5121: 1,
      5122: 2,
      5123: 2,
      5125: 4,
      5126: 4,
    },
    components = {
      SCALAR: 1,
      VEC2: 2,
      VEC3: 3,
      VEC4: 4,
      MAT2: 4,
      MAT3: 9,
      MAT4: 16,
    };
  for (const a of accessors) {
    const view = views[a.bufferView],
      size = componentBytes[a.componentType] * components[a.type],
      stride = view?.byteStride ?? size;
    if (
      !view ||
      a.sparse ||
      !uint(a.count) ||
      a.count < 1 ||
      !size ||
      !uint(a.byteOffset ?? 0) ||
      !uint(stride) ||
      stride < size ||
      (a.count ? (a.count - 1) * stride + size : 0) + (a.byteOffset ?? 0) >
        view.byteLength
    )
      fail("Invalid accessor range or unsupported sparse accessor");
    if (a.componentType === 5126) {
      for (let i = 0; i < a.count; i++)
        for (let c = 0; c < components[a.type]; c++)
          if (
            !Number.isFinite(
              bytes.readFloatLE(
                binOffset +
                  (view.byteOffset ?? 0) +
                  (a.byteOffset ?? 0) +
                  i * stride +
                  c * 4,
              ),
            )
          )
            fail("Nonfinite floating-point accessor");
    }
  }
  let vertices = 0,
    triangles = 0;
  const morphTargets = new Set(),
    bodyNodes = [],
    meshNodeNames = [];
  const primitiveInfo = [],
    meshNodeTriangleCounts = {};
  for (const mesh of meshes) {
    if (!Array.isArray(mesh.primitives)) fail("Mesh has no primitives");
    for (const p of mesh.primitives) {
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
        const iv = views[ia.bufferView],
          size = componentBytes[ia.componentType];
        for (let i = 0; i < ia.count; i++) {
          const at =
            binOffset +
            (iv.byteOffset ?? 0) +
            (ia.byteOffset ?? 0) +
            i * (iv.byteStride ?? size);
          const value =
            size === 1
              ? bytes.readUInt8(at)
              : size === 2
                ? bytes.readUInt16LE(at)
                : bytes.readUInt32LE(at);
          if (value >= pos.count) fail("Index outside POSITION range");
        }
      }
      if ((p.mode ?? 4) !== 4)
        fail("Only triangle primitives currently supported");
      if (count % 3) fail("Triangle count is not integral");
      triangles += count / 3;
      const targets = p.targets ?? [];
      if (!Array.isArray(targets)) fail("Invalid morph targets");
      if (
        mesh.extras?.targetNames &&
        mesh.extras.targetNames.length !== targets.length
      )
        fail("Morph target names/count mismatch");
      targets.forEach((t, i) => {
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
  }
  for (const [i, n] of nodes.entries()) {
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
      meshNodeTriangleCounts[n.name ?? `node:${i}`] = meshes[
        n.mesh
      ].primitives.reduce(
        (sum, p) =>
          sum +
          (p.indices === undefined
            ? accessors[p.attributes.POSITION].count
            : accessors[p.indices].count) /
            3,
        0,
      );
    }
    if (
      n.name === "bodySurface" ||
      n.extras?.role === "bodySurface" ||
      n.extras?.bodySurface === true
    )
      bodyNodes.push(n.name ?? `node:${i}`);
    for (const c of n.children ?? []) if (!nodes[c]) fail("Invalid child node");
  }
  const parents = new Map(),
    active = new Set(),
    visited = new Set();
  for (const [i, n] of nodes.entries())
    for (const c of n.children ?? []) {
      if (parents.has(c)) fail("Node has multiple parents");
      parents.set(c, i);
    }
  function visit(i) {
    if (active.has(i)) fail("Node cycle");
    if (visited.has(i)) return;
    active.add(i);
    for (const c of nodes[i].children ?? []) visit(c);
    active.delete(i);
    visited.add(i);
  }
  for (let i = 0; i < nodes.length; i++) visit(i);
  const joints = new Set(),
    jointIndices = new Set();
  for (const s of doc.skins ?? []) {
    if (!Array.isArray(s.joints)) fail("Invalid skin joints");
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
      const view = views[input.bufferView];
      let previous = -Infinity;
      for (let i = 0; i < input.count; i++) {
        const time = bytes.readFloatLE(
          binOffset +
            (view.byteOffset ?? 0) +
            (input.byteOffset ?? 0) +
            i * (view.byteStride ?? 4),
        );
        if (time < 0 || time <= previous)
          fail("Animation times must be nonnegative and strictly increasing");
        previous = time;
      }
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
        multiplier = mesh?.primitives?.[0]?.targets?.length ?? 0;
        if (
          !multiplier ||
          mesh.primitives.some((p) => (p.targets?.length ?? 0) !== multiplier)
        )
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
  const textureImages = [];
  for (const [index, image] of (doc.images ?? []).entries()) {
    if (image.uri || !views[image.bufferView])
      fail("External or invalid texture image");
    const view = views[image.bufferView],
      imageBytes = bytes.subarray(
        binOffset + (view.byteOffset ?? 0),
        binOffset + (view.byteOffset ?? 0) + view.byteLength,
      );
    textureBytes += view.byteLength;
    textureImages.push({
      name: image.name ?? `image-${index}`,
      bytes: view.byteLength,
      sha256: createHash("sha256").update(imageBytes).digest("hex"),
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
