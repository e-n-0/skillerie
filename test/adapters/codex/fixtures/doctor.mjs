#!/usr/bin/env node
import process from "node:process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
const { parse } = await import(process.env["CHECK_TOML_MODULE"]);

const home = process.env["CODEX_HOME"];
if (!home || (await realpath(home)) !== process.cwd())
  throw new TypeError("Doctor must use an isolated home.");
const config = parse(await readFile(join(home, "config.toml"), "utf8"));
if (config["model"] !== "example-model")
  throw new TypeError("Doctor did not receive rendered settings.");
if (process.argv.slice(2).join(" ") !== "--strict-config doctor --json")
  throw new TypeError("Unexpected doctor arguments.");
await writeFile(process.env["CHECK_CAPTURE"], JSON.stringify({ home, config }));
const mode = process.env["CHECK_MODE"];
if (mode === "malformed") process.stdout.write("invalid");
else
  process.stdout.write(
    JSON.stringify({ checks: { "config.load": { status: mode === "failure" ? "error" : "ok" } } }),
  );
process.exitCode = mode === "nonzero" ? 1 : 0;
