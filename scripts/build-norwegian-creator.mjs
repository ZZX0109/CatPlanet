import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { compactCreatorGlb } from "./compact-creator-glb.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const blender =
  process.env.BLENDER_BIN ||
  path.join(root, ".tools/Blender.app/Contents/MacOS/Blender");
if (process.argv.includes("--help")) {
  console.log(
    "Build the Norwegian Forest creator from the preserved local source.\nAdd --render to create Blender comparison views.\nBLENDER_BIN overrides the bundled Blender. Originals are never overwritten.",
  );
  process.exit(0);
}
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--render"))
  throw new Error("Unknown argument. Use --help for usage.");
await access(blender, constants.X_OK).catch(() => {
  throw new Error(
    "Blender is unavailable. Set BLENDER_BIN to your Blender executable.",
  );
});
await new Promise((resolve, reject) => {
  const child = spawn(
    blender,
    [
      "--background",
      "--factory-startup",
      "--disable-autoexec",
      "--threads",
      "3",
      "--python-exit-code",
      "1",
      "--python",
      path.join(root, "scripts/build-norwegian-creator.py"),
      ...(args.includes("--render") ? ["--", "--render"] : []),
    ],
    { cwd: root, stdio: "inherit" },
  );
  child.once("error", reject);
  child.once("close", (code, signal) => {
    if (code === 0) resolve();
    else
      reject(new Error(`Norwegian creator build failed (${signal || code}).`));
  });
});
console.log(JSON.stringify(await compactCreatorGlb("norwegian")));
