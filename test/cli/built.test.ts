import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import type { Environment } from "../../src/core/types.js";
import { brokenCases, fakeAdapter, fixtures, sampleRepo } from "../engine/helpers.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cli = join(root, "dist/cli.js");
let sample: Awaited<ReturnType<typeof sampleRepo>>;

function execute(args: readonly string[], env: Environment = process.env) {
  return new Promise<{
    readonly code: number | null;
    readonly stdout: string;
    readonly stderr: string;
  }>((resolve, reject) => {
    const child = spawn(process.execPath, [...args], {
      cwd: root,
      env: { ...env },
      timeout: 20_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

beforeAll(async () => {
  const result = await execute([
    join(root, "node_modules/typescript/bin/tsc"),
    "-p",
    "tsconfig.build.json",
  ]);
  expect(result, result.stderr + result.stdout).toMatchObject({ code: 0 });
}, 30_000);
beforeEach(async () => {
  sample = await sampleRepo();
});
afterEach(async () => {
  await sample.cleanup();
});

function injectedCommand(args: readonly string[]) {
  const adapter = fakeAdapter();
  const script = `
    import { runCli } from ${JSON.stringify(pathToFileURL(cli).href)};
    const adapter = {
      id: "opencode",
      supportedRange: ">=1.0.0",
      capabilities: ${JSON.stringify(adapter.capabilities)},
      defaultPaths: () => (${JSON.stringify(adapter.defaultPaths(sample.env))}),
      render: async (ctx) => ({
        files: [{kind:"file", relPath:"AGENTS.md", content:ctx.model.instructions.body, mode:420}],
        diagnostics: [], metadata: {}
      }),
      targets: () => []
    };
    process.exitCode = await runCli(process.argv.slice(1), {
      adapters: new Map([["opencode", async () => ({adapter})]])
    });
  `;
  return execute(["--input-type=module", "-e", script, ...args], sample.env);
}

it("reports the package.json version when the release job re-versions the package", async () => {
  // Given: a copy of the built package whose package.json carries a release version.
  const pkg = await mkdtemp(join(tmpdir(), "skillerie-pkg-"));
  try {
    await cp(join(root, "dist"), join(pkg, "dist"), { recursive: true });
    await cp(join(root, "schema"), join(pkg, "schema"), { recursive: true });
    await symlink(join(root, "node_modules"), join(pkg, "node_modules"));
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as object;
    await writeFile(join(pkg, "package.json"), JSON.stringify({ ...manifest, version: "9.8.7" }));
    // When: Node prints the version of that copy.
    const result = await execute([join(pkg, "dist/cli.js"), "--version"]);
    // Then: the CLI reports the version written into package.json.
    expect(result).toEqual({ code: 0, stdout: "9.8.7\n", stderr: "" });
  } finally {
    await rm(pkg, { recursive: true, force: true });
  }
  // Copies the built package and starts Node, which can exceed the default under a full parallel run.
}, 20_000);

it("exits zero when the built executable validates the sample", async () => {
  // Given: the compiled CLI and an isolated sample repository.
  const args = [cli, "validate", "--repo", sample.repo];
  // When: Node executes the packaged entry point.
  const result = await execute(args, sample.env);
  // Then: validation succeeds without diagnostics.
  expect(result).toMatchObject({ code: 0, stderr: "" });
  expect(result.stdout).toMatch(/^Valid: \d+ skills?, \d+ agents?, \d+ rules? for [a-z, ]+\.\n$/);
});

it("renders all four harness directories when the built CLI uses the default registry", async () => {
  // Given: the compiled CLI and an isolated sample enabling all four harnesses.
  const args = [cli, "sync", "--repo", sample.repo];
  // When: Node syncs without an injected adapter registry.
  const result = await execute(args, sample.env);
  // Then: the active generation contains every configured harness directory.
  expect(result.code, result.stderr + result.stdout).toBe(0);
  const entries = await readdir(join(sample.repo, "generated/current"), { withFileTypes: true });
  expect(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(),
  ).toEqual(["codex", "omo", "opencode", "pi"]);
});

it.each(brokenCases)(
  "exits one when the built executable validates %s",
  async (name, code, file) => {
    // Given: a broken fixture and the built command entry point.
    const repo = join(fixtures, "broken", name);
    // When: Node validates the fixture.
    const result = await execute([cli, "validate", "--repo", repo, "--json"], sample.env);
    // Then: process status and structured source diagnostics agree.
    expect(result.code).toBe(1);
    const parsed: unknown = JSON.parse(result.stdout);
    expect(parsed).toMatchObject({
      valid: false,
      diagnostics: [{ code, file: join(repo, file) }],
    });
  },
);

it("writes real generation bytes when the built CLI uses an injected adapter", async () => {
  // Given: a compiled command with a lazy synthetic adapter.
  const args = ["sync", "--repo", sample.repo, "--json"];
  // When: the built command runs sync in a separate Node process.
  const result = await injectedCommand(args);
  // Then: the generation contains source-derived output.
  expect(result.code, result.stderr + result.stdout).toBe(0);
  expect(await readFile(join(sample.repo, "generated/current/opencode/AGENTS.md"), "utf8")).toBe(
    await readFile(join(sample.repo, "instructions.md"), "utf8"),
  );
});

it("exits zero when the built check command observes fresh output", async () => {
  // Given: output generated by the compiled command.
  const initial = await injectedCommand(["sync", "--repo", sample.repo]);
  expect(initial.code).toBe(0);
  // When: the compiled command checks unchanged sources.
  const result = await injectedCommand(["sync", "--repo", sample.repo, "--check"]);
  // Then: freshness succeeds through the real process exit status.
  expect(result).toEqual({ code: 0, stdout: "The active generation is up to date.\n", stderr: "" });
});

it("exits one when the built check command observes source drift", async () => {
  // Given: generated output followed by a source edit.
  const initial = await injectedCommand(["sync", "--repo", sample.repo]);
  expect(initial.code).toBe(0);
  await writeFile(join(sample.repo, "instructions.md"), "# Revised instructions\n");
  // When: the compiled command compares a fresh render.
  const result = await injectedCommand(["sync", "--repo", sample.repo, "--check", "--json"]);
  // Then: the process exits one and identifies the changed generated file.
  expect(result.code).toBe(1);
  const parsed: unknown = JSON.parse(result.stdout);
  expect(parsed).toMatchObject({
    valid: false,
    drift: [{ relPath: "opencode/AGENTS.md", reason: "content" }],
  });
});
