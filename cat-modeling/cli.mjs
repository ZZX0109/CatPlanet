#!/usr/bin/env node
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  infer,
  validate,
  preview,
  publish,
  DEFAULT_ROOT,
} from "./pipeline.mjs";
import { executeProduction, EXIT_CODES } from "./production.mjs";
export function runCli(argv) {
  const [command, ...args] = argv,
    options = { root: DEFAULT_ROOT, dryRun: false };
  const known = new Set([
      "--root",
      "--request",
      "--input-root",
      "--task",
      "--confirm",
      "--dry-run",
      "--engine",
      "--contract",
      "--file",
    ]),
    seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!known.has(key) || seen.has(key))
      throw Object.assign(Error("Unknown/duplicate option: " + key), {
        code: "INVALID_ARGUMENT",
      });
    seen.add(key);
    if (key === "--dry-run") options.dryRun = true;
    else {
      if (!args[i + 1] || args[i + 1].startsWith("--"))
        throw Object.assign(Error("Missing value: " + key), {
          code: "INVALID_ARGUMENT",
        });
      options[key === "--input-root" ? "inputRoot" : key.slice(2)] = args[++i];
    }
  }
  if (!["inspect", "infer", "validate", "preview", "publish"].includes(command))
    throw Object.assign(
      Error(
        "Usage: node cat-modeling/cli.mjs inspect|infer|validate|preview|publish [--request file --input-root dir --root jobs --dry-run]. Test fixture requires --engine fixture.",
      ),
      { code: "INVALID_ARGUMENT" },
    );
  const optionNames = [...seen];
  const permitted =
    options.engine === "fixture"
      ? new Set([
          "--engine",
          "--root",
          "--dry-run",
          ...(command === "infer"
            ? ["--request"]
            : command === "inspect"
              ? []
              : ["--task", "--confirm"]),
        ])
      : new Set([
          "--root",
          "--dry-run",
          ...(command === "inspect"
            ? ["--request", "--input-root", "--file"]
            : command === "validate"
              ? ["--request", "--input-root", "--contract", "--file"]
              : ["--request", "--input-root"]),
        ]);
  for (const name of optionNames)
    if (!permitted.has(name) && name !== "--engine")
      throw Object.assign(
        Error(`Option ${name} does not apply to ${command}`),
        { code: "INVALID_ARGUMENT" },
      );
  if (options.contract && options.request)
    throw Object.assign(Error("Choose --contract/--file or --request"), {
      code: "INVALID_ARGUMENT",
    });
  if (options.file && !options.contract && command !== "inspect")
    throw Object.assign(Error("--file requires --contract for validation"), {
      code: "INVALID_ARGUMENT",
    });
  if (options.file && options.request)
    throw Object.assign(Error("Choose --file or --request"), {
      code: "INVALID_ARGUMENT",
    });
  if (options.engine !== undefined && options.engine !== "fixture")
    throw Object.assign(
      Error("No such registered engine; production model is unavailable"),
      { code: "MODEL_UNAVAILABLE" },
    );
  if (options.engine === "fixture") {
    let result;
    if (command === "inspect")
      result = {
        engine: "fixture",
        usage: "deterministic-test-geometry",
        AI: false,
      };
    else if (command === "infer") {
      if (!options.request)
        throw Object.assign(Error("Fixture infer requires --request"), {
          code: "INVALID_ARGUMENT",
        });
      if (fs.statSync(options.request).size > 1024 * 1024)
        throw Object.assign(Error("Request exceeds 1 MiB"), {
          code: "CONTRACT_INVALID",
        });
      result = infer(
        JSON.parse(fs.readFileSync(options.request, "utf8")),
        options,
      );
    } else {
      if (!options.task)
        throw Object.assign(Error("Fixture operation requires --task"), {
          code: "INVALID_ARGUMENT",
        });
      result = { validate, preview, publish }[command](options.task, options);
    }
    return {
      ok: result.valid !== false,
      command,
      engine: "fixture",
      dryRun: options.dryRun,
      code: result.valid === false ? "FILES_INVALID" : "OK",
      result,
    };
  }
  if (options.task || options.confirm)
    throw Object.assign(
      Error(
        "Production operations require --request; --task/--confirm apply only to explicit fixture staging",
      ),
      { code: "INVALID_ARGUMENT" },
    );
  return executeProduction(command, options);
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])
) {
  try {
    const result = runCli(process.argv.slice(2));
    (result.ok ? process.stdout : process.stderr).write(
      JSON.stringify(result, null, 2) + "\n",
    );
    process.exitCode = EXIT_CODES[result.code] ?? (result.ok ? 0 : 8);
  } catch (error) {
    const code =
      EXIT_CODES[error.code] === undefined
        ? error.code === "ENOENT"
          ? "PRIVATE_ASSETS_MISSING"
          : error.code?.includes("CONTRACT") ||
              error.code?.includes("TOPOLOGY") ||
              error.code?.includes("REFERENCE")
            ? "CONTRACT_INVALID"
            : "IO_ERROR"
        : error.code;
    process.stderr.write(
      JSON.stringify(
        {
          ok: false,
          code,
          errors: [{ code: error.code ?? code, message: error.message }],
        },
        null,
        2,
      ) + "\n",
    );
    process.exitCode = EXIT_CODES[code] ?? 8;
  }
}
