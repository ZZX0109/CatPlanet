import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { compactCreatorGlb } from "./compact-creator-glb.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const blender =
  process.env.BLENDER36_BIN ||
  path.join(root, ".tools/Blender-3.6.app/Contents/MacOS/Blender");
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "Build the preserved Sphynx source with Blender 3.6.\nBLENDER36_BIN overrides the bundled executable. Add --render for comparison images.",
  );
  process.exit(0);
}
if (args.some((arg) => arg !== "--render"))
  throw new Error("Unknown argument. Use --help.");
await access(blender, constants.X_OK).catch(() => {
  throw new Error("Set BLENDER36_BIN to a Blender 3.6 executable.");
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
      path.join(root, "scripts/build-sphynx-creator.py"),
      ...(args.includes("--render") ? ["--", "--render"] : []),
    ],
    { cwd: root, stdio: "inherit" },
  );
  child.once("error", reject);
  child.once("close", (code, signal) =>
    code === 0
      ? resolve()
      : reject(new Error(`Sphynx build failed (${signal || code}).`)),
  );
});
console.log(JSON.stringify(await compactCreatorGlb("sphynx")));
