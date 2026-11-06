/** Reproducible local creator build: Blender raw asset -> native NORMAL cage ->
 * verified, per-file atomic publication. No Next.js/cloud service is involved.
 */
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const help = `Build the local cat creator asset.

  npm run build:cat
  npm run build:cat -- --round 4
  npm run build:cat -- --check

Default round: 8. Supported reproducible rounds: 2, 3, 4, 5, 6, 7, 8.
BLENDER_BIN overrides .tools/Blender.app/Contents/MacOS/Blender.
CAT_REFINEMENT_ROUND supplies a round when --round is absent.
CAT_CREATOR_RAW overrides the assets/processed/creator-raw work directory.
--check only validates local prerequisites and prints configuration; it writes nothing.
Raw GLB, normalized GLB, reports and logs are retained per build.
`;
if (args.includes("--help") || args.includes("-h")) {
  console.log(help);
  process.exit(0);
}
let roundValue = process.env.CAT_REFINEMENT_ROUND ?? "8";
let checkOnly = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--check") checkOnly = true;
  else if (args[i] === "--round") roundValue = args[++i];
  else if (args[i].startsWith("--round=")) roundValue = args[i].slice(8);
  else throw new Error(`Unknown argument: ${args[i]}\n${help}`);
}
const round = Number(roundValue);
if (![2, 3, 4, 5, 6, 7, 8].includes(round))
  throw new Error("Choose --round 2, 3, 4, 5, 6, 7 or 8. Round 8 is the default.");
const resolve = (value) =>
  path.isAbsolute(value) ? value : path.resolve(root, value);
const relative = (value) =>
  path.relative(root, value).split(path.sep).join("/");
const rawRoot = resolve(
  process.env.CAT_CREATOR_RAW ?? "assets/processed/creator-raw",
);
const publicDir = path.join(root, "public/models/creator");
const authoredDir = path.join(root, "assets/authored");
const generator = path.join(root, "scripts/build-structural-cat.py");
const normalScript = path.join(root, "scripts/refine-creator-normals.mjs");
const sourceModel = path.join(root, "public/models/review/tabby-web.glb");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function executable(name) {
  const hasDirectory = name.includes("/") || name.includes("\\");
  const candidates = hasDirectory
    ? [resolve(name)]
    : (process.env.PATH ?? "")
        .split(path.delimiter)
        .map((directory) => path.join(directory, name));
  for (const candidate of candidates) {
    try {
      await fs.access(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* try PATH entries */
    }
  }
  throw new Error(
    `Blender executable was not found: ${name}. Set BLENDER_BIN to the installed Blender executable.`,
  );
}
function glb(bytes) {
  if (
    bytes.length < 28 ||
    bytes.readUInt32LE(0) !== 0x46546c67 ||
    bytes.readUInt32LE(8) !== bytes.length
  )
    throw new Error("Generated GLB is incomplete or invalid.");
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
}
function skinTargets(json) {
  const node = (json.nodes ?? []).find((node) => node.name === "Skin_Head");
  const mesh = json.meshes?.[node?.mesh];
  if (!mesh || mesh.primitives.length !== 1)
    throw new Error("Generated GLB lacks a single-primitive Skin_Head.");
  const names = mesh.extras?.targetNames;
  const count = mesh.primitives[0].targets?.length;
  if (
    !names?.length ||
    names.length !== count ||
    (mesh.weights && mesh.weights.length !== count)
  )
    throw new Error(
      "Skin targetNames, primitive.targets or mesh.weights have inconsistent lengths.",
    );
  for (const current of json.nodes ?? [])
    if (
      current.mesh === node.mesh &&
      current.weights &&
      current.weights.length !== count
    )
      throw new Error("Skin node.weights has an inconsistent target count.");
  return names;
}
async function run(command, commandArgs, environment, logPath) {
  const log = await fs.open(logPath, "w");
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command, commandArgs, {
        cwd: root,
        env: environment,
        stdio: ["ignore", log.fd, log.fd],
      });
      child.once("error", reject);
      child.once("close", (code, signal) =>
        code === 0
          ? resolve()
          : reject(
              new Error(
                `Process failed (${signal ?? code}); see ${relative(logPath)}`,
              ),
            ),
      );
    });
  } finally {
    await log.close();
  }
}
async function filesBelow(directory, prefix = "") {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = path.join(prefix, entry.name);
    if (entry.isDirectory())
      files.push(...(await filesBelow(path.join(directory, entry.name), name)));
    else if (entry.isFile()) files.push(name);
  }
  return files;
}
async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const blender = await executable(
    process.env.BLENDER_BIN ?? ".tools/Blender.app/Contents/MacOS/Blender",
  );
  for (const file of [generator, normalScript, sourceModel])
    await fs.access(file, constants.R_OK);
  if (checkOnly) {
    console.log(
      JSON.stringify(
        {
          checkOnly: true,
          round,
          blender,
          workDirectory: rawRoot,
          generator,
          normalScript,
          publicDir,
          authoredDir,
        },
        null,
        2,
      ),
    );
    return;
  }
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const work = path.join(rawRoot, id);
  const raw = path.join(work, "blender");
  const normalized = path.join(work, "normalized");
  const stagedSource = path.join(authoredDir, `.creator-build-${id}`);
  const rawGlb = path.join(raw, "structural-cat.glb");
  const normalizedGlb = path.join(normalized, "structural-cat.glb");
  const normalReport = path.join(work, "normal-report.json");
  const buildReport = path.join(work, "build-report.json");
  const report = {
    id,
    round,
    status: "building",
    workDirectory: relative(work),
    published: false,
  };
  const temporaries = [];
  const backups = [];
  const published = [];
  await fs.mkdir(raw, { recursive: true });
  await fs.mkdir(normalized, { recursive: true });
  await fs.mkdir(stagedSource, { recursive: true });
  await fs.writeFile(buildReport, JSON.stringify(report, null, 2));
  try {
    console.log(
      `Building cat round ${round}; raw work and logs: ${relative(work)}`,
    );
    await run(
      blender,
      [
        "--background",
        "--factory-startup",
        "--disable-autoexec",
        "--python-exit-code",
        "1",
        "--python",
        generator,
      ],
      {
        ...process.env,
        CAT_REFINEMENT_ROUND: String(round),
        CAT_CREATOR_OUT: raw,
        CAT_CREATOR_SOURCE: stagedSource,
        CAT_CREATOR_ARTIFACTS: path.join(work, "review"),
      },
      path.join(work, "blender.log"),
    );
    const rawBytes = await fs.readFile(rawGlb);
    const rawJson = glb(rawBytes);
    const rawNames = skinTargets(rawJson);
    const manifest = JSON.parse(
      await fs.readFile(path.join(raw, "manifest.json"), "utf8"),
    );
    const blend = path.join(stagedSource, "structural-cat.blend");
    if (manifest.refinementRound !== round || !(await fs.stat(blend)).size)
      throw new Error(
        "Blender output has a wrong refinement round or missing source .blend.",
      );
    if ((manifest.materialImages ?? []).some((image) => !image.packed))
      throw new Error(
        "The Blender source contains unpacked images; retain a self-contained source before publication.",
      );
    console.log("Blender finished; calculating native normal corrections.");
    await run(
      process.execPath,
      [normalScript, rawGlb, normalizedGlb, normalReport, "cage"],
      process.env,
      path.join(work, "normals.log"),
    );
    const corrected = JSON.parse(await fs.readFile(normalReport, "utf8"));
    const normalizedBytes = await fs.readFile(normalizedGlb);
    const outputJson = glb(normalizedBytes);
    const outputNames = skinTargets(outputJson);
    const verified = corrected.verification ?? {};
    if (
      corrected.sourceSha256 !== sha256(rawBytes) ||
      corrected.outputSha256 !== sha256(normalizedBytes) ||
      verified.maximumPositionDifference !== 0 ||
      verified.newComboMaximumPosition !== 0 ||
      !verified.targetArrayLengthsMatch ||
      !verified.originalMaterialsAndImagesRetained ||
      corrected.sourceTargetCount !== rawNames.length ||
      corrected.outputTargetCount !== outputNames.length
    )
      throw new Error(
        "Normal correction verification failed; the existing public model has not been changed.",
      );
    const additions = outputNames.filter((name) => !rawNames.includes(name));
    manifest.blenderPositionTargetCount = rawNames.length;
    manifest.webSkinTargetCount = outputNames.length;
    manifest.webNormalOnlyTargetCount = additions.length;
    manifest.shapeKeysScope =
      "meshes[].shapeKeys records Blender authoring POSITION keys; web Skin target count also includes computed NORMAL-only corrections";
    manifest.normalCorrections = {
      script: "scripts/refine-creator-normals.mjs",
      mode: "low-ear-cage",
      sourceSha256: corrected.sourceSha256,
      outputSha256: corrected.outputSha256,
      rawModel: relative(rawGlb),
      report: relative(normalReport),
      addedTargets: additions,
    };
    manifest.bytes = normalizedBytes.length;
    manifest.sourceSha256 = corrected.sourceSha256;
    manifest.outputSha256 = corrected.outputSha256;
    manifest.webMeshes = (outputJson.nodes ?? [])
      .filter((node) => node.mesh !== undefined)
      .map((node) => {
        const current = outputJson.meshes[node.mesh];
        return {
          name: node.name ?? current.name,
          targetCount: current.primitives[0].targets?.length ?? 0,
          vertices:
            outputJson.accessors[current.primitives[0].attributes.POSITION]
              .count,
        };
      });
    const updatedManifest = path.join(normalized, "manifest.json");
    await fs.writeFile(updatedManifest, JSON.stringify(manifest, null, 2));
    await fs.mkdir(publicDir, { recursive: true });

    // All slow generation and verification finishes before any public file is
    // replaced. Temporary files sit beside their destination for atomic rename.
    const publications = [];
    for (const name of await filesBelow(raw))
      if (!["structural-cat.glb", "manifest.json"].includes(name))
        publications.push({
          source: path.join(raw, name),
          target: path.join(publicDir, name),
          critical: false,
        });
    publications.push({
      source: blend,
      target: path.join(authoredDir, "structural-cat.blend"),
      critical: true,
    });
    publications.push({
      source: normalizedGlb,
      target: path.join(publicDir, "structural-cat.glb"),
      critical: true,
    });
    publications.push({
      source: updatedManifest,
      target: path.join(publicDir, "manifest.json"),
      critical: true,
    });
    for (const publication of publications) {
      await fs.mkdir(path.dirname(publication.target), { recursive: true });
      publication.temporary = path.join(
        path.dirname(publication.target),
        `.${path.basename(publication.target)}.${id}.tmp`,
      );
      await fs.copyFile(publication.source, publication.temporary);
      temporaries.push(publication.temporary);
      if (publication.critical) {
        const backup = path.join(
          work,
          "previous",
          publication.target.endsWith(".blend")
            ? "structural-cat.blend"
            : path.basename(publication.target),
        );
        const existed = await exists(publication.target);
        if (existed) {
          await fs.mkdir(path.dirname(backup), { recursive: true });
          await fs.copyFile(publication.target, backup);
        }
        backups.push({ target: publication.target, backup, existed });
      }
    }
    report.status = "verified";
    report.sourceSha256 = corrected.sourceSha256;
    report.outputSha256 = corrected.outputSha256;
    report.rawModel = relative(rawGlb);
    report.normalizedModel = relative(normalizedGlb);
    report.normalReport = relative(normalReport);
    await fs.writeFile(buildReport, JSON.stringify(report, null, 2));
    for (const publication of publications) {
      await fs.rename(publication.temporary, publication.target);
      published.push(publication.target);
    }
    report.published = true;
    report.status = "published";
    await fs.writeFile(buildReport, JSON.stringify(report, null, 2));
    console.log(
      `Published ${relative(publicDir)}/structural-cat.glb (${normalizedBytes.length} bytes).`,
    );
    console.log(
      `Blender keys ${rawNames.length}; web Skin targets ${outputNames.length}; added normal-only ${additions.length}. Report: ${relative(buildReport)}`,
    );
  } catch (error) {
    // Auxiliary images are embedded in the GLB and are tool copies only. Restore
    // every critical file that this attempt actually replaced if publication fails.
    const rollbackErrors = [];
    for (const backup of backups.reverse())
      if (published.includes(backup.target)) {
        try {
          if (backup.existed) {
            const temporary = `${backup.target}.${id}.rollback.tmp`;
            await fs.copyFile(backup.backup, temporary);
            await fs.rename(temporary, backup.target);
          } else await fs.rm(backup.target, { force: true });
        } catch (rollback) {
          rollbackErrors.push(
            `${relative(backup.target)}: ${rollback.message}`,
          );
        }
      }
    report.status = "failed";
    report.published = false;
    report.error = error.message;
    report.rollbackErrors = rollbackErrors;
    await fs
      .writeFile(buildReport, JSON.stringify(report, null, 2))
      .catch(() => {});
    throw new Error(
      `${error.message}\nBuild files retained at ${relative(work)}.${rollbackErrors.length ? `\nRollback needs attention: ${rollbackErrors.join("; ")}` : "\nThe previous public model is preserved."}`,
    );
  } finally {
    for (const temporary of temporaries)
      await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
