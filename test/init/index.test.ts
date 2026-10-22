import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { runCli } from "../../src/cli.js";
import { loadConfig } from "../../src/config/index.js";
import type { Environment, HarnessId } from "../../src/core/types.js";

let root: string;
let repo: string;
let bin: string;
let env: Environment;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "skillerie-init-"));
  repo = join(root, "repo");
  bin = join(root, "bin");
  const home = join(root, "home");
  await Promise.all([mkdir(repo), mkdir(bin), mkdir(home)]);
  env = { HOME: home, PATH: bin };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function command(args: readonly string[] = [], engineVersion = "4.5.6") {
  const output: string[] = [];
  const errors: string[] = [];
  const code = await runCli(["init", repo, ...args], {
    env,
    engineVersion,
    stdout: (text) => {
      output.push(text);
    },
    stderr: (text) => {
      errors.push(text);
    },
  });
  return { code, stdout: output.join(""), stderr: errors.join("") };
}

it("creates a loadable scaffold when the destination does not exist", async () => {
  // Given: a fresh nested destination and an injected engine version.
  repo = join(root, "nested", "repo");
  // When: onboarding runs through the command parser.
  const result = await command([], "7.8.9");
  // Then: actual files form a valid configuration with the requested engine pin.
  expect(result.code, result.stderr).toBe(0);
  const loaded = await loadConfig(repo, env);
  expect(loaded.diagnostics).toEqual([]);
  expect(loaded.config).toMatchObject({ version: 1, starter: { enabled: true } });
  expect((await readdir(repo)).sort()).toEqual([
    ".gitignore",
    "agents",
    "instructions.md",
    "mcp.json",
    "package.json",
    "rules",
    "skillerie.yaml",
    "skills",
  ]);
  const yaml = await readFile(join(repo, "skillerie.yaml"), "utf8");
  expect(yaml.split("\n")[0]).toBe(
    "# yaml-language-server: $schema=./node_modules/skillerie/schema/skillerie.schema.json",
  );
  const document = parseDocument(yaml, { version: "1.2", uniqueKeys: true });
  expect(document.errors).toEqual([]);
  expect(document.get("starter")).toBe(true);
  expect(document.has("paths")).toBe(false);
  expect(JSON.parse(await readFile(join(repo, "package.json"), "utf8"))).toEqual({
    private: true,
    devDependencies: { skillerie: "^7.8" },
  });
  expect(JSON.parse(await readFile(join(repo, "mcp.json"), "utf8"))).toEqual({ mcpServers: {} });
  expect(await readFile(join(repo, ".gitignore"), "utf8")).toBe("generated/\n");
  expect((await stat(join(repo, "instructions.md"))).isFile()).toBe(true);
  for (const name of ["skills", "agents", "rules"]) {
    expect(await readdir(join(repo, name))).toEqual([".gitkeep"]);
    expect(await readFile(join(repo, name, ".gitkeep"), "utf8")).toBe("");
  }
  expect(
    [...result.stdout.matchAll(/npx skillerie (validate|sync|install --check)(?=\n)/g)].map(
      (match) => match[1],
    ),
  ).toEqual(["validate", "sync", "install --check"]);
});

it.each<readonly [readonly HarnessId[]]>([
  [[]],
  [["opencode"]],
  [["codex", "pi"]],
  [["opencode", "codex", "omo", "pi"]],
])("enables only executable harnesses when PATH contains %j", async (available) => {
  // Given: only the listed harness executables exist in the captured PATH.
  for (const name of available) await writeFile(join(bin, name), "", { mode: 0o755 });
  // When: onboarding performs real PATH lookup.
  const result = await command();
  // Then: loading the scaffold enables exactly the available harnesses.
  expect(result.code, result.stderr).toBe(0);
  const loaded = await loadConfig(repo, env);
  expect(loaded.diagnostics).toEqual([]);
  const enabled = Object.entries(loaded.config?.harnesses ?? {})
    .filter(([, harness]) => harness.enabled)
    .map(([name]) => name)
    .sort();
  expect(enabled).toEqual([...available].sort());
});

it("leaves a harness disabled when its PATH entry is not executable", async () => {
  // Given: a regular file and a directory use harness CLI names.
  await writeFile(join(bin, "codex"), "", { mode: 0o644 });
  await mkdir(join(bin, "pi"));
  // When: onboarding probes their availability.
  const result = await command();
  // Then: neither entry is treated as an installed CLI.
  expect(result.code, result.stderr).toBe(0);
  const loaded = await loadConfig(repo, env);
  expect(loaded.config?.harnesses.codex?.enabled).toBe(false);
  expect(loaded.config?.harnesses.pi?.enabled).toBe(false);
});

it("replaces detection when repeated and variadic harness flags are provided", async () => {
  // Given: detection would enable OpenCode, which is absent from the explicit selection.
  await writeFile(join(bin, "opencode"), "", { mode: 0o755 });
  // When: explicit selections request CLIs that are not installed.
  const result = await command(["--harness", "codex", "pi", "--harness", "omo"]);
  // Then: the complete explicit selection wins over detection.
  expect(result.code, result.stderr).toBe(0);
  const loaded = await loadConfig(repo, env);
  expect(
    Object.fromEntries(
      Object.entries(loaded.config?.harnesses ?? {}).map(([name, harness]) => [
        name,
        harness.enabled,
      ]),
    ),
  ).toEqual({ opencode: false, codex: true, omo: true, pi: true });
});

it("lists every conflicting file without writes when destinations already exist", async () => {
  // Given: multiple existing scaffold destinations and unrelated content.
  await writeFile(join(repo, "skillerie.yaml"), "version: 1\nstarter: false\n");
  await writeFile(join(repo, "package.json"), '{"private":true}\n');
  await writeFile(join(repo, "notes.md"), "# Notes\n");
  // When: onboarding runs without force.
  const result = await command();
  // Then: it lists all collisions, preserves their bytes, and creates nothing else.
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("skillerie.yaml");
  expect(result.stderr).toContain("package.json");
  expect((await readdir(repo)).sort()).toEqual(["notes.md", "package.json", "skillerie.yaml"]);
  expect(await readFile(join(repo, "skillerie.yaml"), "utf8")).toBe("version: 1\nstarter: false\n");
  expect(await readFile(join(repo, "package.json"), "utf8")).toBe('{"private":true}\n');
});

it("reports structured conflicts when JSON output is requested", async () => {
  // Given: an existing instruction file.
  await writeFile(join(repo, "instructions.md"), "# Existing\n");
  // When: onboarding runs with machine-readable output.
  const result = await command(["--json"]);
  // Then: the existing CLI envelope reports a located onboarding conflict.
  expect(result.code).toBe(1);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toMatchObject({
    valid: false,
    diagnostics: [{ code: "init.conflict", file: join(repo, "instructions.md") }],
    conflicts: ["instructions.md"],
    files: [],
  });
});

it("replaces scaffold files while preserving unrelated content when force is set", async () => {
  // Given: existing scaffold files and a user skill outside the generated file set.
  await writeFile(join(repo, "skillerie.yaml"), "version: 99\n");
  await writeFile(join(repo, "package.json"), "{}\n");
  await mkdir(join(repo, "skills"));
  await writeFile(join(repo, "skills", "custom.md"), "# Custom\n");
  // When: onboarding explicitly replaces its files.
  const result = await command(["--force"]);
  // Then: the config loads and unrelated content survives.
  expect(result.code, result.stderr).toBe(0);
  expect((await loadConfig(repo, env)).diagnostics).toEqual([]);
  expect(JSON.parse(await readFile(join(repo, "package.json"), "utf8"))).toMatchObject({
    devDependencies: { skillerie: "^4.5" },
  });
  expect(await readFile(join(repo, "skills", "custom.md"), "utf8")).toBe("# Custom\n");
});

it("rejects an unsupported harness before creating scaffold files", async () => {
  // Given: a harness name outside the command's allowed choices.
  const args = ["--harness", "unknown", "--json"];
  // When: command arguments are parsed.
  const result = await command(args);
  // Then: parsing fails with the existing argument diagnostic and no files.
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    valid: false,
    diagnostics: [{ code: "cli.arguments" }],
  });
  expect(await readdir(repo)).toEqual([]);
});

it("refuses a dangling destination symlink when force is absent", async () => {
  // Given: a scaffold filename is a symlink even though its target does not exist.
  await symlink(join(root, "missing"), join(repo, "instructions.md"));
  // When: onboarding checks for conflicts.
  const result = await command(["--json"]);
  // Then: lstat-based detection includes the existing directory entry.
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ conflicts: ["instructions.md"] });
  expect(await readdir(repo)).toEqual(["instructions.md"]);
});

it("replaces a destination symlink itself when force is set", async () => {
  // Given: a scaffold filename points to an unrelated file.
  const target = join(root, "external.md");
  await writeFile(target, "# Keep\n");
  await symlink(target, join(repo, "instructions.md"));
  // When: force explicitly replaces the scaffold.
  const result = await command(["--force"]);
  // Then: onboarding does not overwrite the symlink target.
  expect(result.code, result.stderr).toBe(0);
  expect(await readFile(target, "utf8")).toBe("# Keep\n");
});
