/** Fixed native geometry, direct-only fixtures. Never a beauty acceptance. */
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const round4 = process.argv.includes("--round4");
const sourceMode = round4 ? "source-round4" : "source-round";
const output = round4 ? "artifacts/native-groom-capture/optics-direct-sweep-round4" : "artifacts/native-groom-capture/optics-direct-sweep-analytic";
await mkdir(output, { recursive: true });
const results = [];
for (const light of ["front", "side", "back"]) {
  for (const optics of ["broad", sourceMode]) {
    const target = `${output}/${optics}-${light}`;
    const args = ["scripts/probe-real-native-groom.mjs", "--capture", "artifacts/native-groom-capture/kitten-original-viewport-child8", "--body", "artifacts/native-groom-capture/kitten-original-viewport/body-pbr-static.glb", "--output", target, "--views", "head-chest", "--optics", optics, "--lighting", `direct-${light}`];
    const child = spawnSync(process.execPath, args, { encoding: "utf8", maxBuffer: 1024 * 1024 });
    await writeFile(`${output}/${optics}-${light}.log`, `${child.stdout ?? ""}${child.stderr ?? ""}`);
    if (child.status !== 0) throw Error(`Actual native direct fixture failed: ${optics}/${light}: ${child.stderr}`);
    const report = JSON.parse(await readFile(`${target}/report.json`, "utf8"));
    results.push({ optics, light, report: `${target}/report.json`, errors: report.errors, sourceRows: report.setup.sourceRows, frames: report.frames.length, samplingPolicy: report.setup.samplingPolicy });
    console.log(JSON.stringify({ complete: `${optics}/${light}`, frames: report.frames.length, errors: report.errors }));
  }
}
await writeFile(`${output}/report.json`, JSON.stringify({ status: "direct response isolation only; no environment/area-light/path tracing/self-shadow equivalence", results }, null, 2) + "\n");
