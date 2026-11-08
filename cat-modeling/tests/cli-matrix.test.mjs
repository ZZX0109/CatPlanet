import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createFixtureGlb, DEFAULT_PARAMETERS } from "../fixture.mjs";
import { inspectGlb } from "../contracts/glb-inspector.mjs";
import { parseContract } from "../contracts/index.mjs";
import { jsonBytes, sha256 } from "../protocol.mjs";
import { validateFiles } from "../production.mjs";

const cli = fileURLToPath(new URL("../cli.mjs", import.meta.url));
const example = new URL(
  "../contracts/examples/request.v1.json",
  import.meta.url,
);
const fixtureExample = fileURLToPath(
  new URL("../examples/request.json", import.meta.url),
);
const run = (...args) => {
  const child = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    timeout: 15000,
  });
  assert.ifError(child.error);
  assert.equal(child.signal, null, child.stderr);
  const output = child.status === 0 ? child.stdout : child.stderr;
  assert.equal(child.status === 0 ? child.stderr : child.stdout, "", output);
  return { status: child.status, body: JSON.parse(output) };
};
function expect(args, status, code) {
  const result = run(...args);
  assert.equal(result.status, status, JSON.stringify(result.body));
  assert.equal(result.body.code, code, JSON.stringify(result.body));
  assert.equal(result.body.ok, status === 0);
  return result.body;
}
function setup(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cat-cli-matrix-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const source = path.join(temp, "source");
  fs.mkdirSync(source);
  const request = JSON.parse(fs.readFileSync(example, "utf8"));
  const bytes = createFixtureGlb(DEFAULT_PARAMETERS);
  Object.assign(request, {
    jobId: "job-cli-matrix",
    modelId: "authored-test-fixture",
    modelRevision: sha256(bytes),
    topologyVersion: "miaoxing-geometric-cat-v1",
  });
  Object.assign(request.groom, {
    topologyVersion: request.topologyVersion,
    bodySurface: { node: "bodySurface" },
  });
  const file = path.join(source, "request.json"),
    jobs = path.join(temp, "jobs");
  fs.writeFileSync(file, jsonBytes(request));
  fs.writeFileSync(path.join(source, "model.glb"), bytes);
  return { temp, source, file, jobs, request, bytes };
}
function packageFor(p) {
  const r = parseContract("request", p.request),
    info = inspectGlb(p.bytes);
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
    "validation.json": jsonBytes(validateFiles(r, { inputRoot: p.source })),
  };
  for (const [name, bytes] of Object.entries(artifacts))
    fs.writeFileSync(path.join(p.source, name), bytes);
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
  fs.writeFileSync(path.join(p.source, "manifest.json"), jsonBytes(manifest));
  return manifest;
}
const argsFor = (command, p) => [
  command,
  "--request",
  p.file,
  "--input-root",
  p.source,
  "--root",
  p.jobs,
];

test("actual production inspect/preview/validate command matrix succeeds without pretending inference or visual acceptance", (t) => {
  const p = setup(t);
  expect(["inspect"], 0, "OK");
  expect(
    ["inspect", "--file", path.join(p.source, "model.glb"), "--dry-run"],
    0,
    "OK",
  );
  const contractResult = expect(
    ["validate", "--contract", "request", "--file", p.file, "--dry-run"],
    0,
    "OK",
  );
  assert.equal(
    contractResult.result.fileSha256,
    sha256(fs.readFileSync(p.file)),
  );
  for (const command of ["inspect", "preview"]) {
    const before = fs.existsSync(p.jobs)
      ? fs.readdirSync(p.jobs, { recursive: true })
      : null;
    const dry = expect([...argsFor(command, p), "--dry-run"], 0, "OK");
    assert.deepEqual(
      fs.existsSync(p.jobs)
        ? fs.readdirSync(p.jobs, { recursive: true })
        : null,
      before,
    );
    const actual = expect(argsFor(command, p), 0, "OK");
    assert.match(actual.execution, /runs\/run-\d{6}-/);
    const report = actual.result.validation;
    assert.equal(
      report.checks.find((c) => c.name === "visual-acceptance").state,
      "unrun",
    );
    if (command === "preview")
      assert.equal(dry.result.handoff.invokeInCloud, false);
  }
  packageFor(p);
  expect([...argsFor("validate", p), "--dry-run"], 0, "OK");
  expect(argsFor("validate", p), 0, "OK");
  for (const [command, status, code] of [
    ["infer", 6, "MODEL_UNAVAILABLE"],
    ["publish", 7, "PRODUCTION_PUBLISH_UNAVAILABLE"],
  ]) {
    const base = [command, "--request", p.file, "--root", p.jobs];
    expect([...base, "--dry-run"], status, code);
    expect(base, status, code);
  }
});

test("production dry-run leaves no output directory for success, unavailable models, missing assets or contract failure", (t) => {
  const p = setup(t);
  expect([...argsFor("inspect", p), "--dry-run"], 0, "OK");
  expect([...argsFor("preview", p), "--dry-run"], 0, "OK");
  expect([...argsFor("validate", p), "--dry-run"], 5, "PRIVATE_ASSETS_MISSING");
  for (const command of ["infer", "publish"])
    expect(
      [command, "--request", p.file, "--root", p.jobs, "--dry-run"],
      command === "infer" ? 6 : 7,
      command === "infer"
        ? "MODEL_UNAVAILABLE"
        : "PRODUCTION_PUBLISH_UNAVAILABLE",
    );
  p.request.appearance.shape.headRound = 101;
  fs.writeFileSync(p.file, jsonBytes(p.request));
  expect([...argsFor("inspect", p), "--dry-run"], 3, "CONTRACT_INVALID");
  assert.equal(fs.existsSync(p.jobs), false);
});

test("inspect/preview/validate distinguish missing bytes, bad hashes, incompatible versions and linked inputs", (t) => {
  for (const command of ["inspect", "preview", "validate"]) {
    const p = setup(t);
    packageFor(p);
    const model = path.join(p.source, "model.glb");
    fs.unlinkSync(model);
    expect([...argsFor(command, p), "--dry-run"], 5, "PRIVATE_ASSETS_MISSING");
    fs.writeFileSync(model, Buffer.from("bad model"));
    expect([...argsFor(command, p), "--dry-run"], 4, "FILES_INVALID");
    fs.unlinkSync(model);
    fs.symlinkSync(p.file, model);
    expect([...argsFor(command, p), "--dry-run"], 4, "FILES_INVALID");
    fs.unlinkSync(model);
    fs.writeFileSync(model, p.bytes);
    p.request.requestVersion = 99;
    fs.writeFileSync(p.file, jsonBytes(p.request));
    expect([...argsFor(command, p), "--dry-run"], 3, "CONTRACT_INVALID");
    assert.equal(fs.existsSync(p.jobs), false);
  }
  const p = setup(t),
    linked = path.join(p.temp, "linked-request.json");
  fs.symlinkSync(p.file, linked);
  for (const command of ["inspect", "preview", "validate"])
    expect(
      [command, "--request", linked, "--root", p.jobs, "--dry-run"],
      8,
      "IO_ERROR",
    );
  const invalid = path.join(p.temp, "invalid.glb");
  fs.writeFileSync(invalid, "not glb");
  expect(["inspect", "--file", invalid], 4, "FILES_INVALID");
  expect(
    ["inspect", "--file", path.join(p.temp, "missing.glb")],
    5,
    "PRIVATE_ASSETS_MISSING",
  );
});

test("full-package CLI rejects a checksummed PNG signature without actual image data", (t) => {
  const p = setup(t),
    manifest = packageFor(p);
  const fake = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  fs.writeFileSync(path.join(p.source, "preview.png"), fake);
  manifest.files["preview.png"] = {
    path: "preview.png",
    bytes: fake.length,
    sha256: sha256(fake),
  };
  fs.writeFileSync(path.join(p.source, "manifest.json"), jsonBytes(manifest));
  const failure = expect(
    [...argsFor("validate", p), "--dry-run"],
    4,
    "FILES_INVALID",
  );
  assert(
    failure.result.errors.some((error) =>
      error.message.includes("preview.png"),
    ),
  );
  assert.equal(fs.existsSync(p.jobs), false);
});

test("direct inspect reports structural inspection budget failures as FILES_INVALID", (t) => {
  const p = setup(t),
    oldLength = p.bytes.readUInt32LE(12);
  const doc = JSON.parse(p.bytes.subarray(20, 20 + oldLength));
  doc.nodes = Array.from({ length: 50001 }, () => ({}));
  const encoded = Buffer.from(JSON.stringify(doc));
  const json = Buffer.concat([
    encoded,
    Buffer.alloc((4 - (encoded.length % 4)) % 4, 32),
  ]);
  const bin = p.bytes.subarray(28 + oldLength);
  const header = Buffer.from(p.bytes.subarray(0, 12)),
    jsonHeader = Buffer.alloc(8),
    binHeader = Buffer.alloc(8);
  header.writeUInt32LE(28 + json.length + bin.length, 8);
  jsonHeader.writeUInt32LE(json.length);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  binHeader.writeUInt32LE(bin.length);
  binHeader.writeUInt32LE(0x004e4942, 4);
  const file = path.join(p.temp, "too-many-descriptors.glb");
  fs.writeFileSync(
    file,
    Buffer.concat([header, jsonHeader, json, binHeader, bin]),
  );
  const failure = expect(
    ["inspect", "--file", file, "--dry-run"],
    4,
    "FILES_INVALID",
  );
  assert.equal(failure.errors[0].code, "GLB_RESOURCE_LIMIT");
  assert.equal(fs.existsSync(p.jobs), false);
});

test("source inspect and preview cannot use output manifest revision to bypass the requested source hash", (t) => {
  const p = setup(t);
  const m = packageFor(p);
  p.request.modelRevision = "0".repeat(64);
  fs.writeFileSync(p.file, jsonBytes(p.request));
  m.modelRevision = p.request.modelRevision;
  m.requestSha256 = sha256(jsonBytes(parseContract("request", p.request)));
  // Keep a fully self-consistent output package while claiming a different source.
  const report = JSON.parse(
    fs.readFileSync(path.join(p.source, "validation.json")),
  );
  report.requestSha256 = m.requestSha256;
  const b = jsonBytes(report);
  fs.writeFileSync(path.join(p.source, "validation.json"), b);
  m.files["validation.json"] = {
    path: "validation.json",
    bytes: b.length,
    sha256: sha256(b),
  };
  fs.writeFileSync(path.join(p.source, "manifest.json"), jsonBytes(m));
  expect([...argsFor("validate", p), "--dry-run"], 0, "OK");
  for (const command of ["inspect", "preview"])
    expect([...argsFor(command, p), "--dry-run"], 4, "FILES_INVALID");
});

test("actual CLI rejects ignored, duplicate and cross-engine options plus invalid output roots", (t) => {
  const p = setup(t);
  for (const args of [
    ["inspect", "--input-root", p.source],
    ["inspect", "--root", p.jobs],
    ["validate", "--contract", "request", "--file", p.file, "--root", p.jobs],
    ["inspect", "--dry-run", "--dry-run"],
    [
      "validate",
      "--contract",
      "request",
      "--file",
      p.file,
      "--input-root",
      p.source,
    ],
    ["infer", "--request", p.file, "--input-root", p.source],
    [
      "preview",
      "--engine",
      "fixture",
      "--task",
      "task-000000000000000000000000",
      "--confirm",
      "yes",
    ],
    ["validate", "--request", p.file, "--contract", "request"],
    [
      "validate",
      "--contract",
      "request",
      "--file",
      p.file,
      "--task-file",
      p.file,
    ],
    ["inspect", "--file", p.file, "--request", p.file],
    ["inspect", "--unknown"],
    ["inspect", "--file"],
    [
      "infer",
      "--request",
      p.file,
      "--root",
      "/workspace/CatPlanet/public/models",
      "--dry-run",
    ],
  ])
    expect(args, 2, "INVALID_ARGUMENT");
  expect(["inspect", "--engine", "remote"], 6, "MODEL_UNAVAILABLE");
  for (const text of ["null", "{", "[]"]) {
    const bad = path.join(p.temp, "bad.json");
    fs.writeFileSync(bad, text);
    expect(
      ["infer", "--request", bad, "--root", p.jobs, "--dry-run"],
      3,
      "CONTRACT_INVALID",
    );
  }
});

test("fixture commands stay explicit, deterministic and separate from production data", (t) => {
  const p = setup(t),
    root = path.join(p.temp, "fixture-jobs");
  expect(["inspect", "--engine", "fixture"], 0, "OK");
  const dry = expect(
    [
      "infer",
      "--engine",
      "fixture",
      "--request",
      fixtureExample,
      "--root",
      root,
      "--dry-run",
    ],
    0,
    "OK",
  );
  assert.equal(fs.existsSync(root), false);
  const actual = expect(
    [
      "infer",
      "--engine",
      "fixture",
      "--request",
      fixtureExample,
      "--root",
      root,
    ],
    0,
    "OK",
  );
  assert.equal(actual.result.taskId, dry.result.taskId);
  for (const command of ["validate", "preview", "publish"]) {
    expect(
      [
        command,
        "--engine",
        "fixture",
        "--task",
        actual.result.taskId,
        "--root",
        root,
        "--dry-run",
      ],
      0,
      "OK",
    );
  }
  expect(
    [
      "preview",
      "--engine",
      "fixture",
      "--task",
      actual.result.taskId,
      "--root",
      root,
    ],
    0,
    "OK",
  );
  expect(
    [
      "infer",
      "--engine",
      "fixture",
      "--request",
      p.file,
      "--root",
      root,
      "--dry-run",
    ],
    3,
    "CONTRACT_INVALID",
  );
  expect(
    ["infer", "--request", fixtureExample, "--root", p.jobs, "--dry-run"],
    3,
    "CONTRACT_INVALID",
  );
  expect(
    [
      "validate",
      "--engine",
      "fixture",
      "--task",
      "../escape",
      "--root",
      root,
      "--dry-run",
    ],
    2,
    "INVALID_ARGUMENT",
  );
  for (const command of ["validate", "preview", "publish"])
    expect(
      [
        command,
        "--engine",
        "fixture",
        "--task",
        "task-000000000000000000000000",
        "--root",
        root,
        "--dry-run",
      ],
      4,
      "FILES_INVALID",
    );
  const link = path.join(p.temp, "fixture-link.json");
  fs.symlinkSync(fixtureExample, link);
  expect(
    [
      "infer",
      "--engine",
      "fixture",
      "--request",
      link,
      "--root",
      root,
      "--dry-run",
    ],
    8,
    "IO_ERROR",
  );
  const bad = path.join(p.temp, "fixture-bad.json");
  fs.writeFileSync(bad, "{");
  expect(
    [
      "infer",
      "--engine",
      "fixture",
      "--request",
      bad,
      "--root",
      root,
      "--dry-run",
    ],
    3,
    "CONTRACT_INVALID",
  );
  expect(
    [
      "infer",
      "--engine",
      "fixture",
      "--request",
      p.source,
      "--root",
      root,
      "--dry-run",
    ],
    3,
    "CONTRACT_INVALID",
  );
  assert.equal(fs.existsSync(p.jobs), false);
});

test("production execution logs append immutable runs and refuse linked request/run roots", (t) => {
  const p = setup(t),
    base = argsFor("inspect", p);
  const first = expect(base, 0, "OK"),
    firstDir = path.join(p.jobs, first.execution);
  const before = fs.readFileSync(path.join(firstDir, "execution.log.jsonl"));
  const second = expect(base, 0, "OK");
  assert.notEqual(first.execution, second.execution);
  assert.deepEqual(
    fs.readFileSync(path.join(firstDir, "execution.log.jsonl")),
    before,
  );
  const log = JSON.parse(before);
  assert.equal(log.networkCalls, 0);
  assert.equal(log.trainingStarted, false);
  assert.equal(log.productionAssetsChanged, false);
  const stored = path.join(p.jobs, p.request.jobId, "request.json");
  fs.unlinkSync(stored);
  fs.symlinkSync(p.file, stored);
  expect(base, 8, "IO_ERROR");
  assert.deepEqual(fs.readFileSync(p.file), jsonBytes(p.request));
  fs.unlinkSync(stored);
  fs.writeFileSync(stored, jsonBytes(parseContract("request", p.request)));
  const runs = path.join(p.jobs, p.request.jobId, "runs");
  fs.renameSync(runs, runs + "-kept");
  fs.symlinkSync(runs + "-kept", runs);
  expect(base, 8, "IO_ERROR");
  assert.deepEqual(
    fs.readFileSync(
      path.join(
        firstDir.replace("/runs/", "/runs-kept/"),
        "execution.log.jsonl",
      ),
    ),
    before,
  );
});

test("partial I/O failures preserve old files and do not emit a successful run or half-preview", (t) => {
  const p = setup(t),
    job = path.join(p.jobs, p.request.jobId);
  fs.mkdirSync(job, { recursive: true });
  const blocker = path.join(job, "runs");
  fs.writeFileSync(blocker, "do not replace");
  expect(argsFor("preview", p), 8, "IO_ERROR");
  assert.equal(fs.readFileSync(blocker, "utf8"), "do not replace");
  assert.equal(fs.existsSync(path.join(job, "request.json")), true);
  const root = path.join(p.temp, "fixture-jobs");
  const task = expect(
    [
      "infer",
      "--engine",
      "fixture",
      "--request",
      fixtureExample,
      "--root",
      root,
    ],
    0,
    "OK",
  ).result.taskId;
  const dir = path.join(root, task),
    sentinel = path.join(dir, "preview.json");
  fs.writeFileSync(sentinel, "keep partial evidence");
  expect(
    ["preview", "--engine", "fixture", "--task", task, "--root", root],
    8,
    "IO_ERROR",
  );
  assert.equal(fs.readFileSync(sentinel, "utf8"), "keep partial evidence");
  assert.equal(fs.existsSync(path.join(dir, "preview.svg")), false);
});

test("local task/result CLI verifies actual evidence while metadata and partial failures keep their limits", async (t) => {
  const p = setup(t);
  const task = expect([...argsFor("preview", p), "--dry-run"], 0, "OK").result
    .handoff;
  const taskFile = path.join(p.temp, "blender-task.json"),
    resultFile = path.join(p.temp, "local-result.json");
  fs.writeFileSync(taskFile, jsonBytes(task));
  const result = {
    resultVersion: 1,
    jobId: task.jobId,
    taskSha256: sha256(jsonBytes(parseContract("local-task", task))),
    requestSha256: task.requestSha256,
    state: "blocked",
    returnMode: "metadata-only",
    authorization: {
      localExecutionApproved: false,
      evidenceReturnApproved: false,
      evidenceRef: null,
    },
    tool: { name: "blender", version: null },
    source: {
      sha256Before: null,
      sha256After: null,
      authorizationEvidence: null,
    },
    scriptSha256: task.script.sha256,
    scenarioSha256: task.renderContract.sha256,
    execution: {
      commandExecuted: false,
      exitCode: null,
      timedOut: false,
      elapsedSeconds: 0,
      failureStage: "planning",
    },
    artifacts: [],
    checks: [
      {
        name: "private-source",
        state: "missing",
        details: "No private source supplied",
      },
    ],
    limitations: ["Synthetic protocol test only; Blender was not executed"],
  };
  fs.writeFileSync(resultFile, jsonBytes(result));
  const base = [
    "validate",
    "--contract",
    "local-result",
    "--file",
    resultFile,
    "--task-file",
    taskFile,
    "--dry-run",
  ];
  expect(
    ["validate", "--contract", "local-task", "--file", taskFile, "--dry-run"],
    0,
    "OK",
  );
  expect(base, 5, "PRIVATE_ASSETS_MISSING");
  const failed = {
    ...result,
    state: "failed",
    execution: {
      ...result.execution,
      commandExecuted: true,
      exitCode: 1,
      failureStage: "render",
    },
  };
  fs.writeFileSync(resultFile, jsonBytes(failed));
  expect(base, 4, "FILES_INVALID");

  const evidence = path.join(p.temp, "authorized-evidence");
  fs.mkdirSync(evidence);
  const png = await sharp({
    create: { width: 768, height: 768, channels: 3, background: "#dddddd" },
  })
    .png()
    .toBuffer();
  const report = {
    status: "rendered-not-approved",
    fixtureOnly: true,
    sourceSha256: "a".repeat(64),
    tools: { blender: "4.5.15" },
    scenario: task.renderContract.scenario,
    design: task.appearance,
    images: Object.fromEntries(
      ["front", "three", "side"].map((view) => [view, { sha256: sha256(png) }]),
    ),
  };
  const files = {
    "front.png": png,
    "three.png": png,
    "side.png": png,
    "validation.json": jsonBytes(report),
    "execution.log": Buffer.from(
      "Synthetic protocol test; Blender was not executed\n",
    ),
  };
  for (const [name, bytes] of Object.entries(files))
    fs.writeFileSync(path.join(evidence, name), bytes);
  Object.assign(result, {
    state: "completed",
    authorization: {
      localExecutionApproved: true,
      evidenceReturnApproved: false,
      evidenceRef: "synthetic-protocol-test",
    },
    tool: { name: "blender", version: "4.5.15" },
    source: {
      sha256Before: "a".repeat(64),
      sha256After: "a".repeat(64),
      authorizationEvidence: "synthetic-test-only",
    },
    execution: {
      commandExecuted: true,
      exitCode: 0,
      timedOut: false,
      elapsedSeconds: 1,
      failureStage: null,
    },
    artifacts: Object.entries(files).map(([name, b]) => ({
      path: name,
      bytes: b.length,
      sha256: sha256(b),
    })),
    checks: [
      ...[
        "input-integrity",
        "source-unchanged",
        "tool-version",
        "render-completed",
        "output-integrity",
      ].map((name) => ({
        name,
        state: "passed",
        details: "Synthetic protocol data only; no Blender was executed",
      })),
      {
        name: "real-blender",
        state: "unrun",
        details: "Protocol fixture only",
      },
    ],
  });
  fs.writeFileSync(resultFile, jsonBytes(result));
  const metadata = expect(base, 0, "OK");
  assert.equal(metadata.result.status, "metadata-accepted-unverified");
  assert.equal(metadata.result.approved, false);
  assert(metadata.result.pendingChecks.includes("returned-file-bytes"));

  result.returnMode = "authorized-evidence";
  result.authorization.evidenceReturnApproved = true;
  fs.writeFileSync(resultFile, jsonBytes(result));
  const full = [...base, "--input-root", evidence];
  const checked = expect(full, 0, "OK");
  assert.equal(checked.result.status, "evidence-integrity-verified-unapproved");
  assert.equal(checked.result.productionIntegrationReady, false);
  assert(
    checked.result.pendingChecks.includes("synthetic-evidence-not-production"),
  );
  assert.equal(fs.existsSync(p.jobs), false);
  fs.unlinkSync(path.join(evidence, "front.png"));
  expect(full, 5, "PRIVATE_ASSETS_MISSING");
  fs.symlinkSync(
    path.join(evidence, "side.png"),
    path.join(evidence, "front.png"),
  );
  expect(full, 4, "FILES_INVALID");
  result.taskSha256 = "0".repeat(64);
  fs.writeFileSync(resultFile, jsonBytes(result));
  expect(base, 4, "FILES_INVALID");
  result.execution.exitCode = 1;
  fs.writeFileSync(resultFile, jsonBytes(result));
  expect(base, 3, "CONTRACT_INVALID");
  assert.equal(fs.existsSync(p.jobs), false);
});
