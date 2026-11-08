import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseContract } from "./contracts/index.mjs";
import { inspectGlb } from "./contracts/glb-inspector.mjs";
import { safeRoot, DEFAULT_ROOT } from "./pipeline.mjs";
import { sha256, jsonBytes } from "./protocol.mjs";
import { noLinks, readBoundedFile } from "./file-access.mjs";
import { validateLocalResult } from "./local-executor.mjs";
import { validatePngEvidence } from "./png-evidence.mjs";
export const EXIT_CODES = {
  OK: 0,
  INVALID_ARGUMENT: 2,
  CONTRACT_INVALID: 3,
  FILES_INVALID: 4,
  PRIVATE_ASSETS_MISSING: 5,
  MODEL_UNAVAILABLE: 6,
  PRODUCTION_PUBLISH_UNAVAILABLE: 7,
  IO_ERROR: 8,
};
export const engineStatus = {
  engine: "cat-modeling-production",
  availability: "unavailable",
  code: "MODEL_UNAVAILABLE",
  modules: {
    A: { interfaceVersion: 1, name: "morphology", state: "unavailable" },
    B: { interfaceVersion: 1, name: "coat-pattern", state: "unavailable" },
    C: { interfaceVersion: 1, name: "groom", state: "unavailable" },
  },
  trainingEnabled: false,
  inferenceEnabled: false,
  services: [],
  weights: [],
  previewExecutor: "local-blender-handoff-only",
  productionPublishEnabled: false,
};
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export function fail(code, message) {
  return Object.assign(Error(message), { code });
}
function parseDocument(bytes) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw fail("CONTRACT_INVALID", "Malformed JSON document");
  }
}
export function readDocument(file, { maxBytes = 4 * 1024 * 1024 } = {}) {
  return parseDocument(readBoundedFile(file, maxBytes, "CONTRACT_INVALID"));
}
function scopedFile(root, relative) {
  if (
    typeof relative !== "string" ||
    relative.includes("\\") ||
    path.isAbsolute(relative) ||
    relative.split("/").some((p) => p === "." || p === ".." || !p)
  )
    throw fail("FILES_INVALID", "Invalid scoped file path");
  const base = noLinks(root),
    p = noLinks(path.join(base, relative));
  if (!p.startsWith(base + path.sep))
    throw fail("FILES_INVALID", "File escapes input directory");
  return readBoundedFile(
    p,
    relative.endsWith(".json")
      ? 4 * 1024 * 1024
      : relative === "preview.png"
        ? 32 * 1024 * 1024
        : 268435456,
  );
}
function check(name, fn, checks, errors) {
  try {
    const result = fn();
    checks.push({
      name,
      state: "passed",
      details: "Checked actual local bytes",
    });
    return result;
  } catch (e) {
    const missing = e.code === "ENOENT";
    checks.push({
      name,
      state: missing ? "missing" : "failed",
      details: missing ? "Private/local artifact is absent" : e.message,
    });
    errors.push({
      code: missing ? "PRIVATE_ASSETS_MISSING" : (e.code ?? "FILES_INVALID"),
      message: `${name}: ${missing ? "artifact absent" : e.message}`,
    });
    return null;
  }
}
function imageMatches(bytes, mime) {
  return mime === "image/png"
    ? bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mime === "image/jpeg"
      ? bytes.length >= 3 &&
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[2] === 255
      : bytes.subarray(0, 4).toString() === "RIFF" &&
        bytes.subarray(8, 12).toString() === "WEBP";
}
export function validateFiles(
  request,
  { inputRoot, requirePackage = false } = {},
) {
  const r = parseContract("request", request),
    root = inputRoot ?? process.cwd(),
    checks = [
      {
        name: "request-contract",
        state: "passed",
        details: "Strict request structure and semantic constraints checked",
      },
      {
        name: "license-declaration",
        state: "passed",
        details:
          "Caller declares verified local-review authorization; independent legal verification is unrun",
      },
      {
        name: "license-evidence-review",
        state: "unrun",
        details:
          "No automated claim that consent evidence or third-party terms were independently reviewed",
      },
    ],
    errors = [];
  let manifest = null,
    outputGroom = null,
    outputAppearance = null;
  try {
    const raw = scopedFile(root, "manifest.json");
    manifest = check(
      "manifest-contract",
      () => parseContract("manifest", JSON.parse(raw)),
      checks,
      errors,
    );
  } catch (e) {
    if (e.code !== "ENOENT" || requirePackage) {
      checks.push({
        name: "manifest-contract",
        state: e.code === "ENOENT" ? "missing" : "failed",
        details:
          e.code === "ENOENT" ? "Private/local artifact is absent" : e.message,
      });
      errors.push({
        code: e.code === "ENOENT" ? "PRIVATE_ASSETS_MISSING" : "FILES_INVALID",
        message: e.message,
      });
    }
  }
  if (manifest) {
    check(
      "manifest-request-link",
      () => {
        for (const key of [
          "jobId",
          "operation",
          "modelId",
          "modelRevision",
          "templateId",
          "topologyVersion",
        ])
          if (manifest[key] !== r[key])
            throw fail("FILES_INVALID", `Manifest ${key} mismatch`);
        if (manifest.requestSha256 !== sha256(jsonBytes(r)))
          throw fail("FILES_INVALID", "Manifest request hash mismatch");
        if (
          JSON.stringify(manifest.coordinates) !==
            JSON.stringify(r.coordinates) ||
          JSON.stringify(manifest.budgets) !== JSON.stringify(r.budgets) ||
          JSON.stringify(manifest.executionBudget) !==
            JSON.stringify(r.executionBudget) ||
          JSON.stringify(manifest.dimensions) !== JSON.stringify(r.dimensions)
        )
          throw fail(
            "FILES_INVALID",
            "Manifest coordinates/dimensions/resource/execution budgets differ from request",
          );
        if (JSON.stringify(manifest.license) !== JSON.stringify(r.modelLicense))
          throw fail(
            "FILES_INVALID",
            "Manifest license declaration escalates or differs from request",
          );
        return true;
      },
      checks,
      errors,
    );
    for (const [name, ref] of Object.entries(manifest.files)) {
      check(
        "output:" + name,
        () => {
          if (ref.path !== name)
            throw fail(
              "FILES_INVALID",
              "Output must use fixed artifact filename",
            );
          const b = scopedFile(root, name);
          if (b.length !== ref.bytes || sha256(b) !== ref.sha256)
            throw fail("FILES_INVALID", "Artifact checksum/length mismatch");
          if (name.endsWith(".json")) {
            const v = parseContract(name.slice(0, -5), JSON.parse(b));
            if (name === "groom.json") outputGroom = v;
            if (name === "appearance.json") outputAppearance = v;
            if (
              name === "validation.json" &&
              (v.jobId !== r.jobId ||
                v.requestSha256 !== sha256(jsonBytes(r)) ||
                v.assetRevision !== manifest.assetRevision ||
                v.state !== "valid")
            )
              throw fail(
                "FILES_INVALID",
                "Output validation report identity/state mismatch",
              );
          }
          if (name === "preview.png") validatePngEvidence(b);
          return true;
        },
        checks,
        errors,
      );
    }
  }
  let glbBytes = null;
  const capabilities = check(
    "model.glb",
    () => {
      glbBytes = scopedFile(root, "model.glb");
      const expectedHash = requirePackage
        ? manifest?.assetRevision
        : r.modelRevision;
      if (sha256(glbBytes) !== expectedHash)
        throw fail("FILES_INVALID", "Model revision/hash mismatch");
      const info = inspectGlb(glbBytes);
      for (const [budget, actual] of [
        ["maxVertices", info.vertices],
        ["maxTriangles", info.triangles],
        ["maxJoints", info.joints],
        ["maxTextureBytes", info.textureBytes],
      ])
        if (actual > r.budgets[budget])
          throw fail("FILES_INVALID", `Resource budget exceeded: ${budget}`);
      if (
        info.meshNodeNames.filter((n) => n === r.groom.bodySurface.node)
          .length !== 1
      )
        throw fail(
          "FILES_INVALID",
          "Explicit groom bodySurface node missing/ambiguous",
        );
      for (const guide of r.groom.guides)
        if (
          guide.rootBinding.triangleIndex >=
          info.meshNodeTriangleCounts[r.groom.bodySurface.node]
        )
          throw fail(
            "FILES_INVALID",
            "Groom root triangle exceeds explicit body surface",
          );
      return info;
    },
    checks,
    errors,
  );
  if (manifest && capabilities)
    check(
      "manifest-observed-capabilities",
      () => {
        const same = (a, b) =>
          JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
        for (const [key, actual] of [
          ["morphTargets", capabilities.morphTargets],
          ["bones", capabilities.bones],
          ["animationClips", capabilities.animationClips],
          ["materialNames", capabilities.materials],
        ])
          if (!same(manifest.capabilities[key], actual))
            throw fail(
              "FILES_INVALID",
              `Declared capability differs from actual GLB: ${key}`,
            );
        if (
          JSON.stringify(manifest.capabilities.textureImages) !==
          JSON.stringify(capabilities.textureImages)
        )
          throw fail(
            "FILES_INVALID",
            "Declared texture image hashes differ from embedded GLB images",
          );
        if (
          outputAppearance &&
          (outputAppearance.templateId !== manifest.templateId ||
            outputAppearance.designSchemaVersion !==
              manifest.designSchemaVersion)
        )
          throw fail(
            "FILES_INVALID",
            "Output appearance contract identity mismatch",
          );
        if (
          outputGroom &&
          (outputGroom.topologyVersion !== manifest.topologyVersion ||
            outputGroom.groomSchemaVersion !== manifest.groomSchemaVersion ||
            outputGroom.bodySurface.node !==
              manifest.capabilities.bodySurfaceNode ||
            outputGroom.representation !==
              manifest.capabilities.groomRepresentation)
        )
          throw fail(
            "FILES_INVALID",
            "Output groom identity/representation mismatch",
          );
        if (outputGroom) {
          const triangleCount =
            capabilities.meshNodeTriangleCounts[outputGroom.bodySurface.node];
          if (!Number.isInteger(triangleCount))
            throw fail(
              "FILES_INVALID",
              "Output groom body surface absent from actual GLB",
            );
          for (const guide of outputGroom.guides) {
            if (
              guide.rootBinding.node !== outputGroom.bodySurface.node ||
              guide.rootBinding.triangleIndex >= triangleCount
            )
              throw fail(
                "FILES_INVALID",
                "Output groom root triangle exceeds actual body surface",
              );
          }
        }
        if (
          manifest.capabilities.bodySurfaceNode !== r.groom.bodySurface.node ||
          manifest.capabilities.rootBinding.node !== r.groom.bodySurface.node ||
          manifest.capabilities.rootBinding.topologyVersion !==
            r.topologyVersion
        )
          throw fail("FILES_INVALID", "Declared surface/root binding mismatch");
        return true;
      },
      checks,
      errors,
    );
  for (const ref of r.references)
    check(
      "reference:" + ref.path,
      () => {
        const bytes = scopedFile(root, ref.path);
        if (sha256(bytes) !== ref.sha256)
          throw fail("FILES_INVALID", "Reference hash mismatch");
        if (!imageMatches(bytes, ref.mediaType))
          throw fail("FILES_INVALID", "Reference MIME signature mismatch");
        return true;
      },
      checks,
      errors,
    );
  checks.push(
    {
      name: "coordinate-semantics",
      state: "unrun",
      details:
        "Finite transform/accessor checks do not measure world bounds, floor alignment or anatomical forward direction",
    },
    {
      name: "visual-acceptance",
      state: "unrun",
      details:
        "No private-asset render or visual acceptance was executed by this CLI",
    },
    {
      name: "rig-animation-semantics",
      state: "unrun",
      details:
        "Structural node/clip names do not prove animation or face-control compatibility",
    },
  );
  return {
    validationVersion: 1,
    jobId: r.jobId,
    requestSha256: sha256(jsonBytes(r)),
    state: errors.length
      ? errors.some((e) => e.code === "PRIVATE_ASSETS_MISSING")
        ? "missing-private-assets"
        : "failed"
      : "valid",
    checks,
    errors,
    assetRevision: glbBytes ? sha256(glbBytes) : null,
    capabilities,
  };
}
function handoff(request, report) {
  const script = path.join(ROOT, "scripts/render-cat-validation.py"),
    scenarioPath = path.join(ROOT, "lib/cat-visual-scenario.json");
  const scriptBytes = readBoundedFile(script, 1024 * 1024);
  const scenarioBytes = readBoundedFile(scenarioPath, 1024 * 1024);
  const scriptHash = sha256(scriptBytes);
  const scenario = parseDocument(scenarioBytes);
  return {
    handoffVersion: 1,
    jobId: request.jobId,
    executor: "miaoxing-local-blender",
    operation: "render-fixed-preview",
    state: report.errors.length
      ? "blocked-missing-or-invalid-assets"
      : "awaiting-authorized-local-source",
    invokeInCloud: false,
    requiredExecutable: "blender",
    expectedTool: {
      requiredBlenderVersion: null,
      versionResolution:
        "Must resolve exact supported version from authorized local source/manifest before execution",
      state: "unresolved",
      templateId: request.templateId,
      topologyVersion: request.topologyVersion,
    },
    command: {
      executable: "blender",
      argv: [
        "--background",
        "--disable-autoexec",
        "--threads",
        "2",
        "<approved-source.blend>",
        "--python-exit-code",
        "1",
        "--python",
        "<repository>/scripts/render-cat-validation.py",
        "--",
        "--design",
        "<isolated-job>/appearance.json",
        "--output",
        `<repository>/artifacts/local-preview-${request.jobId}`,
      ],
      shell: false,
      argvIsIllustrative: true,
      substitutionsRequireLocalValidation: true,
    },
    requiredLocalInputs: [
      {
        name: "approved-source.blend",
        state: "missing-unverified",
        sha256: null,
        authorization: "must be checked locally before execution",
      },
    ],
    script: { path: "scripts/render-cat-validation.py", sha256: scriptHash },
    requestSha256: report.requestSha256,
    assetRevision: report.assetRevision,
    coordinates: request.coordinates,
    executionBudget: request.executionBudget,
    appearance: request.appearance,
    renderContract: {
      path: "lib/cat-visual-scenario.json",
      sha256: sha256(scenarioBytes),
      scenario,
    },
    requiredOutputs: [
      ...Object.keys(scenario?.views ?? {}).map((v) => v + ".png"),
      "validation.json",
    ],
    requiredEvidence: [
      "exact Blender version",
      "render script hash",
      "input/output SHA-256",
      "actual bodySurface selection",
      "morph/rig/material/groom observations",
      "missing capabilities explicitly marked",
    ],
    checks: report.checks,
  };
}
function persistRun(
  command,
  request,
  result,
  { root = DEFAULT_ROOT, dryRun = false } = {},
) {
  if (dryRun) return null;
  const base = safeRoot(root),
    dir = noLinks(path.join(base, request.jobId));
  fs.mkdirSync(dir, { recursive: true });
  const stored = noLinks(path.join(dir, "request.json")),
    bytes = jsonBytes(request);
  try {
    fs.writeFileSync(stored, bytes, { flag: "wx" });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    if (!readBoundedFile(stored, 4 * 1024 * 1024).equals(bytes))
      throw fail("IO_ERROR", "Job ID already belongs to a different request");
  }
  const runs = noLinks(path.join(dir, "runs"));
  fs.mkdirSync(runs, { recursive: true });
  let run;
  for (let i = 1; i < 100000; i++) {
    run = path.join(runs, `run-${String(i).padStart(6, "0")}-${command}`);
    try {
      fs.mkdirSync(run);
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (i === 99999) throw fail("IO_ERROR", "Run limit reached");
    }
  }
  fs.writeFileSync(path.join(run, "result.json"), jsonBytes(result), {
    flag: "wx",
  });
  fs.writeFileSync(
    path.join(run, "execution.log.jsonl"),
    JSON.stringify({
      logVersion: 1,
      command,
      jobId: request.jobId,
      requestSha256: sha256(bytes),
      code: result.code,
      ok: result.ok,
      recordedAt: new Date().toISOString(),
      networkCalls: 0,
      trainingStarted: false,
      inferenceStarted: false,
      productionAssetsChanged: false,
    }) + "\n",
    { flag: "wx" },
  );
  if (result.result?.handoff)
    fs.writeFileSync(
      path.join(run, "blender-task.json"),
      jsonBytes(result.result.handoff),
      { flag: "wx" },
    );
  return path.relative(base, run);
}
export function executeProduction(command, options = {}) {
  if (!["inspect", "infer", "validate", "preview", "publish"].includes(command))
    throw fail("INVALID_ARGUMENT", "Unknown production command");
  const dryRun = options.dryRun === true;
  if (command === "inspect" && options.file) {
    const bytes = readBoundedFile(options.file, 268435456);
    return {
      ok: true,
      command,
      dryRun,
      code: "OK",
      result: {
        scope: "restricted-local-structural-inspection",
        sha256: sha256(bytes),
        bytes: bytes.length,
        capabilities: inspectGlb(bytes),
        visualAcceptance: "unrun",
        licenseEvidence: "unrun",
        inferenceExecuted: false,
      },
    };
  }
  if (command === "inspect" && !options.request)
    return { ok: true, command, dryRun, code: "OK", result: engineStatus };
  if (command === "validate" && options.contract) {
    if (!options.file)
      throw fail("INVALID_ARGUMENT", "--contract requires --file");
    const fileBytes = readBoundedFile(
      options.file,
      4 * 1024 * 1024,
      "CONTRACT_INVALID",
    );
    const parsed = parseContract(options.contract, parseDocument(fileBytes));
    if (options.taskFile) {
      if (options.contract !== "local-result")
        throw fail(
          "INVALID_ARGUMENT",
          "--task-file requires local-result validation",
        );
      const verification = validateLocalResult({
        task: readDocument(options.taskFile),
        result: parsed,
        inputRoot: options.inputRoot,
      });
      const code = verification.valid
        ? "OK"
        : verification.errors.some(
              (error) => error.code === "PRIVATE_ASSETS_MISSING",
            )
          ? "PRIVATE_ASSETS_MISSING"
          : "FILES_INVALID";
      return {
        ok: verification.valid,
        command,
        dryRun,
        code,
        result: verification,
      };
    }
    return {
      ok: true,
      command,
      dryRun,
      code: "OK",
      result: {
        contract: options.contract,
        contractValid: true,
        privateAssetChecks: "unrun",
        fileSha256: sha256(fileBytes),
        canonicalSha256: sha256(jsonBytes(parsed)),
      },
    };
  }
  if (!options.request)
    throw fail("INVALID_ARGUMENT", `${command} requires --request`);
  // Validate destination even in dry-run; no directories are created here.
  safeRoot(options.root ?? DEFAULT_ROOT);
  const input = readDocument(options.request);
  let r;
  try {
    r = parseContract("request", input);
  } catch (e) {
    if (
      input !== null &&
      typeof input === "object" &&
      typeof input.jobId === "string" &&
      /^job-[a-z0-9][a-z0-9-]{0,62}$/.test(input.jobId)
    ) {
      const result = {
        ok: false,
        command,
        dryRun,
        code: "CONTRACT_INVALID",
        jobId: input.jobId,
        result: {
          errors: [{ code: e.code ?? "CONTRACT_INVALID", message: e.message }],
        },
      };
      const execution = persistRun(
        command,
        { jobId: input.jobId, rejectedRequestSha256: sha256(jsonBytes(input)) },
        result,
        options,
      );
      return { ...result, ...(execution ? { execution } : {}) };
    }
    throw e;
  }
  const inputRoot =
    options.inputRoot ?? path.dirname(path.resolve(options.request));
  let result;
  if (command === "infer")
    result = {
      ok: false,
      command,
      dryRun,
      code: "MODEL_UNAVAILABLE",
      jobId: r.jobId,
      result: {
        ...engineStatus,
        message:
          "No registered production model/provider/weights exist. No inference or substitute geometry was executed.",
        requestSha256: sha256(jsonBytes(r)),
        privateAssetChecks: "unrun",
      },
    };
  else if (command === "publish")
    result = {
      ok: false,
      command,
      dryRun,
      code: "PRODUCTION_PUBLISH_UNAVAILABLE",
      jobId: r.jobId,
      result: {
        message:
          "No production publication backend or validated visual/authorization evidence is registered. Confirmation alone cannot bypass this state.",
        activeModelChanged: false,
        privateAssetChecks: "unrun",
      },
    };
  else {
    const report = validateFiles(r, {
      inputRoot,
      requirePackage: command === "validate",
    });
    const ok = !report.errors.length;
    const code = ok
      ? "OK"
      : report.state === "missing-private-assets"
        ? "PRIVATE_ASSETS_MISSING"
        : "FILES_INVALID";
    result = {
      ok,
      command,
      dryRun,
      code,
      jobId: r.jobId,
      result:
        command === "preview"
          ? {
              validation: report,
              handoff: parseContract("local-task", handoff(r, report)),
            }
          : command === "inspect"
            ? {
                engine: engineStatus,
                validation: report,
                capabilities: report.capabilities,
              }
            : report,
    };
  }
  const execution = persistRun(command, r, result, options);
  return { ...result, ...(execution ? { execution } : {}) };
}
