#!/usr/bin/env node
/** Explicit offline fixture calibration, independent of existing infer/production CLI. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createFixtureGlb, DEFAULT_PARAMETERS } from "../fixture.mjs";
import {
  observePng,
  compareObservations,
  proposeHeadWidths,
  decideCandidate,
  sha256,
} from "./controller.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
function noLinks(p) {
  const abs = path.resolve(p);
  let cur = path.parse(abs).root;
  for (const part of abs.slice(cur.length).split(path.sep).filter(Boolean)) {
    cur = path.join(cur, part);
    try {
      if (fs.lstatSync(cur).isSymbolicLink())
        throw Error("Symlink path refused");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  return abs;
}
function writeJson(file, v) {
  fs.writeFileSync(file, JSON.stringify(v, null, 2) + "\n", { flag: "wx" });
}
async function main() {
  const args = process.argv.slice(2),
    options = { maxRounds: 6, blender: "blender" };
  let demo = false;
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!["--demo", "--out", "--max-rounds", "--blender"].includes(flag))
      throw Error(
        "Only explicit fixture --demo [--out NEW_DIRECTORY] [--max-rounds 1..6] [--blender LOCAL_EXECUTABLE] is supported",
      );
    if (seen.has(flag)) throw Error("Duplicate " + flag);
    seen.add(flag);
    if (flag === "--demo") {
      demo = true;
      continue;
    }
    const value = args[++i];
    if (!value || value.startsWith("--"))
      throw Error("Missing value for " + flag);
    if (flag === "--out") options.out = value;
    else if (flag === "--max-rounds") options.maxRounds = Number(value);
    else options.blender = value;
  }
  if (options.blender.includes("://") || options.blender.startsWith("-"))
    throw Error("Local Blender executable required");
  if (!demo)
    throw Error(
      "Explicit --demo required: no real-photo interpretation or real-cat model is available",
    );
  if (
    !Number.isInteger(options.maxRounds) ||
    options.maxRounds < 1 ||
    options.maxRounds > 6
  )
    throw Error("max-rounds must be integer1..6");
  const jobs = noLinks(path.resolve(HERE, "../jobs")),
    out = noLinks(options.out ?? path.join(jobs, "vision-poc-" + randomUUID()));
  const tmp = fs.realpathSync(os.tmpdir());
  if (!out.startsWith(jobs + path.sep) && !out.startsWith(tmp + path.sep))
    throw Error(
      "Fresh output must be below cat-modeling/jobs or a temporary subdirectory",
    );
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.mkdirSync(out);
  const source = path.join(out, "source.glb"),
    base = path.join(out, "base.blend"),
    worker = path.join(HERE, "worker.py");
  fs.writeFileSync(source, createFixtureGlb(DEFAULT_PARAMETERS), {
    flag: "wx",
  });
  const sourceHash = sha256(fs.readFileSync(source)),
    workerHash = sha256(fs.readFileSync(worker));
  function invoke(mode, id, round, parameter, baseHash) {
    const folder = path.join(out, id),
      argv = [
        "--background",
        "--factory-startup",
        "--disable-autoexec",
        "--threads",
        "2",
        "--python-exit-code",
        "1",
        "--python",
        worker,
        "--",
        "--mode",
        mode,
        "--source",
        source,
        "--base",
        base,
        "--out",
        folder,
        "--candidate-id",
        id,
        "--round",
        String(round),
      ];
    if (parameter !== undefined) argv.push("--parameter", String(parameter));
    if (baseHash) argv.push("--base-sha256", baseHash);
    try {
      const stdout = execFileSync(options.blender, argv, {
        encoding: "utf8",
        timeout: 120000,
        maxBuffer: 16 * 1024 * 1024,
      });
      fs.writeFileSync(path.join(folder, "worker.log"), stdout, { flag: "wx" });
    } catch (e) {
      fs.writeFileSync(
        path.join(out, id + ".failed.log"),
        String(e.stdout ?? "") +
          "\n" +
          String(e.stderr ?? "") +
          "\n" +
          e.message,
        { flag: "wx" },
      );
      throw e;
    }
    return {
      folder,
      report: JSON.parse(
        fs.readFileSync(
          path.join(folder, mode === "init" ? "base.json" : "render.json"),
          "utf8",
        ),
      ),
    };
  }
  const init = invoke("init", "initialize", 0),
    baseline = init.report,
    baseHash = sha256(fs.readFileSync(base));
  if (baseline.baseSha256 !== baseHash || baseline.sourceSha256 !== sourceHash)
    throw Error("Initialization identity mismatch");
  async function observe(render) {
    const observations = {};
    for (const view of ["front", "three"]) {
      const image = path.join(render.folder, view + ".png");
      observations[view] = await observePng(image);
      if (observations[view].sha256 !== render.report.images[view].sha256)
        throw Error("Stale or mutated rendered image");
      for (const [suffix, mask] of [
        ["head-mask", observations[view].headMask],
        ["silhouette-mask", observations[view].silhouetteMask],
      ])
        await sharp(
          Buffer.from(mask).map((v) => v * 255),
          {
            raw: {
              width: observations[view].width,
              height: observations[view].height,
              channels: 1,
            },
          },
        )
          .png()
          .toFile(path.join(render.folder, view + "." + suffix + ".png"));
    }
    return observations;
  }
  const referenceRender = invoke(
      "reference",
      "reference",
      0,
      undefined,
      baseHash,
    ),
    reference = await observe(referenceRender);
  const initialRender = invoke("render", "baseline", 0, 50, baseHash);
  let observations = await observe(initialRender),
    metrics = Object.fromEntries(
      ["front", "three"].map((v) => [
        v,
        compareObservations(observations[v], reference[v]),
      ]),
    ),
    current = 50;
  const initialMetrics = structuredClone(metrics),
    rounds = [];
  let stopReason = "round-budget-reached";
  for (let round = 1; round <= options.maxRounds; round++) {
    const candidates = [];
    for (const parameter of proposeHeadWidths(current)) {
      const candidateId = `round-${round}-headWidth-${parameter}`,
        render = invoke("render", candidateId, round, parameter, baseHash),
        seen = await observe(render),
        candidateMetrics = Object.fromEntries(
          ["front", "three"].map((v) => [
            v,
            compareObservations(seen[v], reference[v]),
          ]),
        ),
        expected = {
          requestedParameter: parameter,
          candidateId,
          round,
          baseSha256: baseHash,
          sourceSha256: sourceHash,
          topologyHash: baseline.topologyHash,
          uvHash: baseline.uvHash,
          configurationHash: baseline.configurationHash,
        };
      const decision = decideCandidate({
        currentParameter: current,
        candidateParameter: parameter,
        currentMetrics: metrics,
        candidateMetrics,
        expected,
        evidence: render.report,
      });
      candidates.push({
        candidateId,
        parameter,
        metrics: candidateMetrics,
        decision,
        renderDirectory: path.relative(out, render.folder),
        imageHashes: Object.fromEntries(
          ["front", "three"].map((v) => [v, seen[v].sha256]),
        ),
        evidence: render.report,
      });
    }
    const accepted = candidates
      .filter((c) => c.decision.accepted)
      .sort(
        (a, b) =>
          a.metrics.front.loss - b.metrics.front.loss ||
          a.metrics.three.loss - b.metrics.three.loss,
      )[0];
    const record = {
      round,
      beforeParameter: current,
      beforeMetrics: metrics,
      candidates,
      acceptedCandidateId: accepted?.candidateId ?? null,
      afterParameter: accepted?.parameter ?? current,
    };
    rounds.push(record);
    writeJson(path.join(out, `round-${round}.json`), record);
    if (!accepted) {
      stopReason = "no-candidate-passed-training-heldout-and-structure-gates";
      break;
    }
    current = accepted.parameter;
    metrics = accepted.metrics;
    if (metrics.front.loss <= 1e-8 && metrics.three.loss <= 1e-8) {
      stopReason = "image-objective-matched-on-training-and-heldout";
      break;
    }
  }
  const finalDirectory =
    rounds.findLast((r) => r.acceptedCandidateId)?.acceptedCandidateId ??
    "baseline";
  const panels = [];
  for (const [row, view] of ["front", "three"].entries())
    for (const [col, folder] of [
      "baseline",
      "reference",
      finalDirectory,
    ].entries()) {
      panels.push({
        input: fs.readFileSync(path.join(out, folder, view + ".png")),
        left: col * 256,
        top: row * 280 + 24,
      });
      const label = Buffer.from(
        `<svg width="256" height="24"><rect width="256" height="24" fill="white"/><text x="8" y="17" font-size="12">${view} / ${col === 0 ? "baseline50" : col === 1 ? "reference" : "accepted" + current}</text></svg>`,
      );
      panels.push({ input: label, left: col * 256, top: row * 280 });
    }
  await sharp({
    create: { width: 768, height: 560, channels: 4, background: "#e9edf1" },
  })
    .composite(panels)
    .png()
    .toFile(path.join(out, "comparison.png"));
  const report = {
    comparison: {
      file: "comparison.png",
      sha256: sha256(fs.readFileSync(path.join(out, "comparison.png"))),
    },
    pocVersion: 1,
    experiment: "offline-geometric-fixture-headwidth-calibration",
    out,
    teacherParameterAvailableToPlanner: false,
    developmentValidationViewIsNotBlindTest: true,
    blenderExecutable: options.blender,
    plannerInputs: "actual PNG red-head ID masks and alpha silhouettes only",
    genuinePhotoUnderstanding: false,
    existingModelEdited: false,
    baseInitializedOnce: true,
    basePath: "base.blend",
    baseSha256: baseHash,
    sourceSha256: sourceHash,
    workerSha256: workerHash,
    baseHashUnchanged: sha256(fs.readFileSync(base)) === baseHash,
    sourceHashUnchanged: sha256(fs.readFileSync(source)) === sourceHash,
    frozenConfigurationHash: baseline.configurationHash,
    parameterMapping:
      "Project-style max(0,(50-v)/50) low and max(0,(v-50)/50) high; fixture-specific x-scale delta0.35, no claim of real-cat semantics",
    baseline: {
      parameter: 50,
      metrics: initialMetrics,
      imageHashes: Object.fromEntries(
        ["front", "three"].map((v) => [
          v,
          initialRender.report.images[v].sha256,
        ]),
      ),
    },
    reference: {
      directory: "reference",
      imageHashes: Object.fromEntries(
        ["front", "three"].map((v) => [v, reference[v].sha256]),
      ),
    },
    rounds,
    final: { parameter: current, metrics, stopReason },
    tools: baseline.tools,
    geometryChecks: baseline,
    remainingGates: {
      rig: "UNRUN",
      groom: "UNRUN",
      petIdentity: "UNRUN",
      physicalMaterial: "UNRUN",
      photoUnderstanding: "UNRUN",
      productionCompatibility: "UNRUN",
    },
    approved: false,
    productionReady: false,
    limitations: [
      "Self-authored cuboid fixture; not a realistic cat or a VLM",
      "ID color masking is allowed only for this rendered fixture; real pet photos unsupported",
      "Only one real headWidth shape-key pair is editable",
      "Reference created by a hidden fixture teacher; planner reads rendered masks, never teacher parameter",
      "Heldout view is a fixed synthetic camera, not independent real-world data",
      "UV inventory may be empty and is reported as such, not replaced with fake UVs",
      "Rig, groom, identity and production visual quality remain unvalidated",
    ],
  };
  if (sha256(fs.readFileSync(worker)) !== workerHash)
    throw Error("Worker changed during calibration");
  if (!report.baseHashUnchanged || !report.sourceHashUnchanged)
    throw Error("Immutable base/source changed");
  writeJson(path.join(out, "report.json"), report);
  process.stdout.write(
    JSON.stringify(
      {
        out,
        report: path.join(out, "report.json"),
        baselineParameter: 50,
        finalParameter: current,
        baselineMetrics: initialMetrics,
        finalMetrics: metrics,
        rounds: rounds.length,
        stopReason,
        approved: false,
        productionReady: false,
      },
      null,
      2,
    ) + "\n",
  );
}
main().catch((e) => {
  process.stderr.write(
    JSON.stringify({
      ok: false,
      error: e.message,
      modelUnavailableForRealInputs: true,
    }) + "\n",
  );
  process.exitCode = 1;
});
