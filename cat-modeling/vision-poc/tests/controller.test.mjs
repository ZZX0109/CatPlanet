import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  observePng,
  compareObservations,
  proposeHeadWidths,
  decideCandidate,
} from "../controller.mjs";

// Synthetic RGBA silhouettes are unit fixtures only, never cat visual evidence.
async function temporaryDirectory(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "miaoxing-controller-unit-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function writeMaskFixture(
  root,
  name,
  { headWidth = 20, includeHead = true } = {},
) {
  const width = 64;
  const height = 64;
  const rgba = Buffer.alloc(width * height * 4);
  function rect(x, y, w, h, color) {
    for (let row = y; row < y + h; row++) {
      for (let column = x; column < x + w; column++) {
        rgba.set(color, (row * width + column) * 4);
      }
    }
  }
  rect(20, 32, 24, 28, [100, 100, 100, 255]);
  if (includeHead)
    rect(32 - headWidth / 2, 8, headWidth, 16, [220, 40, 40, 255]);
  // Invisible colored pixels must not be counted as foreground.
  rect(0, 0, 4, 4, [220, 40, 40, 0]);
  const file = path.join(root, name);
  await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(file);
  return file;
}

function evidenceCase() {
  const expected = {
    candidateId: "candidate-round-1-headWidth-53",
    requestedParameter: 53,
    round: 1,
    baseSha256: "1".repeat(64),
    sourceSha256: "2".repeat(64),
    topologyHash: "3".repeat(64),
    uvHash: "4".repeat(64),
    configurationHash: "5".repeat(64),
  };
  return {
    currentParameter: 50,
    candidateParameter: 53,
    currentMetrics: { front: { loss: 0.4 }, three: { loss: 0.2 } },
    candidateMetrics: { front: { loss: 0.3 }, three: { loss: 0.2 } },
    expected,
    evidence: {
      candidateId: expected.candidateId,
      appliedParameter: 53,
      shapeKeyWeights: {
        Shape_headWidth_low: 0,
        Shape_headWidth_high: 0.06,
      },
      round: expected.round,
      baseSha256Before: expected.baseSha256,
      baseSha256After: expected.baseSha256,
      sourceSha256Before: expected.sourceSha256,
      sourceSha256After: expected.sourceSha256,
      topologyHash: expected.topologyHash,
      uvHash: expected.uvHash,
      configurationHash: expected.configurationHash,
      finite: true,
      nondegenerate: true,
      orientationPreserved: true,
    },
  };
}

function rejectCase(change) {
  const input = evidenceCase();
  change(input);
  const decision = decideCandidate(input);
  assert.equal(decision.accepted, false);
  assert.ok(Array.isArray(decision.reasons));
  assert.ok(decision.reasons.length > 0, "rejection must retain a reason");
}

test("PNG observation reads actual bytes and extracts alpha/red-head masks", async (t) => {
  const root = await temporaryDirectory(t);
  const file = await writeMaskFixture(root, "current.png");
  const observation = await observePng(file);
  assert.equal(
    observation.sha256,
    createHash("sha256")
      .update(await fs.readFile(file))
      .digest("hex"),
  );
  assert.equal(observation.width, 64);
  assert.equal(observation.height, 64);
  assert.ok(observation.headMask instanceof Uint8Array);
  assert.ok(observation.silhouetteMask instanceof Uint8Array);
  assert.equal(observation.headMask.length, 64 * 64);
  assert.equal(observation.silhouetteMask.length, 64 * 64);
  assert.equal(
    observation.headMask[0],
    0,
    "transparent red must not be a head pixel",
  );
  assert.equal(
    observation.silhouetteMask[0],
    0,
    "transparent red must not be foreground",
  );
  assert.ok(observation.normalizedHeadWidth > 0);
  assert.ok(observation.silhouettePixels > 0);
  assert.ok(observation.headBbox);
  const identical = compareObservations(observation, observation);
  assert.equal(identical.headIoU, 1);
  assert.equal(identical.silhouetteIoU, 1);
  assert.equal(identical.loss, 0);
});

test("image-derived metrics show head width and objective improve toward target", async (t) => {
  const root = await temporaryDirectory(t);
  const current = await observePng(
    await writeMaskFixture(root, "current.png", { headWidth: 16 }),
  );
  const candidate = await observePng(
    await writeMaskFixture(root, "candidate.png", { headWidth: 20 }),
  );
  const target = await observePng(
    await writeMaskFixture(root, "target.png", { headWidth: 24 }),
  );
  const currentMetrics = compareObservations(current, target);
  const candidateMetrics = compareObservations(candidate, target);
  assert.ok(candidate.normalizedHeadWidth > current.normalizedHeadWidth);
  assert.ok(target.normalizedHeadWidth > candidate.normalizedHeadWidth);
  assert.ok(candidateMetrics.headIoU > currentMetrics.headIoU);
  assert.ok(candidateMetrics.loss < currentMetrics.loss);
  assert.ok(
    Math.abs(
      currentMetrics.loss -
        (1 -
          currentMetrics.headIoU +
          Math.abs(
            currentMetrics.normalizedHeadWidth -
              currentMetrics.targetNormalizedHeadWidth,
          )),
    ) < 1e-12,
  );
  assert.ok(Number.isFinite(currentMetrics.loss));
  assert.ok(Number.isFinite(candidateMetrics.loss));
  assert.notEqual(current.sha256, candidate.sha256);
});

test("observation refuses missing head masks and malformed image files", async (t) => {
  const root = await temporaryDirectory(t);
  const noHead = await writeMaskFixture(root, "no-head.png", {
    includeHead: false,
  });
  await assert.rejects(() => observePng(noHead));
  const malformed = path.join(root, "malformed.png");
  await fs.writeFile(malformed, "not a PNG image");
  await assert.rejects(() => observePng(malformed));
});

test("planner proposals stay in 0..100 and at most three points from current value", () => {
  assert.deepEqual(proposeHeadWidths(50), [47, 53]);
  assert.deepEqual(proposeHeadWidths(0), [3]);
  assert.deepEqual(proposeHeadWidths(100), [97]);
  for (const current of [0, 1, 2, 3, 50, 97, 98, 99, 100]) {
    const values = proposeHeadWidths(current);
    assert.equal(new Set(values).size, values.length);
    for (const value of values) {
      assert.ok(value >= 0 && value <= 100);
      assert.ok(Math.abs(value - current) <= 3);
      assert.notEqual(value, current);
    }
  }
  for (const current of [-1, 101, NaN, Infinity, "50"])
    assert.throws(() => proposeHeadWidths(current));
  for (const step of [-1, 0, 4, NaN, Infinity, "3"])
    assert.throws(() => proposeHeadWidths(50, step));
});

test("accepts front improvement only when held-out view and all evidence gates pass", () => {
  const result = decideCandidate(evidenceCase());
  assert.equal(result.accepted, true);
  assert.deepEqual(result.reasons, []);
});

test("front improvement cannot hide held-out-view regression", async (t) => {
  const root = await temporaryDirectory(t);
  const narrow = await observePng(
    await writeMaskFixture(root, "narrow.png", { headWidth: 16 }),
  );
  const medium = await observePng(
    await writeMaskFixture(root, "medium.png", { headWidth: 20 }),
  );
  const wide = await observePng(
    await writeMaskFixture(root, "wide.png", { headWidth: 24 }),
  );
  const input = evidenceCase();
  input.currentMetrics = {
    front: compareObservations(narrow, wide),
    three: compareObservations(narrow, narrow),
  };
  input.candidateMetrics = {
    front: compareObservations(medium, wide),
    three: compareObservations(medium, narrow),
  };
  assert.ok(
    input.candidateMetrics.front.loss < input.currentMetrics.front.loss,
  );
  assert.ok(
    input.candidateMetrics.three.loss > input.currentMetrics.three.loss,
  );
  const decision = decideCandidate(input);
  assert.equal(decision.accepted, false);
  assert.ok(decision.reasons.length > 0);
});

test("requires strict front improvement and finite metrics", () => {
  rejectCase((x) => {
    x.candidateMetrics.front.loss = x.currentMetrics.front.loss;
  });
  rejectCase((x) => {
    x.candidateMetrics.front.loss = 0.5;
  });
  rejectCase((x) => {
    x.candidateMetrics.front.loss = NaN;
  });
  rejectCase((x) => {
    x.candidateMetrics.three.loss = Infinity;
  });
  rejectCase((x) => {
    delete x.candidateMetrics.three;
  });
});

test("rejects stale candidate, stale round and mismatched configuration identity", () => {
  rejectCase((x) => {
    x.evidence.candidateId = "candidate-from-a-different-parameter";
  });
  rejectCase((x) => {
    x.evidence.round = 0;
  });
  rejectCase((x) => {
    x.evidence.configurationHash = "6".repeat(64);
  });
  rejectCase((x) => {
    delete x.evidence.candidateId;
  });
});

test("rejects source/base mutation and topology or UV replacement", () => {
  for (const field of [
    "baseSha256Before",
    "baseSha256After",
    "sourceSha256Before",
    "sourceSha256After",
    "topologyHash",
    "uvHash",
  ]) {
    rejectCase((x) => {
      x.evidence[field] = "6".repeat(64);
    });
    rejectCase((x) => {
      delete x.evidence[field];
    });
  }
});

test("basic structural failure and missing structural checks reject", () => {
  for (const field of ["finite", "nondegenerate", "orientationPreserved"]) {
    rejectCase((x) => {
      x.evidence[field] = false;
    });
    rejectCase((x) => {
      delete x.evidence[field];
    });
  }
});

test("controller never accepts out-of-bounds or excessive parameter steps", () => {
  for (const candidateParameter of [-1, 101, 54, NaN, Infinity, "53"]) {
    rejectCase((x) => {
      x.candidateParameter = candidateParameter;
    });
  }
  rejectCase((x) => {
    x.currentParameter = -1;
    x.candidateParameter = 0;
  });
});


test("CLI rejects unavailable real inputs and invalid options before output or Blender execution", async (t) => {
  const root = await temporaryDirectory(t);
  const cli = fileURLToPath(new URL("../calibrate.mjs", import.meta.url));
  const marker = path.join(root, "executor-was-called");
  const sentinel = path.join(root, "local-executor-sentinel.mjs");
  // This safe sentinel is never real Blender. Any accidental invocation leaves evidence.
  await fs.writeFile(
    sentinel,
    '#!/usr/bin/env node\nimport fs from "node:fs"; fs.writeFileSync(' +
      JSON.stringify(marker) + ', "unexpected execution");\n',
    { mode: 0o700 },
  );
  const invalid = [
    { name: "missing-demo", args: ["--max-rounds", "1"], error: /Explicit --demo/ },
    { name: "duplicate-rounds", args: ["--demo", "--max-rounds", "1", "--max-rounds", "2"], error: /Duplicate --max-rounds/ },
    { name: "duplicate-blender", args: ["--demo", "--blender", sentinel], error: /Duplicate --blender/ },
    { name: "real-photo", args: ["--demo", "--real-photo", "real-pet.png"], error: /Only explicit fixture/ },
    { name: "unknown-model", args: ["--demo", "--model", "private-cat.glb"], error: /Only explicit fixture/ },
    { name: "excessive-rounds", args: ["--demo", "--max-rounds", "7"], error: /max-rounds/ },
  ];
  for (const item of invalid) {
    const out = path.join(root, item.name);
    const result = spawnSync(
      process.execPath,
      [cli, "--blender", sentinel, ...item.args, "--out", out],
      { encoding: "utf8", timeout: 10000 },
    );
    assert.equal(result.error, undefined, item.name);
    assert.equal(result.status, 1, item.name + ": " + result.stderr);
    assert.equal(result.stdout, "", item.name + " must not emit success output");
    const failure = JSON.parse(result.stderr);
    assert.equal(failure.ok, false, item.name);
    assert.equal(failure.modelUnavailableForRealInputs, true, item.name);
    assert.match(failure.error, item.error, item.name);
    await assert.rejects(fs.access(out), { code: "ENOENT" });
    await assert.rejects(fs.access(marker), { code: "ENOENT" });
  }
});


test("candidate acceptance requires proof of the exact applied parameter and shape-key weights", () => {
  rejectCase((x) => { x.evidence.appliedParameter = 100; });
  rejectCase((x) => { delete x.evidence.appliedParameter; });
  rejectCase((x) => { x.expected.requestedParameter = 100; });
  rejectCase((x) => { delete x.expected.requestedParameter; });
  rejectCase((x) => { delete x.evidence.shapeKeyWeights; });
  for (const key of ["Shape_headWidth_low", "Shape_headWidth_high"]) {
    rejectCase((x) => { delete x.evidence.shapeKeyWeights[key]; });
    rejectCase((x) => { x.evidence.shapeKeyWeights[key] = 1; });
  }
});
