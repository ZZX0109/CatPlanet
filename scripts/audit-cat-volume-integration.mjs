/** One actual-cat CPU integration audit: fields, pose/LOD and portable export. */
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { loadArchivedGroom } from "./cat-groom-audit-runtime.mjs";
const dir = process.argv[2] ?? "artifacts/fur-volume/round-02/integration";
await fs.mkdir(dir, { recursive: true });
const bundled = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "ts",
    contents: `import * as THREE from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {ownCreatorModel,applyCreatorDesign,cloneCreatorForExport,disposeCreatorExport}from'./lib/cat-creator-model';import {defaultCreatorDesign}from'./lib/cat-creator-design';import {getCatCoatProfile}from'./lib/cat-coat-profiles';import {createNorwegianFur}from'./lib/norwegian-fur';window.__filterAuditTools={THREE,GLTFLoader,ownCreatorModel,applyCreatorDesign,cloneCreatorForExport,disposeCreatorExport,defaultCreatorDesign,getCatCoatProfile,createNorwegianFur};`,
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
});
const probe = dir + "/probe.js";
await fs.writeFile(probe, bundled.outputFiles[0].text);
const runtime = await loadArchivedGroom(probe, {
  transformBundle(s) {
    const needle = "    volume = createCatFurVolume({";
    if (!s.includes(needle)) throw Error("ensureVolume structure changed");
    return s
      .replace(
        needle,
        "    globalThis.__volumeFieldCapture={fields,masks};\n" + needle,
      )
      .replace(
        "globalThis.__groomAuditState = {regions,evaluated,normals};",
        "globalThis.__groomAuditState = {regions,evaluated,normals,membership,volumeReferenceNormals};",
      );
  },
});
const { api, model, fur, state } = runtime;
const hash = (a) =>
  createHash("sha256")
    .update(Buffer.from(a.buffer, a.byteOffset, a.byteLength))
    .digest("hex");
const distribution = (v) => {
  if (!v.length) return null;
  v.sort((a, b) => a - b);
  const at = (p) => v[Math.floor((v.length - 1) * p)];
  return {
    count: v.length,
    min: at(0),
    median: at(0.5),
    p95: at(0.95),
    max: at(1),
  };
};
const checks = [];
const check = (name, pass, details) => {
  checks.push({ name, pass: !!pass, details });
};
const designFor = (coat) => ({
  ...api.defaultCreatorDesign,
  coatType: coat,
  coatMode: "groom",
  shape: {
    ...api.defaultCreatorDesign.shape,
    ...api.getCatCoatProfile(coat).defaults,
  },
});
const exportHashes = (snapshot) => {
  const a = [];
  snapshot.traverse((n) => {
    if (n.isMesh && n.userData.norwegianFur)
      a.push({
        name: n.name,
        volume: !!n.userData.volumePreviewOnly,
        attrs: Object.keys(n.geometry.attributes),
        positions: hash(n.geometry.attributes.position.array),
        indices: hash(n.geometry.index.array),
      });
  });
  return a.sort((a, b) => a.name.localeCompare(b.name));
};
const volumeInfo = () =>
  fur.meshes
    .filter((m) => m.userData.furVolumeRegion)
    .map((m) => ({
      name: m.name,
      visible: m.visible,
      layers: m.userData.volumeLayerCount ?? 0,
      fins: !!m.userData.volumeFins,
      segments: m.userData.volumeFinSegments ?? 0,
      invalid: Object.values(m.geometry.attributes).reduce(
        (n, a) =>
          n + Array.from(a.array).filter((v) => !Number.isFinite(v)).length,
        0,
      ),
    }));
model.motion.setBreathing(false);
model.motion.setIdleBlink(false);
const report = {
  capturedAt: new Date().toISOString(),
  probe,
  bundleSha256: runtime.bundleSha256,
  assetSha256: runtime.glbSha256,
  checks,
};
try {
  const design = designFor("long");
  api.applyCreatorDesign(model, design);
  fur.refresh({ full: true });
  check("default volume is absent/off", fur.volumeInfo().length === 0);
  fur.setVolume(true);
  fur.setDetail(1);
  fur.refresh({ full: true });
  report.fieldCounts = globalThis.__volumeFieldCapture.fields.counts;
  report.maskedHoles = Object.fromEntries(
    ["body", "ruff"].map((name) => {
      const mask = globalThis.__volumeFieldCapture.masks[name],
        field = globalThis.__volumeFieldCapture.fields.envelope[name];
      let masked = 0,
        zero = 0;
      for (let i = 0; i < mask.length; i++)
        if (mask[i] > 0.001) {
          masked++;
          if (field[i] <= 0) zero++;
        }
      return [name, { masked, zero }];
    }),
  );
  check(
    "body active16 and ruff inactive",
    volumeInfo().find((m) => m.name === "FurVolume_body").layers === 16 &&
      volumeInfo().find((m) => m.name === "FurVolume_body").visible &&
      !volumeInfo().find((m) => m.name === "FurVolume_ruff").visible,
    volumeInfo(),
  );
  check(
    "masked field vertices have envelopes",
    Object.values(report.maskedHoles).every((v) => v.zero === 0),
    report.maskedHoles,
  );
  const discrepancies = { body: [], ruff: [] };
  const groom = api.getCatCoatProfile("long").groom;
  for (const region of state.regions) {
    if (region.name === "head") continue;
    for (let i = 0; i < region.roots.length; i++) {
      const r = region.roots[i];
      if (r.hairKind !== "down" || r.kind !== 0 || r.trunkWeight < 0.001)
        continue;
      const n = [0, 0, 0];
      for (let a = 0; a < 3; a++)
        n[a] =
          state.volumeReferenceNormals[r.a * 3 + a] * r.u +
          state.volumeReferenceNormals[r.b * 3 + a] * r.v +
          state.volumeReferenceNormals[r.c * 3 + a] * r.w;
      const ny = n[1],
        unitNy = ny / Math.hypot(...n);
      const scale =
        r.longLength *
        r.flowLength *
        (region.name === "ruff" ? 0.7 : 1) *
        (0.84 + r.variation * 0.17) *
        (r.layer > 1 - groom.flyawayShare ? 1.12 : 1);
      const gain =
        r.hairLift *
        (region.name === "body"
          ? (1 - 0.2 * r.backLay) *
            (1 - r.trunkWeight * (1 - (0.4 + 0.6 * r.downDepth ** 2))) *
            r.appendageLay
          : 1);
      let approximate = 0,
        normalized = 0;
      for (const sample of region.samples) {
        let cn = 0;
        for (let k = 0; k < 4; k++)
          cn += region.longGroomCurve[i * 12 + k * 3] * sample.value[k + 1];
        approximate = Math.max(
          approximate,
          scale * (cn * gain + Math.max(0, -ny) * groom.gravity * sample.t2),
        );
        normalized = Math.max(
          normalized,
          scale *
            (cn * gain + Math.max(0, -unitNy) * groom.gravity * sample.t2),
        );
      }
      if (normalized > 0)
        discrepancies[region.name].push(
          (approximate - normalized) / normalized,
        );
    }
  }
  report.historicalUnnormalizedNyError = Object.fromEntries(
    Object.entries(discrepancies).map(([k, v]) => [k, distribution(v)]),
  );
  const liveTextures = new Set(),
    liveGeometries = new Set();
  model.scene.traverse((n) => {
    if (!n.isMesh) return;
    liveGeometries.add(n.geometry);
    for (const m of Array.isArray(n.material) ? n.material : [n.material])
      for (const v of Object.values(m)) if (v?.isTexture) liveTextures.add(v);
  });
  let textureDisposals = 0,
    geometryDisposals = 0;
  for (const t of liveTextures)
    t.addEventListener("dispose", () => textureDisposals++);
  for (const g of liveGeometries)
    g.addEventListener("dispose", () => geometryDisposals++);
  const liveShell = fur.meshes.find((m) => m.userData.undercoat),
    beforeShell = hash(liveShell.geometry.attributes.position.array),
    beforeVolume = volumeInfo();
  const on = api.cloneCreatorForExport(model, design, 0),
    onHashes = exportHashes(on);
  const expectedCurveHashes = state.regions.map((region) => {
    const count = region.mesh.userData.strandCount,
      geometry = region.mesh.geometry;
    return {
      name: region.mesh.name,
      positions: hash(
        geometry.attributes.position.array.subarray(
          0,
          count * region.strandVertices * 3,
        ),
      ),
      indices: hash(
        geometry.index.array.subarray(0, count * region.strandIndices),
      ),
    };
  });
  check(
    "ON export matches every vertex/index of the complete current ON CPU curves",
    expectedCurveHashes.every((actual) => {
      const exported = onHashes.find((m) => m.name === actual.name);
      return (
        exported?.positions === actual.positions &&
        exported?.indices === actual.indices
      );
    }),
  );
  const protectedHashes = () =>
    state.regions.map((region) => {
      const result = { name: region.name };
      for (const key of ["position", "normal", "furWidth"]) {
        const a = region.mesh.geometry.attributes[key].array;
        if (region.name !== "body") result[key] = hash(a);
        else {
          const digests = {
            limb: createHash("sha256"),
            tail: createHash("sha256"),
          };
          for (let i = 0; i < region.roots.length; i++) {
            const kind = region.roots[i].kind;
            if (kind !== 1 && kind !== 2) continue;
            const width = region.strandVertices * 3;
            digests[kind === 1 ? "limb" : "tail"].update(
              Buffer.from(
                a.buffer,
                a.byteOffset + i * width * a.BYTES_PER_ELEMENT,
                width * a.BYTES_PER_ELEMENT,
              ),
            );
          }
          result[key] = Object.fromEntries(
            Object.entries(digests).map(([k, v]) => [k, v.digest("hex")]),
          );
        }
      }
      return result;
    });
  const onProtected = protectedHashes();

  api.disposeCreatorExport(on);
  api.disposeCreatorExport(on);
  check(
    "on export contains no volume or private hair attributes",
    onHashes.every(
      (m) => !m.volume && !m.attrs.some((a) => a.startsWith("fur")),
    ),
  );
  check(
    "export restores hybrid shell and active volume",
    hash(liveShell.geometry.attributes.position.array) === beforeShell &&
      JSON.stringify(volumeInfo()) === JSON.stringify(beforeVolume),
  );
  check(
    "export cleanup leaves live geometry/textures intact",
    textureDisposals === 0 && geometryDisposals === 0,
    { textureDisposals, geometryDisposals },
  );
  fur.setVolume(false);
  const off = api.cloneCreatorForExport(model, design, 0),
    offHashes = exportHashes(off);
  api.disposeCreatorExport(off);

  check(
    "OFF restores original body ribbon width while preserving head/ruff/limb/tail",
    onHashes.find((m) => m.name === "Fur_Body").positions !==
      offHashes.find((m) => m.name === "Fur_Body").positions &&
      JSON.stringify(onProtected) === JSON.stringify(protectedHashes()),
  );

  fur.setVolume(true);
  fur.setDetail(0.25);
  fur.refresh({ full: true });
  check(
    "actual lowLOD activates8 layers",
    volumeInfo().find((m) => m.name === "FurVolume_body").layers === 8,
    volumeInfo(),
  );
  const maximum = designFor("long");
  for (const n of ["head", "ruff", "body"])
    for (const p of ["FurDensity", "FurLength"]) maximum.shape[n + p] = 100;
  model.motion.setPose("rest", true);
  model.motion.update(1, { reducedMotion: true });
  api.applyCreatorDesign(model, maximum);
  fur.refresh({ full: true });
  check(
    "maximum-length resting volume finite",
    volumeInfo().every((m) => m.invalid === 0),
    volumeInfo(),
  );
  api.applyCreatorDesign(model, designFor("short"));
  check(
    "short coat hides all volume",
    volumeInfo().every((m) => !m.visible),
  );
  report.onExport = onHashes;
  report.offExport = offHashes;
  report.pass = checks.every((c) => c.pass);
  await fs.writeFile(
    dir + "/review.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  model.dispose();
}
