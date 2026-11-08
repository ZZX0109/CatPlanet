import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  createAccessorReaders,
  inspectGlb,
} from "../contracts/glb-inspector.mjs";
import { createFixtureGlb, DEFAULT_PARAMETERS } from "../fixture.mjs";

const floats = (numbers) => {
  const bytes = Buffer.alloc(numbers.length * 4);
  numbers.forEach((n, i) => bytes.writeFloatLE(n, i * 4));
  return bytes;
};
function packedDocument(doc, chunks) {
  let length = 0;
  doc.bufferViews = chunks.map(({ bytes, ...view }) => {
    const v = {
      buffer: 0,
      byteOffset: length,
      byteLength: bytes.length,
      ...view,
    };
    length += Math.ceil(bytes.length / 4) * 4;
    return v;
  });
  const bin = Buffer.concat(
    chunks.flatMap(({ bytes }) => [
      bytes,
      Buffer.alloc((4 - (bytes.length % 4)) % 4),
    ]),
  );
  doc.buffers = [{ byteLength: bin.length }];
  return { doc, bin };
}
function glb(doc, bin) {
  let json = Buffer.from(JSON.stringify(doc));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 32)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + json.length + bin.length, 8);
  header.writeUInt32LE(json.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, json, bh, bin]);
}
function sourceFixture() {
  const bytes = createFixtureGlb(DEFAULT_PARAMETERS),
    len = bytes.readUInt32LE(12);
  return {
    doc: JSON.parse(bytes.subarray(20, 20 + len)),
    bin: Buffer.from(bytes.subarray(28 + len)),
  };
}
function appendViews(source, chunks) {
  let offset = source.bin.length;
  const buffers = [source.bin];
  for (const chunk of chunks) {
    source.doc.bufferViews.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: chunk.length,
    });
    buffers.push(chunk, Buffer.alloc((4 - (chunk.length % 4)) % 4));
    offset += Math.ceil(chunk.length / 4) * 4;
  }
  source.bin = Buffer.concat(buffers);
  source.doc.buffers[0].byteLength = source.bin.length;
  return source;
}
function sparseFixture({
  base = false,
  indexType = 5121,
  indices = [1],
  values = [4, 5, 6],
  count = 3,
} = {}) {
  const sizes = { 5121: 1, 5123: 2, 5125: 4 },
    indexBytes = Buffer.alloc(indices.length * sizes[indexType]);
  indices.forEach((n, i) => {
    if (indexType === 5121) indexBytes.writeUInt8(n, i);
    else if (indexType === 5123) indexBytes.writeUInt16LE(n, i * 2);
    else indexBytes.writeUInt32LE(n, i * 4);
  });
  const chunks = [],
    accessor = { componentType: 5126, count, type: "VEC3" };
  if (base) {
    accessor.bufferView = 0;
    chunks.push({
      bytes: floats(Array.from({ length: count * 3 }, (_, i) => i + 10)),
    });
  }
  accessor.sparse = {
    count: indices.length,
    indices: { bufferView: chunks.length, componentType: indexType },
    values: { bufferView: chunks.length + 1 },
  };
  chunks.push({ bytes: indexBytes }, { bytes: floats(values) });
  return packedDocument({ accessors: [accessor] }, chunks);
}

test("sparse zero initialization decodes UBYTE, USHORT and UINT indices without dense expansion", () => {
  for (const indexType of [5121, 5123, 5125]) {
    const { doc, bin } = sparseFixture({
      indexType,
      indices: [0, 2],
      values: [1, 2, 3, 7, 8, 9],
    });
    const [a] = createAccessorReaders(doc, bin);
    assert.deepEqual(
      Array.from({ length: 3 }, (_, i) =>
        Array.from({ length: 3 }, (_, c) => a.read(i, c)),
      ),
      [
        [1, 2, 3],
        [0, 0, 0],
        [7, 8, 9],
      ],
    );
    assert.equal(a.hasBaseBufferView, false);
    assert.equal(a.sparseCount, 2);
  }
});
test("dense base data is overlaid while unchanged elements and interleaved strides survive", () => {
  const { doc, bin } = sparseFixture({
    base: true,
    indices: [1],
    values: [1, 2, 3],
  });
  const [a] = createAccessorReaders(doc, bin);
  assert.deepEqual([a.read(0, 0), a.read(1, 0), a.read(2, 2)], [10, 1, 18]);
  const interleaved = packedDocument(
    {
      accessors: [
        {
          bufferView: 0,
          byteOffset: 4,
          componentType: 5126,
          type: "VEC3",
          count: 2,
        },
      ],
    },
    [{ bytes: floats([99, 1, 2, 3, 99, 4, 5, 6]), byteStride: 16 }],
  );
  const [r] = createAccessorReaders(interleaved.doc, interleaved.bin);
  assert.deepEqual([r.read(0, 2), r.read(1, 0)], [3, 4]);
});
test("absent base without sparse is legal implicit zero, including huge counts with bounded stored iteration", () => {
  const [a] = createAccessorReaders(
    { accessors: [{ componentType: 5126, type: "VEC3", count: 0xffffffff }] },
    Buffer.alloc(0),
  );
  assert.equal(a.read(0xffffffff - 1, 2), 0);
  let seen = 0;
  a.forEachStoredValue(() => seen++);
  assert.equal(seen, 0);
  assert.throws(() => a.read(0xffffffff), /range/);
});
test("supported scalar/vector component types retain raw signed and unsigned values", () => {
  const specs = [
    [5120, Buffer.from([255]), -1],
    [5121, Buffer.from([255]), 255],
    [5122, Buffer.from([255, 255]), -1],
    [5123, Buffer.from([255, 255]), 65535],
    [5125, Buffer.from([255, 255, 255, 255]), 0xffffffff],
    [5126, floats([0.25]), 0.25],
  ];
  for (const [componentType, bytes, value] of specs) {
    const { doc, bin } = packedDocument(
      {
        accessors: [{ bufferView: 0, componentType, type: "SCALAR", count: 1 }],
      },
      [{ bytes }],
    );
    assert.equal(createAccessorReaders(doc, bin)[0].read(0), value);
  }
});
test("matrix byte/short column padding and optional final padding are decoded legally", () => {
  for (const [type, size, rows] of [
    ["MAT2", 1, 2],
    ["MAT3", 1, 3],
    ["MAT3", 2, 3],
  ]) {
    const columnStride = Math.ceil((rows * size) / 4) * 4,
      extent = (rows - 1) * columnStride + rows * size,
      bytes = Buffer.alloc(extent);
    let value = 1;
    for (let col = 0; col < rows; col++)
      for (let row = 0; row < rows; row++) {
        const at = col * columnStride + row * size;
        if (size === 1) bytes.writeUInt8(value++, at);
        else bytes.writeUInt16LE(value++, at);
      }
    const { doc, bin } = packedDocument(
      {
        accessors: [
          {
            bufferView: 0,
            componentType: size === 1 ? 5121 : 5123,
            type,
            count: 1,
          },
        ],
      },
      [{ bytes }],
    );
    const a = createAccessorReaders(doc, bin)[0];
    assert.deepEqual(
      Array.from({ length: rows * rows }, (_, i) => a.read(0, i)),
      Array.from({ length: rows * rows }, (_, i) => i + 1),
    );
  }
  const { doc, bin } = packedDocument(
    {
      accessors: [
        {
          componentType: 5121,
          type: "MAT3",
          count: 2,
          sparse: {
            count: 1,
            indices: { bufferView: 0, componentType: 5121 },
            values: { bufferView: 1 },
          },
        },
      ],
    },
    [
      { bytes: Buffer.from([1]) },
      { bytes: Buffer.from([1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9]) },
    ],
  );
  assert.equal(createAccessorReaders(doc, bin)[0].read(1, 8), 9);
});
test("malformed sparse counts, index order/types/ranges, offsets, strides and NaN are rejected", () => {
  const badEdits = [
    (d) => (d.accessors[0].sparse.count = 0),
    (d) => (d.accessors[0].sparse.count = 4),
    (d) => (d.accessors[0].sparse.count = 1.5),
    (d) => (d.accessors[0].count = 0),
    (d) => (d.accessors[0].count = 0x100000000),
    (d) => (d.accessors[0].sparse.indices.componentType = 5126),
    (d) => (d.accessors[0].sparse.indices.bufferView = 99),
    (d) => (d.accessors[0].sparse.values.bufferView = 99),
    (d) => (d.accessors[0].sparse.values.byteOffset = 1),
    (d) => (d.accessors[0].sparse.values.byteOffset = 8),
    (d) => (d.bufferViews[1].byteLength = 8),
    (d) => (d.bufferViews[0].byteStride = 4),
    (d) => (d.bufferViews[1].target = 34962),
    (d) => (d.accessors[0].byteOffset = 0),
    (d) => (d.accessors[0].componentType = "5126"),
  ];
  for (const edit of badEdits) {
    const { doc, bin } = sparseFixture();
    edit(doc);
    assert.throws(
      () => createAccessorReaders(doc, bin),
      (e) => e.code === "GLB_INVALID",
    );
  }
  for (const indices of [
    [1, 1],
    [2, 1],
    [0, 3],
  ]) {
    const { doc, bin } = sparseFixture({ indices, values: [1, 2, 3, 4, 5, 6] });
    assert.throws(
      () => createAccessorReaders(doc, bin),
      /sorted, unique|less than/,
    );
  }
  const nan = sparseFixture({ values: [NaN, 0, 0] });
  assert.throws(() => createAccessorReaders(nan.doc, nan.bin), /Nonfinite/);
  const inf = sparseFixture({ base: true });
  inf.bin.writeFloatLE(Infinity, 0);
  assert.throws(() => createAccessorReaders(inf.doc, inf.bin), /Nonfinite/);
  const short = sparseFixture({ indexType: 5123 });
  short.doc.accessors[0].sparse.indices.byteOffset = 1;
  assert.throws(
    () => createAccessorReaders(short.doc, short.bin),
    /Misaligned/,
  );
});
test("dense accessor alignment/strides and sparse matrix alignment follow actual byte layout", () => {
  for (const edit of [
    (d) => (d.accessors[0].byteOffset = 1),
    (d) => (d.bufferViews[0].byteStride = 10),
    (d) => (d.bufferViews[0].byteStride = 256),
    (d) => (d.bufferViews[0].byteStride = 4),
  ]) {
    const source = sparseFixture({ base: true });
    edit(source.doc);
    assert.throws(() => createAccessorReaders(source.doc, source.bin));
  }
  const { doc, bin } = packedDocument(
    {
      accessors: [
        {
          componentType: 5121,
          type: "MAT2",
          count: 2,
          sparse: {
            count: 1,
            indices: { bufferView: 0, componentType: 5121 },
            values: { bufferView: 1, byteOffset: 1 },
          },
        },
      ],
    },
    [{ bytes: Buffer.from([1]) }, { bytes: Buffer.alloc(12) }],
  );
  assert.throws(() => createAccessorReaders(doc, bin), /Misaligned/);
});
test("actual primitive index checks read sparse overrides, not dense source bytes or implicit assumptions", () => {
  for (const componentType of [5121, 5123, 5125]) {
    const source = sourceFixture(),
      width = { 5121: 1, 5123: 2, 5125: 4 }[componentType],
      indexValue = Buffer.alloc(width);
    if (width === 1) indexValue.writeUInt8(255);
    else if (width === 2) indexValue.writeUInt16LE(255);
    else indexValue.writeUInt32LE(255);
    const start = source.doc.bufferViews.length;
    appendViews(source, [Buffer.from([1]), indexValue]);
    source.doc.accessors.push({
      componentType,
      count: 3,
      type: "SCALAR",
      sparse: {
        count: 1,
        indices: { bufferView: start, componentType: 5121 },
        values: { bufferView: start + 1 },
      },
    });
    source.doc.meshes[0].primitives[0].indices =
      source.doc.accessors.length - 1;
    assert.throws(
      () => inspectGlb(glb(source.doc, source.bin)),
      /Index outside/,
    );
  }
  const source = sourceFixture(),
    start = source.doc.bufferViews.length;
  appendViews(source, [
    Buffer.from([250, 250, 250]),
    Buffer.from([0, 1, 2]),
    Buffer.from([0, 1, 2]),
  ]);
  source.doc.accessors.push({
    bufferView: start,
    componentType: 5121,
    count: 3,
    type: "SCALAR",
    sparse: {
      count: 3,
      indices: { bufferView: start + 1, componentType: 5121 },
      values: { bufferView: start + 2 },
    },
  });
  source.doc.meshes[0].primitives[0].indices = source.doc.accessors.length - 1;
  assert.equal(inspectGlb(glb(source.doc, source.bin)).triangles, 1);
});
test("animation times read sparse/all-zero accessors; implicit huge repeated zeros fail promptly", () => {
  const source = sourceFixture(),
    start = source.doc.bufferViews.length;
  appendViews(source, [
    Buffer.from([1]),
    floats([1]),
    floats([0, 0, 0, 1, 2, 3]),
  ]);
  source.doc.accessors.push(
    {
      componentType: 5126,
      type: "SCALAR",
      count: 2,
      sparse: {
        count: 1,
        indices: { bufferView: start, componentType: 5121 },
        values: { bufferView: start + 1 },
      },
    },
    { componentType: 5126, type: "VEC3", count: 2, bufferView: start + 2 },
  );
  source.doc.animations = [
    {
      samplers: [{ input: 2, output: 3 }],
      channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
    },
  ];
  assert.equal(
    inspectGlb(glb(source.doc, source.bin)).animationClips.length,
    1,
  );
  source.doc.accessors[2].sparse = undefined;
  source.doc.accessors[2].count = 0xffffffff;
  assert.throws(
    () => inspectGlb(glb(source.doc, source.bin)),
    /strictly increasing/,
  );
});
test("the real compactor produces legal sparse and all-zero morph storage in an isolated fake repository", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cat-real-compactor-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "public/models/creator"), { recursive: true });
  fs.copyFileSync(
    fileURLToPath(
      new URL("../../scripts/compact-creator-glb.mjs", import.meta.url),
    ),
    path.join(root, "scripts/compact-creator-glb.mjs"),
  );
  const source = sourceFixture(),
    start = source.doc.bufferViews.length,
    delta = Buffer.alloc(36 * 12),
    zero = Buffer.alloc(36 * 12);
  delta.writeFloatLE(0.125, 7 * 12);
  delta.writeFloatLE(-0.5, 7 * 12 + 8);
  appendViews(source, [delta, zero]);
  source.doc.accessors.push(
    { componentType: 5126, type: "VEC3", count: 36, bufferView: start },
    { componentType: 5126, type: "VEC3", count: 36, bufferView: start + 1 },
  );
  source.doc.meshes[0].primitives[0].targets = [
    { POSITION: 2 },
    { POSITION: 3 },
  ];
  source.doc.meshes[0].extras = { targetNames: ["SparseTest", "ZeroTest"] };
  const filename = path.join(root, "public/models/creator/norwegian-cat.glb");
  fs.writeFileSync(filename, glb(source.doc, source.bin));
  fs.writeFileSync(
    path.join(root, "public/models/creator/norwegian-manifest.json"),
    "{}",
  );
  const { compactCreatorGlb } = await import(
    pathToFileURL(path.join(root, "scripts/compact-creator-glb.mjs")).href
  );
  const report = await compactCreatorGlb("norwegian");
  assert.equal(report.changedAccessors, 2);
  assert(report.savedBytes > 0);
  const compact = fs.readFileSync(filename),
    jsonLength = compact.readUInt32LE(12),
    doc = JSON.parse(compact.subarray(20, 20 + jsonLength)),
    bin = compact.subarray(28 + jsonLength);
  assert.equal(doc.accessors[2].bufferView, undefined);
  assert.equal(doc.accessors[2].sparse.count, 1);
  assert.equal(doc.accessors[3].bufferView, undefined);
  assert.equal(doc.accessors[3].sparse, undefined);
  const readers = createAccessorReaders(doc, bin);
  assert.equal(readers[2].read(7, 0), 0.125);
  assert.equal(readers[2].read(7, 2), -0.5);
  assert.equal(readers[2].read(0, 0), 0);
  assert.equal(readers[3].read(35, 2), 0);
  assert.deepEqual(inspectGlb(compact).morphTargets, [
    "SparseTest",
    "ZeroTest",
  ]);
});

test("cumulative descriptor and scalar-read limits reject expensive inputs before scans", () => {
  const source = packedDocument(
    {
      accessors: [
        { bufferView: 0, componentType: 5126, type: "SCALAR", count: 4 },
        {
          bufferView: 0,
          byteOffset: 16,
          componentType: 5126,
          type: "SCALAR",
          count: 4,
        },
      ],
    },
    [{ bytes: floats([0, 1, 2, 3, 4, 5, 6, 7]) }],
  );
  assert.throws(
    () =>
      createAccessorReaders(source.doc, source.bin, {
        limits: { maxScalarReads: 7 },
      }),
    (e) => e.code === "GLB_RESOURCE_LIMIT",
  );
  assert.throws(
    () =>
      createAccessorReaders(source.doc, source.bin, {
        limits: { maxDescriptors: 2 },
      }),
    (e) => e.code === "GLB_RESOURCE_LIMIT",
  );
  const [zero] = createAccessorReaders(
    { accessors: [{ count: 0xffffffff, type: "SCALAR", componentType: 5126 }] },
    Buffer.alloc(0),
    { limits: { maxScalarReads: 2 } },
  );
  assert.equal(zero.read(100), 0);
  assert.equal(zero.read(101), 0);
  assert.throws(
    () => zero.read(102),
    (e) => e.code === "GLB_RESOURCE_LIMIT",
  );
  assert.throws(
    () =>
      inspectGlb(createFixtureGlb(DEFAULT_PARAMETERS), {
        limits: { maxFileBytes: 20 },
      }),
    (e) => e.code === "GLB_RESOURCE_LIMIT",
  );
  assert.throws(
    () =>
      inspectGlb(createFixtureGlb(DEFAULT_PARAMETERS), {
        limits: { maxJsonBytes: 20 },
      }),
    (e) => e.code === "GLB_RESOURCE_LIMIT",
  );
  assert.throws(
    () =>
      createAccessorReaders({ accessors: [] }, Buffer.alloc(0), {
        limits: { maxDescriptors: 9999999 },
      }),
    (e) => e.code === "GLB_INVALID",
  );
});
test("identical physical float and sparse-index validation ranges are memoized", () => {
  const dense = packedDocument(
    {
      accessors: Array.from({ length: 100 }, () => ({
        bufferView: 0,
        componentType: 5126,
        type: "SCALAR",
        count: 4,
      })),
    },
    [{ bytes: floats([0, 1, 2, 3]) }],
  );
  assert.equal(
    createAccessorReaders(dense.doc, dense.bin, {
      limits: { maxScalarReads: 4 },
    }).length,
    100,
  );
  const sparse = sparseFixture();
  sparse.doc.accessors = Array.from({ length: 100 }, () =>
    structuredClone(sparse.doc.accessors[0]),
  );
  assert.equal(
    createAccessorReaders(sparse.doc, sparse.bin, {
      limits: { maxScalarReads: 4 },
    }).length,
    100,
  );
});
test("dense+sparse stored iteration merges in linear work without per-element sparse searches", () => {
  const source = sparseFixture({ base: true, indices: [1], values: [4, 5, 6] });
  const [a] = createAccessorReaders(source.doc, source.bin, {
    limits: { maxScalarReads: 23 },
  });
  const actual = [];
  a.forEachStoredValue((v, i, c) => actual.push([v, i, c]));
  assert.equal(actual.length, 9);
  assert.deepEqual(
    actual.filter(([, i]) => i === 1).map(([v]) => v),
    [4, 5, 6],
  );
});
test("duplicate primitive index scans reuse validated storage ranges across accessor aliases", () => {
  const source = sourceFixture(),
    start = source.doc.bufferViews.length;
  appendViews(source, [Buffer.from(Array.from({ length: 36 }, (_, i) => i))]);
  const primitive = source.doc.meshes[0].primitives[0];
  source.doc.meshes[0].primitives = Array.from({ length: 100 }, (_, i) => {
    source.doc.accessors.push({
      bufferView: start,
      componentType: 5121,
      type: "SCALAR",
      count: 36,
    });
    return { ...primitive, indices: 2 + i };
  });
  // 216 physical float reads + one 36-index scan, independent of primitive aliases.
  assert.equal(
    inspectGlb(glb(source.doc, source.bin), { limits: { maxScalarReads: 252 } })
      .triangles,
    1200,
  );
});
test("deep legal node chains use iterative traversal and cycles/descriptor excess stay controlled", () => {
  const source = sourceFixture();
  source.doc.nodes = Array.from({ length: 20000 }, (_, i) => ({
    name: i === 0 ? "bodySurface" : `node-${i}`,
    ...(i === 0 ? { mesh: 0 } : {}),
    ...(i < 19999 ? { children: [i + 1] } : {}),
  }));
  source.doc.scenes = [{ nodes: [0] }];
  const bytes = glb(source.doc, source.bin);
  assert.equal(inspectGlb(bytes).meshNodeNames[0], "bodySurface");
  assert.throws(
    () => inspectGlb(bytes, { limits: { maxDescriptors: 100 } }),
    (e) => e.code === "GLB_RESOURCE_LIMIT",
  );
  source.doc.nodes[19999].children = [0];
  assert.throws(
    () => inspectGlb(glb(source.doc, source.bin)),
    (e) => e.code === "GLB_INVALID" && /cycle/.test(e.message),
  );
});
test("normalized primitive indices and malformed inverse bind matrices fail structurally", () => {
  const source = sourceFixture(),
    start = source.doc.bufferViews.length;
  appendViews(source, [Buffer.from([0, 1, 2])]);
  source.doc.accessors.push({
    bufferView: start,
    componentType: 5121,
    type: "SCALAR",
    count: 3,
    normalized: true,
  });
  source.doc.meshes[0].primitives[0].indices = 2;
  assert.throws(
    () => inspectGlb(glb(source.doc, source.bin)),
    /must not be normalized/,
  );
  source.doc.accessors[2].normalized = false;
  source.doc.skins = [{ joints: [1], inverseBindMatrices: 999 }];
  assert.throws(
    () => inspectGlb(glb(source.doc, source.bin)),
    /inverseBindMatrices/,
  );
  source.doc.skins[0].inverseBindMatrices = 0;
  assert.throws(
    () => inspectGlb(glb(source.doc, source.bin)),
    /inverseBindMatrices/,
  );
});
test("identical image ranges hash once and cumulative distinct image bytes are bounded", () => {
  const source = sourceFixture();
  source.doc.images = [{ bufferView: 0 }, { bufferView: 0 }, { bufferView: 0 }];
  const length = source.doc.bufferViews[0].byteLength;
  const info = inspectGlb(glb(source.doc, source.bin), {
    limits: { maxHashBytes: length },
  });
  assert.equal(info.textureImages.length, 3);
  assert.equal(new Set(info.textureImages.map((v) => v.sha256)).size, 1);
  source.doc.images.push({ bufferView: 1 });
  assert.throws(
    () =>
      inspectGlb(glb(source.doc, source.bin), {
        limits: { maxHashBytes: length },
      }),
    (e) => e.code === "GLB_RESOURCE_LIMIT",
  );
});
