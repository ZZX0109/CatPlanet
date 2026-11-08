import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseContract, schemas } from "../contracts/index.mjs";
import { executeProduction, validateFiles } from "../production.mjs";
import { inspectGlb } from "../contracts/glb-inspector.mjs";
import { createFixtureGlb, DEFAULT_PARAMETERS } from "../fixture.mjs";
import { jsonBytes, sha256 } from "../protocol.mjs";
const cli = fileURLToPath(new URL("../cli.mjs", import.meta.url));
const sample = fileURLToPath(
  new URL("../contracts/examples/request.v1.json", import.meta.url),
);
const request = () => JSON.parse(fs.readFileSync(sample, "utf8"));
function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cat-protocol-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function prepared(t) {
  const root = temp(t),
    r = request(),
    bytes = createFixtureGlb(DEFAULT_PARAMETERS);
  r.jobId = "job-test-local-edit";
  r.modelRevision = sha256(bytes);
  r.modelId = "authored-test-fixture";
  r.topologyVersion = "miaoxing-geometric-cat-v1";
  r.groom.topologyVersion = r.topologyVersion;
  r.groom.bodySurface.node = "bodySurface";
  fs.writeFileSync(path.join(root, "request.json"), jsonBytes(r));
  fs.writeFileSync(path.join(root, "model.glb"), bytes);
  return { root, r, bytes, file: path.join(root, "request.json") };
}
function mutateGlb(bytes, fn) {
  const jlen = bytes.readUInt32LE(12),
    d = JSON.parse(bytes.subarray(20, 20 + jlen)),
    bin = bytes.subarray(28 + jlen);
  fn(d);
  let json = Buffer.from(JSON.stringify(d));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 32)]);
  const h = Buffer.from(bytes.subarray(0, 12));
  h.writeUInt32LE(28 + json.length + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(json.length);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([h, jh, json, bh, bin]);
}
test("request and Python-compatible examples satisfy authoritative strict contract", () => {
  const r = parseContract("request", request());
  assert.equal(r.requestVersion, 1);
  for (const edit of [
    (v) => (v.extra = true),
    (v) => (v.coordinates.up = "+Z"),
    (v) => (v.dimensions.height = 0),
    (v) => (v.executionBudget.timeoutSeconds = 0),
    (v) => (v.executionBudget.maxGpuMemoryMiB = 1),
    (v) =>
      (v.features.landmarks = [
        {
          name: "nose",
          position: [0, 0, 0],
          source: "measured",
          confidence: 1,
        },
        {
          name: "nose",
          position: [0, 0, 0],
          source: "measured",
          confidence: 1,
        },
      ]),
    (v) => (v.appearance.shape.headRound = 101),
    (v) => (v.groom.topologyVersion = "other"),
  ]) {
    const bad = request();
    edit(bad);
    assert.throws(() => parseContract("request", bad));
  }
});
test("unauthorized references, missing model-fit references and traversal references fail closed", () => {
  const r = request();
  r.operation = "model-fit";
  assert.throws(() => parseContract("request", r), /requires/);
  const ref = {
    path: "references/pixel.png",
    sha256: "0".repeat(64),
    mediaType: "image/png",
    provenance: {
      source: "user-provided",
      creator: "test",
      evidence: "local-consent",
    },
    license: {
      status: "verified",
      identifier: "private-owner-consent",
      localReviewAllowed: true,
      trainingAllowed: false,
      publicDistributionAllowed: false,
    },
    ownerConsent: true,
  };
  r.references = [ref];
  assert.doesNotThrow(() => parseContract("request", r));
  ref.ownerConsent = false;
  assert.throws(() => parseContract("request", r));
  ref.ownerConsent = true;
  ref.license.status = "unknown";
  assert.throws(() => parseContract("request", r));
  ref.license.status = "verified";
  ref.path = "../private.png";
  assert.throws(() => parseContract("request", r));
});
test("default infer returns MODEL_UNAVAILABLE without a fake model, even if GLB exists", (t) => {
  const p = prepared(t),
    jobs = path.join(p.root, "jobs");
  const dry = executeProduction("infer", {
    request: p.file,
    inputRoot: p.root,
    root: jobs,
    dryRun: true,
  });
  assert.equal(dry.code, "MODEL_UNAVAILABLE");
  assert.equal(fs.existsSync(jobs), false);
  const run = executeProduction("infer", {
    request: p.file,
    inputRoot: p.root,
    root: jobs,
  });
  assert.equal(run.code, "MODEL_UNAVAILABLE");
  assert.equal(fs.existsSync(path.join(jobs, p.r.jobId, "model.glb")), false);
  const log = JSON.parse(
    fs.readFileSync(
      path.join(jobs, run.execution, "execution.log.jsonl"),
      "utf8",
    ),
  );
  assert.equal(log.inferenceStarted, false);
  assert.equal(log.trainingStarted, false);
  assert.equal(log.networkCalls, 0);
});
test("missing private assets never pass and dry-run is read-only", (t) => {
  const root = temp(t),
    jobs = path.join(root, "jobs");
  const r = executeProduction("validate", {
    request: sample,
    inputRoot: root,
    root: jobs,
    dryRun: true,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "PRIVATE_ASSETS_MISSING");
  assert.equal(
    r.result.checks.find((c) => c.name === "model.glb").state,
    "missing",
  );
  assert.equal(
    r.result.checks.find((c) => c.name === "visual-acceptance").state,
    "unrun",
  );
  assert.equal(fs.existsSync(jobs), false);
});
test("actual file hash, declared budget, explicit surface and groom root bounds validated", (t) => {
  const p = prepared(t);
  const good = validateFiles(p.r, { inputRoot: p.root });
  assert.equal(good.state, "valid");
  assert.equal(good.capabilities.vertices, 36);
  assert.equal(good.capabilities.coordinateSemanticsVerified, false);
  assert.doesNotThrow(() => parseContract("validation", good));
  const bad = structuredClone(p.r);
  bad.modelRevision = "0".repeat(64);
  assert.equal(validateFiles(bad, { inputRoot: p.root }).state, "failed");
  bad.modelRevision = p.r.modelRevision;
  bad.budgets.maxVertices = 10;
  assert.match(
    validateFiles(bad, { inputRoot: p.root }).errors[0].message,
    /budget/,
  );
  bad.budgets.maxVertices = p.r.budgets.maxVertices;
  bad.groom.bodySurface.node = "other";
  assert.match(
    validateFiles(bad, { inputRoot: p.root }).errors[0].message,
    /bodySurface/,
  );
});
test("reference bytes must match hash and image signature", (t) => {
  const p = prepared(t),
    reference = JSON.parse(
      fs.readFileSync(
        new URL(
          "../contracts/examples/request.model-fit.v1.json",
          import.meta.url,
        ),
      ),
    );
  p.r.references = reference.references;
  fs.mkdirSync(path.join(p.root, "references"));
  fs.writeFileSync(path.join(p.root, p.r.references[0].path), "not an image");
  assert.equal(validateFiles(p.r, { inputRoot: p.root }).state, "failed");
  p.r.references[0].sha256 = sha256("not an image");
  assert.match(
    validateFiles(p.r, { inputRoot: p.root }).errors[0].message,
    /MIME/,
  );
});
test("preview is only a local Blender handoff with exact source/script/scenario evidence requirements", (t) => {
  const p = prepared(t),
    jobs = path.join(p.root, "jobs"),
    r = executeProduction("preview", {
      request: p.file,
      inputRoot: p.root,
      root: jobs,
    });
  assert.equal(r.ok, true);
  assert.equal(r.result.handoff.invokeInCloud, false);
  assert.equal(r.result.handoff.command.shell, false);
  assert.equal(r.result.handoff.command.argvIsIllustrative, true);
  assert.equal(
    r.result.handoff.requiredLocalInputs[0].state,
    "missing-unverified",
  );
  assert.equal(
    r.result.handoff.executionBudget.timeoutSeconds,
    p.r.executionBudget.timeoutSeconds,
  );
  assert.match(r.result.handoff.script.sha256, /^[0-9a-f]{64}$/);
  assert.equal(
    fs.existsSync(path.join(jobs, r.execution, "blender-task.json")),
    true,
  );
  assert.equal(fs.existsSync(path.join(jobs, p.r.jobId, "preview.png")), false);
});
test("production publish remains unavailable and confirmed fixture staging cannot activate it", (t) => {
  const p = prepared(t);
  const r = executeProduction("publish", {
    request: p.file,
    root: path.join(p.root, "jobs"),
    dryRun: true,
    confirm: "yes",
  });
  assert.equal(r.code, "PRODUCTION_PUBLISH_UNAVAILABLE");
  assert.equal(r.result.activeModelChanged, false);
});
test("execution logs append isolated runs, reject reused job IDs and do not store reference metadata in log", (t) => {
  const p = prepared(t),
    jobs = path.join(p.root, "jobs"),
    a = executeProduction("infer", { request: p.file, root: jobs }),
    b = executeProduction("infer", { request: p.file, root: jobs });
  assert.notEqual(a.execution, b.execution);
  const log = fs.readFileSync(
    path.join(jobs, b.execution, "execution.log.jsonl"),
    "utf8",
  );
  assert.doesNotMatch(log, /reference|ownerConsent/);
  p.r.dimensions.height = 0.5;
  fs.writeFileSync(p.file, jsonBytes(p.r));
  assert.throws(
    () => executeProduction("infer", { request: p.file, root: jobs }),
    /different request/,
  );
});
test("invalid contract failure records safe job log without persisting unauthorized refs", (t) => {
  const p = prepared(t);
  p.r.modelLicense.status = "unknown";
  fs.writeFileSync(p.file, jsonBytes(p.r));
  const jobs = path.join(p.root, "jobs");
  const r = executeProduction("infer", { request: p.file, root: jobs });
  assert.equal(r.code, "CONTRACT_INVALID");
  const stored = JSON.parse(
    fs.readFileSync(path.join(jobs, p.r.jobId, "request.json"), "utf8"),
  );
  assert.equal(stored.modelLicense, undefined);
  assert.match(stored.rejectedRequestSha256, /^[0-9a-f]{64}$/);
});
test("GLB structural inspector rejects invalid index types/counts, nonfinite transforms and graph cycles", () => {
  const bytes = createFixtureGlb(DEFAULT_PARAMETERS);
  for (const edit of [
    (d) => (d.meshes[0].primitives[0].indices = 0),
    (d) => (d.accessors[0].count = 0),
    (d) => (d.nodes[0].translation = [1, 2]),
    (d) => (d.nodes[0].matrix = Array(16).fill(0)),
    (d) => (d.nodes[0].children = [0]),
  ])
    assert.throws(() => inspectGlb(mutateGlb(bytes, edit)));
});
test("CLI emits stable JSON errors, explicit fixture selection, and strict contract-only validation", (t) => {
  const p = prepared(t),
    exec = (args) =>
      spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  const unavailable = exec(["infer", "--request", p.file, "--dry-run"]);
  assert.equal(unavailable.status, 6);
  assert.equal(JSON.parse(unavailable.stderr).code, "MODEL_UNAVAILABLE");
  const inspect = exec(["inspect"]);
  assert.equal(inspect.status, 0);
  assert.equal(JSON.parse(inspect.stdout).result.availability, "unavailable");
  const contract = exec([
    "validate",
    "--contract",
    "request",
    "--file",
    p.file,
    "--dry-run",
  ]);
  assert.equal(contract.status, 0);
  assert.equal(JSON.parse(contract.stdout).result.privateAssetChecks, "unrun");
  const unknown = exec(["inspect", "--engine", "remote"]);
  assert.equal(unknown.status, 6);
  const malformed = exec(["infer", "--oops"]);
  assert.equal(malformed.status, 2);
});
function outputPackage(t) {
  const p = prepared(t),
    r = parseContract("request", p.r),
    info = inspectGlb(p.bytes),
    sourceReport = validateFiles(r, { inputRoot: p.root });
  const artifacts = {
    "appearance.json": jsonBytes(r.appearance),
    "model.glb": p.bytes,
    "groom.json": jsonBytes(r.groom),
    "features.json": jsonBytes(r.features),
    "preview.png": fs.readFileSync(
      new URL(
        "../contracts/examples/references/synthetic-pixel.png",
        import.meta.url,
      ),
    ),
    "validation.json": jsonBytes(sourceReport),
  };
  for (const [name, bytes] of Object.entries(artifacts))
    fs.writeFileSync(path.join(p.root, name), bytes);
  const manifest = {
    manifestVersion: 1,
    jobId: r.jobId,
    requestSha256: sha256(jsonBytes(r)),
    operation: r.operation,
    modelId: r.modelId,
    modelRevision: r.modelRevision,
    templateId: r.templateId,
    designSchemaVersion: 5,
    assetRevision: sha256(p.bytes),
    topologyVersion: r.topologyVersion,
    groomSchemaVersion: 1,
    coordinates: r.coordinates,
    dimensions: r.dimensions,
    budgets: r.budgets,
    executionBudget: r.executionBudget,
    rendererCompatibility: {
      interfaceVersion: 1,
      gltfVersion: "2.0",
      threeRevision: null,
      blenderVersion: null,
      verification: "unverified",
      nativeHairPortable: false,
    },
    license: r.modelLicense,
    modules: { A: "unavailable", B: "unavailable", C: "unavailable" },
    files: Object.fromEntries(
      Object.entries(artifacts).map(([name, b]) => [
        name,
        { path: name, sha256: sha256(b), bytes: b.length },
      ]),
    ),
    capabilities: {
      bodySurfaceNode: "bodySurface",
      morphTargets: info.morphTargets,
      bones: info.bones,
      animationClips: info.animationClips,
      eyeControlTargets: [],
      eyeControlsVerification: "unrun",
      materialNames: info.materials,
      textureImages: [],
      rootBinding: {
        node: "bodySurface",
        topologyVersion: r.topologyVersion,
        verification: "unrun",
      },
      groomRepresentation: "none",
    },
    productionEvidence: {
      visualAcceptance: "unreviewed",
      reviewId: null,
      licenseEvidence: "fixture-test-license-declaration",
      userPublishConfirmation: false,
    },
  };
  fs.writeFileSync(path.join(p.root, "manifest.json"), jsonBytes(manifest));
  return { ...p, r, manifest };
}
test("full output validation requires a manifest and validates all actual output hashes/contracts", (t) => {
  const p = prepared(t);
  let report = validateFiles(p.r, { inputRoot: p.root, requirePackage: true });
  assert.equal(report.state, "missing-private-assets");
  assert.equal(report.errors[0].code, "PRIVATE_ASSETS_MISSING");
  assert(
    report.checks.some(
      (c) => c.name === "manifest-contract" && c.state === "missing",
    ),
  );
  const complete = outputPackage(t);
  report = validateFiles(complete.r, {
    inputRoot: complete.root,
    requirePackage: true,
  });
  assert.equal(report.state, "valid", JSON.stringify(report.errors));
  assert.doesNotThrow(() => parseContract("validation", report));
  fs.writeFileSync(path.join(complete.root, "features.json"), "{}");
  report = validateFiles(complete.r, {
    inputRoot: complete.root,
    requirePackage: true,
  });
  assert.equal(report.state, "failed");
  assert(report.errors.some((e) => /checksum/.test(e.message)));
});
test("manifest cannot contradict observed morphs, dimensions, license or output groom topology", (t) => {
  for (const edit of [
    (m) => (m.capabilities.morphTargets = ["invented"]),
    (m) => (m.dimensions.height = 9),
    (m) => (m.license.publicDistributionAllowed = true),
  ]) {
    const p = outputPackage(t);
    edit(p.manifest);
    fs.writeFileSync(path.join(p.root, "manifest.json"), jsonBytes(p.manifest));
    assert.equal(
      validateFiles(p.r, { inputRoot: p.root, requirePackage: true }).state,
      "failed",
    );
  }
  const p = outputPackage(t);
  const groom = { ...p.r.groom, topologyVersion: "wrong-cat-topology" };
  const bytes = jsonBytes(groom);
  fs.writeFileSync(path.join(p.root, "groom.json"), bytes);
  p.manifest.files["groom.json"] = {
    path: "groom.json",
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
  fs.writeFileSync(path.join(p.root, "manifest.json"), jsonBytes(p.manifest));
  assert.match(
    validateFiles(p.r, { inputRoot: p.root, requirePackage: true })
      .errors.map((e) => e.message)
      .join(";"),
    /groom identity/,
  );
});
test("direct GLB inspection is read-only and rejects irrelevant options and invalid skins/attributes", (t) => {
  const p = prepared(t),
    exec = (args) =>
      spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  const result = exec(["inspect", "--file", path.join(p.root, "model.glb")]);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).result.licenseEvidence, "unrun");
  assert.equal(
    exec(["infer", "--request", p.file, "--contract", "request"]).status,
    2,
  );
  assert.equal(
    exec([
      "inspect",
      "--file",
      path.join(p.root, "model.glb"),
      "--request",
      p.file,
    ]).status,
    2,
  );
  for (const edit of [
    (d) => (d.nodes[0].skin = 42),
    (d) => (d.meshes[0].primitives[0].attributes.NORMAL = 42),
    (d) => (d.nodes[0].rotation = [0, 0, 0, 2]),
  ])
    assert.throws(() => inspectGlb(mutateGlb(p.bytes, edit)));
});
test("output groom guides cannot bind beyond the actual delivered mesh triangle range", (t) => {
  const p = outputPackage(t),
    groom = {
      ...p.r.groom,
      representation: "guides",
      guides: [
        {
          rootBinding: {
            node: "bodySurface",
            triangleIndex: 999999,
            barycentric: [1, 0, 0],
          },
          points: [
            [0, 0.8, 0],
            [0, 0.9, 0],
          ],
          radiusMeters: 0.001,
        },
      ],
    };
  const bytes = jsonBytes(groom);
  fs.writeFileSync(path.join(p.root, "groom.json"), bytes);
  p.manifest.files["groom.json"] = {
    path: "groom.json",
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
  p.manifest.capabilities.groomRepresentation = "guides";
  fs.writeFileSync(path.join(p.root, "manifest.json"), jsonBytes(p.manifest));
  const report = validateFiles(p.r, {
    inputRoot: p.root,
    requirePackage: true,
  });
  assert.equal(report.state, "failed");
  assert.match(
    report.errors.map((e) => e.message).join(";"),
    /Output groom root triangle/,
  );
});
test("animation sampler/channel/type/count and primitive material references are checked structurally", () => {
  const bytes = createFixtureGlb(DEFAULT_PARAMETERS);
  const withAnimation = (doc) => {
    doc.accessors.push(
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126,
        count: 1,
        type: "SCALAR",
      },
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126,
        count: 1,
        type: "VEC3",
      },
    );
    doc.animations = [
      {
        name: "fixture-test-translation",
        samplers: [{ input: 2, output: 3 }],
        channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
      },
    ];
  };
  assert.equal(
    inspectGlb(mutateGlb(bytes, withAnimation)).animationClips[0],
    "fixture-test-translation",
  );
  for (const edit of [
    (d) =>
      (d.animations = [
        {
          name: "idle",
          samplers: [{ input: 999, output: 999 }],
          channels: [{ sampler: 0, target: { node: 999, path: "rotation" } }],
        },
      ]),
    (d) => {
      withAnimation(d);
      d.animations[0].channels[0].target.node = 999;
    },
    (d) => {
      withAnimation(d);
      d.animations[0].channels[0].sampler = 999;
    },
    (d) => {
      withAnimation(d);
      d.accessors[3].count = 2;
    },
    (d) => {
      withAnimation(d);
      d.animations[0].channels[0].target.path = "rotation";
    },
    (d) => (d.meshes[0].primitives[0].material = 999),
  ])
    assert.throws(() => inspectGlb(mutateGlb(bytes, edit)));
});
test("joint budgets count unique node indices even when joint names are duplicated", () => {
  const bytes = createFixtureGlb(DEFAULT_PARAMETERS),
    withJoints = mutateGlb(bytes, (d) => {
      d.nodes[1].name = "bone";
      d.nodes[2].name = "bone";
      d.skins = [{ joints: [1, 2] }];
      d.nodes[0].skin = 0;
    });
  assert.equal(inspectGlb(withJoints).joints, 2);
  assert.throws(
    () =>
      inspectGlb(
        mutateGlb(bytes, (d) => {
          d.skins = [{ joints: [1, 1] }];
          d.nodes[0].skin = 0;
        }),
      ),
    /Duplicate joint/,
  );
});
