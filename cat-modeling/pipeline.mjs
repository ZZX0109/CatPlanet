import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  FIXTURE_ID,
  FIXTURE_VERSIONS,
  LICENSE,
  createFixtureGlb,
} from "./fixture.mjs";
import {
  normalizeRequest,
  parseFixtureGlb,
  sha256,
  jsonBytes,
} from "./protocol.mjs";
import { noLinks, readBoundedFile, fileError } from "./file-access.mjs";
export const DEFAULT_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "jobs",
);
const files = ["request.json", "appearance.json", "model.glb", "groom.json"];
const MAX_FILE = 4 * 1024 * 1024;
export function safeRoot(root = DEFAULT_ROOT) {
  const p = noLinks(root);
  const tmp = fs.realpathSync(os.tmpdir());
  if (!(
    p === DEFAULT_ROOT ||
    p.startsWith(DEFAULT_ROOT + path.sep) ||
    p.startsWith(tmp + path.sep)
  ))
    throw fileError(
      "INVALID_ARGUMENT",
      "Output root must be cat-modeling/jobs or a directory under the system temporary directory",
    );
  if (p === tmp)
    throw fileError(
      "INVALID_ARGUMENT",
      "Use a dedicated temporary subdirectory",
    );
  return p;
}
function taskDir(root, id) {
  if (!/^task-[0-9a-f]{24}$/.test(id))
    throw fileError("INVALID_ARGUMENT", "Invalid task ID");
  return noLinks(path.join(safeRoot(root), id));
}
function readFile(dir, name) {
  return readBoundedFile(path.join(dir, name), MAX_FILE);
}
function readJson(dir, name) {
  return JSON.parse(readFile(dir, name).toString("utf8"));
}
function bytesFor(request) {
  const model = createFixtureGlb(request.parameters);
  const taskId = "task-" + sha256(jsonBytes(request)).slice(0, 24);
  const appearance = {
    format: "miaoxing.fixture.appearance",
    ...FIXTURE_VERSIONS,
    templateId: FIXTURE_ID,
    parameters: request.parameters,
  };
  const groom = {
    groomSchemaVersion: 1,
    bodySurface: { node: "bodySurface" },
    representation: "none",
    guides: [],
    notes:
      "No native Blender hair or procedural coat is claimed by this fixture.",
  };
  const outputs = {
    "request.json": jsonBytes(request),
    "appearance.json": jsonBytes(appearance),
    "model.glb": model,
    "groom.json": jsonBytes(groom),
  };
  const manifest = {
    manifestSchemaVersion: 1,
    taskId,
    engine: FIXTURE_ID,
    ...FIXTURE_VERSIONS,
    assetRevision: sha256(model),
    files: Object.fromEntries(
      Object.entries(outputs).map(([k, v]) => [
        k,
        { sha256: sha256(v), bytes: v.length },
      ]),
    ),
    bodySurface: { node: "bodySurface" },
    capabilities: {
      morphTargets: [],
      bones: [],
      animationSemantics: {},
      faceControls: [],
      groomRepresentation: "none",
    },
    license: LICENSE,
    usage: "pipeline-test-fixture",
    productionCompatible: false,
  };
  return { taskId, outputs, manifest };
}
export function plan(requestInput, root = DEFAULT_ROOT) {
  let request;
  try {
    request = normalizeRequest(requestInput);
  } catch (error) {
    throw fileError("CONTRACT_INVALID", error.message);
  }
  const result = bytesFor(request);
  return { request, ...result, directory: taskDir(root, result.taskId) };
}
export function infer(
  requestInput,
  { root = DEFAULT_ROOT, dryRun = false } = {},
) {
  const result = plan(requestInput, root);
  if (dryRun)
    return {
      dryRun: true,
      taskId: result.taskId,
      directory: result.directory,
      files: [...files, "manifest.json", "validation.json"],
      engine: FIXTURE_ID,
    };
  fs.mkdirSync(safeRoot(root), { recursive: true });
  fs.mkdirSync(result.directory); // exclusive: never replace a previous task
  try {
    for (const [name, bytes] of Object.entries(result.outputs))
      fs.writeFileSync(path.join(result.directory, name), bytes, {
        flag: "wx",
      });
    fs.writeFileSync(
      path.join(result.directory, "manifest.json"),
      jsonBytes(result.manifest),
      { flag: "wx" },
    );
    const report = validate(result.taskId, { root });
    fs.writeFileSync(
      path.join(result.directory, "validation.json"),
      jsonBytes(report),
      { flag: "wx" },
    );
    return report;
  } catch (error) {
    throw Error(
      `Task ${result.taskId} retained for diagnosis: ${error.message}`,
    );
  }
}
export function validate(id, { root = DEFAULT_ROOT, dryRun = false } = {}) {
  const dir = taskDir(root, id),
    errors = [];
  let request, manifest, expected;
  try {
    request = normalizeRequest(readJson(dir, "request.json"));
    expected = bytesFor(request);
    manifest = readJson(dir, "manifest.json");
    if (expected.taskId !== id) errors.push("Request does not match task ID");
    // The test engine has a trusted local provenance. Never trust an edited manifest license or digest.
    if (!jsonBytes(manifest).equals(jsonBytes(expected.manifest)))
      errors.push(
        "Manifest differs from deterministic engine output (including license/capabilities)",
      );
    for (const name of files) {
      const got = readFile(dir, name);
      if (!got.equals(expected.outputs[name]))
        errors.push(`${name}: content/hash differs from deterministic output`);
    }
    parseFixtureGlb(readFile(dir, "model.glb"));
  } catch (error) {
    errors.push(error.message);
  }
  return {
    validationSchemaVersion: 1,
    taskId: id,
    valid: errors.length === 0,
    errors,
    warnings: [
      "Geometric fixture only: no production morph, rig, animation or hair; not a visual equivalence acceptance.",
      "Fixture appearance designSchemaVersion 1 is namespaced to this engine and is not creator schema v5.",
    ],
    checks: {
      request: !!request,
      deterministicArtifacts: errors.length === 0,
      glbStructure: errors.length === 0,
      licenseVerified: errors.length === 0,
    },
    assetRevision: expected?.manifest.assetRevision ?? null,
    dryRun,
  };
}
// Deterministic, script-free diagnostic image from actual GLB vertex data, not a claimed beauty render.
export function renderPreview(glbBytes) {
  const doc = parseFixtureGlb(glbBytes);
  const binStart = 28 + glbBytes.readUInt32LE(12);
  const triangles = [];
  const project = ([x, y, z]) => [
    256 + (x - z * 0.55) * 115,
    365 - (y + z * 0.18) * 115,
  ];
  for (const node of doc.nodes) {
    const mesh = doc.meshes[node.mesh];
    for (const primitive of mesh.primitives) {
      const acc = doc.accessors[primitive.attributes.POSITION],
        view = doc.bufferViews[acc.bufferView];
      for (let i = 0; i < acc.count; i += 3) {
        const v = [];
        for (let j = 0; j < 3; j++) {
          const p = [0, 1, 2].map(
            (k) =>
              glbBytes.readFloatLE(
                binStart + view.byteOffset + (i + j) * 12 + k * 4,
              ) *
                node.scale[k] +
              node.translation[k],
          );
          v.push(p);
        }
        triangles.push({
          points: v.map(project),
          depth: v.reduce((n, p) => n + p[2] + p[0] * 0.2, 0) / 3,
          name: node.name,
        });
      }
    }
  }
  triangles.sort((a, b) => a.depth - b.depth);
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#eee8df"/><text x="16" y="24" font-family="sans-serif" font-size="12">Miaoxing fixture / diagnostic projection / no groom</text>' +
    triangles
      .map(
        (t) =>
          `<polygon points="${t.points.map((p) => p.map((n) => n.toFixed(3)).join(",")).join(" ")}" fill="${t.name === "bodySurface" ? "#9c5e35" : "#b87849"}" stroke="#5d3a26" stroke-width="0.3"/>`,
      )
      .join("") +
    "</svg>\n"
  );
}
export function preview(id, { root = DEFAULT_ROOT, dryRun = false } = {}) {
  const report = validate(id, { root, dryRun });
  if (!report.valid)
    throw fileError(
      "FILES_INVALID",
      "Preview refused: " + report.errors.join("; "),
    );
  const dir = taskDir(root, id);
  const model = readFile(dir, "model.glb");
  if (sha256(model) !== report.assetRevision)
    throw Error("Asset changed during preview");
  const svg = renderPreview(model);
  const description = {
    previewSchemaVersion: 1,
    taskId: id,
    assetRevision: report.assetRevision,
    view: "fixed-oblique-orthographic",
    projection: {
      width: 512,
      height: 512,
      scale: 115,
      zToX: -0.55,
      zToY: 0.18,
    },
    lighting: "flat diagnostic colors; no physical renderer",
    design: readJson(dir, "appearance.json"),
    artifacts: { "preview.svg": sha256(svg) },
    visualAcceptance: "unreviewed",
  };
  if (!dryRun) {
    // Refuse all existing destinations before writing either artifact. This also
    // prevents a linked second destination leaving a misleading half-preview.
    for (const name of ["preview.svg", "preview.json"]) {
      const destination = noLinks(path.join(dir, name));
      try {
        fs.lstatSync(destination);
        throw Object.assign(Error("EEXIST: preview output already exists"), {
          code: "EEXIST",
        });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    fs.writeFileSync(path.join(dir, "preview.svg"), svg, { flag: "wx" });
    fs.writeFileSync(path.join(dir, "preview.json"), jsonBytes(description), {
      flag: "wx",
    });
  }
  return { dryRun, ...description };
}
export function publish(
  id,
  { root = DEFAULT_ROOT, dryRun = false, confirm } = {},
) {
  const report = validate(id, { root, dryRun });
  if (!report.valid)
    throw fileError(
      "FILES_INVALID",
      "Publish refused: " + report.errors.join("; "),
    );
  const dir = taskDir(root, id);
  const expected = bytesFor(normalizeRequest(readJson(dir, "request.json")));
  if (
    expected.taskId !== id ||
    expected.manifest.assetRevision !== report.assetRevision
  )
    throw Error("Task changed during publication");
  const manifest = expected.manifest;
  if (
    manifest.license.status !== "verified" ||
    !manifest.license.publicDistributionAllowed
  )
    throw Error("License does not permit distribution");
  const token = `stage:${id}:${report.assetRevision}`;
  const dest = noLinks(path.join(safeRoot(root), "releases", id));
  if (dryRun)
    return {
      dryRun: true,
      destination: dest,
      confirmationRequired: token,
      operation: "isolated-release-staging-only",
    };
  if (confirm !== token)
    throw fileError(
      "INVALID_ARGUMENT",
      `Explicit confirmation required: --confirm ${token}`,
    );
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.mkdirSync(dest);
  // Stage immutable deterministic bytes, never reread mutable caller artifacts after validation.
  for (const [name, bytes] of Object.entries(expected.outputs))
    fs.writeFileSync(path.join(dest, name), bytes, { flag: "wx" });
  fs.writeFileSync(
    path.join(dest, "manifest.json"),
    jsonBytes(expected.manifest),
    { flag: "wx" },
  );
  fs.writeFileSync(path.join(dest, "validation.json"), jsonBytes(report), {
    flag: "wx",
  });
  return {
    staged: true,
    destination: dest,
    activeModelChanged: false,
    productionCompatible: false,
  };
}
