/** Lossless standard glTF sparse morph storage. No external decoder required. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const aligned = (value) => (value + 3) & ~3;

export async function compactCreatorGlb(base) {
  if (!["norwegian", "sphynx"].includes(base))
    throw new Error("Unknown authored foundation.");
  const filename = path.join(root, `public/models/creator/${base}-cat.glb`);
  const original = await fs.readFile(filename);
  if (
    original.readUInt32LE(0) !== 0x46546c67 ||
    original.readUInt32LE(4) !== 2 ||
    original.readUInt32LE(8) !== original.length
  )
    throw new Error("Incomplete GLB.");
  const jsonLength = original.readUInt32LE(12);
  const json = JSON.parse(original.subarray(20, 20 + jsonLength).toString());
  const bin = original.subarray(28 + jsonLength);
  if (
    json.buffers.length !== 1 ||
    json.extensionsRequired?.some((name) => /draco|meshopt/i.test(name))
  )
    throw new Error("Expected a single uncompressed geometry buffer.");
  const views = json.bufferViews;
  const chunks = views.map((view) =>
    Buffer.from(
      bin.subarray(
        view.byteOffset || 0,
        (view.byteOffset || 0) + view.byteLength,
      ),
    ),
  );
  const targets = new Set();
  json.meshes.forEach((mesh) =>
    mesh.primitives.forEach((primitive) =>
      (primitive.targets || []).forEach((target) =>
        Object.values(target).forEach((id) => targets.add(id)),
      ),
    ),
  );
  const indexBytes = { 5121: 1, 5123: 2, 5125: 4 };
  const readIndex = (bytes, offset, type) =>
    type === 5121
      ? bytes.readUInt8(offset)
      : type === 5123
        ? bytes.readUInt16LE(offset)
        : bytes.readUInt32LE(offset);
  const dense = (accessor) => {
    const result = Buffer.alloc(accessor.count * 12);
    if (accessor.bufferView !== undefined) {
      const view = views[accessor.bufferView],
        data = chunks[accessor.bufferView];
      for (let i = 0; i < accessor.count; i++)
        data.copy(
          result,
          i * 12,
          (accessor.byteOffset || 0) + i * (view.byteStride || 12),
          (accessor.byteOffset || 0) + i * (view.byteStride || 12) + 12,
        );
    }
    if (accessor.sparse) {
      const { count, indices, values } = accessor.sparse;
      for (let i = 0; i < count; i++) {
        const id = readIndex(
          chunks[indices.bufferView],
          (indices.byteOffset || 0) + i * indexBytes[indices.componentType],
          indices.componentType,
        );
        chunks[values.bufferView].copy(
          result,
          id * 12,
          (values.byteOffset || 0) + i * 12,
          (values.byteOffset || 0) + (i + 1) * 12,
        );
      }
    }
    return result;
  };
  const addView = (bytes) => {
    const id = views.length;
    views.push({ buffer: 0, byteLength: bytes.length });
    chunks.push(bytes);
    return id;
  };
  let changed = 0,
    verifiedValues = 0;
  for (const id of targets) {
    const accessor = json.accessors[id];
    if (
      accessor.componentType !== 5126 ||
      accessor.type !== "VEC3" ||
      accessor.normalized
    )
      continue;
    const before = dense(accessor),
      nonzero = [];
    for (let i = 0; i < accessor.count; i++) {
      if (
        [0, 4, 8].some(
          (axis) => (before.readUInt32LE(i * 12 + axis) & 0x7fffffff) !== 0,
        )
      )
        nonzero.push(i);
    }
    const componentType =
      accessor.count < 256 ? 5121 : accessor.count < 65536 ? 5123 : 5125;
    const width = indexBytes[componentType];
    const oldCost =
      accessor.bufferView === undefined
        ? (accessor.sparse?.count || 0) *
          (12 + (indexBytes[accessor.sparse?.indices.componentType] || 0))
        : accessor.count * 12;
    if (nonzero.length && nonzero.length * (12 + width) + 160 >= oldCost)
      continue;
    delete accessor.bufferView;
    delete accessor.byteOffset;
    delete accessor.sparse;
    if (nonzero.length) {
      const indices = Buffer.alloc(nonzero.length * width),
        values = Buffer.alloc(nonzero.length * 12);
      nonzero.forEach((vertex, i) => {
        if (width === 1) indices.writeUInt8(vertex, i);
        else if (width === 2) indices.writeUInt16LE(vertex, i * 2);
        else indices.writeUInt32LE(vertex, i * 4);
        before.copy(values, i * 12, vertex * 12, (vertex + 1) * 12);
      });
      accessor.sparse = {
        count: nonzero.length,
        indices: { bufferView: addView(indices), componentType },
        values: { bufferView: addView(values) },
      };
    }
    const after = dense(accessor);
    for (let i = 0; i < before.length; i += 4) {
      if (
        !Number.isFinite(before.readFloatLE(i)) ||
        before.readFloatLE(i) !== after.readFloatLE(i)
      )
        throw new Error(`Morph accessor ${id} changed values.`);
      verifiedValues++;
    }
    changed++;
  }
  // Keep every referenced view, including encoded images and sparse data.
  const referenced = new Set();
  const visit = (node, callback) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "bufferView" && typeof value === "number")
        callback(node, key, value);
      else visit(value, callback);
    }
  };
  visit(json, (_node, _key, id) => referenced.add(id));
  const remap = new Map(),
    packedViews = [],
    packedChunks = [];
  let length = 0;
  for (const id of [...referenced].sort((a, b) => a - b)) {
    remap.set(id, packedViews.length);
    packedViews.push({
      ...views[id],
      byteOffset: length,
      byteLength: chunks[id].length,
    });
    packedChunks.push(
      chunks[id],
      Buffer.alloc(aligned(chunks[id].length) - chunks[id].length),
    );
    length += aligned(chunks[id].length);
  }
  visit(json, (node, key, id) => {
    node[key] = remap.get(id);
  });
  json.bufferViews = packedViews;
  json.buffers[0].byteLength = length;
  const rawJson = Buffer.from(JSON.stringify(json));
  const jsonBytes = Buffer.alloc(aligned(rawJson.length), 0x20);
  rawJson.copy(jsonBytes);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + jsonBytes.length + length, 8);
  header.writeUInt32LE(jsonBytes.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(length);
  binHeader.writeUInt32LE(0x004e4942, 4);
  const packed = Buffer.concat([header, jsonBytes, binHeader, ...packedChunks]);
  const output = packed.length < original.length ? packed : original;
  const folder = path.join(
    root,
    "artifacts/table-refinement/asset-compression",
  );
  await fs.mkdir(folder, { recursive: true });
  const report = {
    base,
    beforeBytes: original.length,
    afterBytes: output.length,
    savedBytes: original.length - output.length,
    changedAccessors: changed,
    verifiedFloatValues: verifiedValues,
    originalSha256: hash(original),
    outputSha256: hash(output),
    method:
      "Standard glTF sparse morph accessors; original finite float values exactly preserved; no texture re-encoding",
  };
  if (output !== original) {
    await fs.writeFile(path.join(folder, `${base}.unpacked.glb`), original);
    await fs.writeFile(`${filename}.compact.tmp`, output);
    await fs.rename(`${filename}.compact.tmp`, filename);
  }
  const compressed = gzipSync(output, { level: 9 });
  if (hash(gunzipSync(compressed)) !== hash(output))
    throw new Error("Compressed model failed exact reconstruction.");
  await fs.writeFile(`${filename}.gz.tmp`, compressed);
  await fs.rename(`${filename}.gz.tmp`, `${filename}.gz`);
  report.gzipBytes = compressed.length;
  report.gzipSha256 = hash(compressed);
  report.transferReduction = 1 - compressed.length / output.length;
  const manifestPath = path.join(
    root,
    `public/models/creator/${base}-manifest.json`,
  );
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.outputSha256 = report.outputSha256;
  manifest.storageOptimization = report;
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  await fs.writeFile(
    path.join(folder, `${base}.json`),
    JSON.stringify(report, null, 2) + "\n",
  );
  return report;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  for (const base of args.length ? args : ["norwegian", "sphynx"])
    console.log(JSON.stringify(await compactCreatorGlb(base)));
}
