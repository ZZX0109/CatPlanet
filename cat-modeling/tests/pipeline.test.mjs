import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  infer,
  validate,
  preview,
  publish,
  plan,
  safeRoot,
} from "../pipeline.mjs";
import {
  createFixtureGlb,
  DEFAULT_PARAMETERS,
  FIXTURE_ID,
} from "../fixture.mjs";
import { parseFixtureGlb } from "../protocol.mjs";
const request = () => ({
  requestSchemaVersion: 1,
  engine: FIXTURE_ID,
  parameters: { ...DEFAULT_PARAMETERS },
});
function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cat-modeling-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test("dry runs create no root or artifacts; infer is deterministic and traceable", (t) => {
  const root = path.join(temp(t), "not-created");
  const before = infer(request(), { root, dryRun: true });
  assert.equal(fs.existsSync(root), false);
  const run = infer(request(), { root });
  assert.equal(run.taskId, before.taskId);
  assert.equal(run.valid, true);
  const dir = path.join(root, run.taskId);
  const data = fs.readFileSync(path.join(dir, "model.glb"));
  assert.deepEqual(data, createFixtureGlb(DEFAULT_PARAMETERS));
  const d = parseFixtureGlb(data);
  assert.equal(d.nodes.filter((n) => n.name === "bodySurface").length, 1);
  assert.equal(d.animations, undefined);
  const existing = fs.readdirSync(dir);
  validate(run.taskId, { root, dryRun: true });
  preview(run.taskId, { root, dryRun: true });
  publish(run.taskId, { root, dryRun: true });
  assert.deepEqual(fs.readdirSync(dir), existing);
  assert.throws(() => infer(request(), { root }), /EEXIST/);
});
test("input rejects arbitrary engines, unknown/missing parameters, nonfinite values and invalid ranges", () => {
  for (const edit of [
    (r) => (r.engine = "external-ai"),
    (r) => (r.parameters.bodyScale = 2),
    (r) => (r.parameters.bodyScale = NaN),
    (r) => (r.parameters.bodyScale = "1"),
    (r) => (r.parameters.extra = 1),
    (r) => delete r.parameters.headScale,
    (r) => (r.requestSchemaVersion = 2),
    (r) => (r.credentials = "secret"),
  ]) {
    const r = request();
    edit(r);
    assert.throws(() => plan(r));
  }
});
test("preview is a deterministic diagnostic projection from validated GLB and refuses overwrite", (t) => {
  const root = temp(t),
    run = infer(request(), { root });
  const p = preview(run.taskId, { root });
  assert.equal(p.visualAcceptance, "unreviewed");
  const svg = fs.readFileSync(
    path.join(root, run.taskId, "preview.svg"),
    "utf8",
  );
  assert.match(svg, /<polygon/);
  assert.doesNotMatch(svg, /<script/);
  assert.throws(() => preview(run.taskId, { root }), /EEXIST/);
});
test("tampered geometry and fabricated passing validation cannot publish", (t) => {
  const root = temp(t),
    run = infer(request(), { root }),
    dir = path.join(root, run.taskId);
  const glb = fs.readFileSync(path.join(dir, "model.glb"));
  glb[glb.length - 4] ^= 1;
  fs.writeFileSync(path.join(dir, "model.glb"), glb);
  fs.writeFileSync(path.join(dir, "validation.json"), '{"valid":true}');
  assert.equal(validate(run.taskId, { root }).valid, false);
  assert.throws(() => preview(run.taskId, { root }), /refused/);
  assert.throws(() => publish(run.taskId, { root, dryRun: true }), /refused/);
});
test("license tampering is refused even when edited manifest claims redistribution", (t) => {
  const root = temp(t),
    run = infer(request(), { root }),
    p = path.join(root, run.taskId, "manifest.json");
  const m = JSON.parse(fs.readFileSync(p));
  m.license = { status: "unknown", publicDistributionAllowed: true };
  fs.writeFileSync(p, JSON.stringify(m));
  assert.equal(validate(run.taskId, { root }).valid, false);
  assert.throws(() => publish(run.taskId, { root }), /refused/);
});
test("publish requires task-and-asset-bound explicit confirmation and only stages new directory", (t) => {
  const root = temp(t),
    run = infer(request(), { root });
  const plan = publish(run.taskId, { root, dryRun: true });
  assert.equal(fs.existsSync(plan.destination), false);
  assert.throws(() => publish(run.taskId, { root }), /Explicit confirmation/);
  assert.throws(
    () => publish(run.taskId, { root, confirm: "yes" }),
    /Explicit confirmation/,
  );
  const staged = publish(run.taskId, {
    root,
    confirm: plan.confirmationRequired,
  });
  assert.equal(staged.activeModelChanged, false);
  assert.equal(fs.existsSync(path.join(staged.destination, "model.glb")), true);
  assert.throws(
    () => publish(run.taskId, { root, confirm: plan.confirmationRequired }),
    /EEXIST/,
  );
});
test("traversal, protected output paths and symlinks including broken links are rejected", (t) => {
  const root = temp(t);
  assert.throws(
    () => safeRoot("/workspace/CatPlanet/public/models"),
    /Output root/,
  );
  assert.throws(() => validate("../model", { root }), /Invalid task ID/);
  fs.symlinkSync(path.join(root, "missing"), path.join(root, "broken"));
  assert.throws(() => plan(request(), path.join(root, "broken")), /Symlink/);
  const run = infer(request(), { root }),
    file = path.join(root, run.taskId, "groom.json");
  fs.unlinkSync(file);
  fs.symlinkSync(path.join(root, "missing"), file);
  assert.equal(validate(run.taskId, { root }).valid, false);
});
test("GLB parser rejects truncated chunks and out-of-bounds buffers", () => {
  const glb = createFixtureGlb(DEFAULT_PARAMETERS);
  assert.throws(
    () => parseFixtureGlb(glb.subarray(0, glb.length - 4)),
    /header/,
  );
  const bad = Buffer.from(glb);
  bad.writeUInt32LE(0xffffffff, 12);
  assert.throws(() => parseFixtureGlb(bad), /chunk/);
});
test("CLI dry-run is usable and invalid validation exits nonzero", (t) => {
  const root = temp(t),
    cli = fileURLToPath(new URL("../cli.mjs", import.meta.url)),
    input = path.join(root, "request.json");
  fs.writeFileSync(input, JSON.stringify(request()));
  const ok = spawnSync(
    process.execPath,
    [
      cli,
      "infer",
      "--engine",
      "fixture",
      "--request",
      input,
      "--root",
      path.join(root, "new"),
      "--dry-run",
    ],
    { encoding: "utf8" },
  );
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).dryRun, true);
  assert.equal(fs.existsSync(path.join(root, "new")), false);
  const fail = spawnSync(
    process.execPath,
    [
      cli,
      "validate",
      "--engine",
      "fixture",
      "--task",
      "task-000000000000000000000000",
      "--root",
      root,
    ],
    { encoding: "utf8" },
  );
  assert.equal(fail.status, 4);
  assert.equal(JSON.parse(fail.stderr).result.valid, false);
});
