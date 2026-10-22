import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import { adapters, fakeAdapter, sampleRepo } from "../engine/helpers.js";
import { snapshot } from "./helpers.js";

const samples: Awaited<ReturnType<typeof sampleRepo>>[] = [];
afterEach(async () => {
  await Promise.all(samples.splice(0).map((sample) => sample.cleanup()));
});

async function setup(original: string) {
  const sample = await sampleRepo();
  samples.push(sample);
  const home = join(sample.root, "home", ".codex");
  await mkdir(home, { recursive: true });
  const target = join(home, "config.toml");
  await writeFile(target, original);
  await writeFile(
    join(sample.repo, "skillerie.yaml"),
    "version: 1\nharnesses:\n  codex:\n    enabled: true\n",
  );
  const adapter = {
    ...fakeAdapter("codex"),
    targets: () => [
      {
        kind: "mergeBlock" as const,
        format: "toml" as const,
        target,
        blockId: "settings",
        content: 'model = "managed"\n[tools.docs]\nenabled = true\n',
      },
      {
        kind: "mergeBlock" as const,
        format: "toml" as const,
        target,
        blockId: "servers",
        content: '[mcp_servers.docs]\nurl = "https://example.com"\n',
      },
    ],
  };
  async function command(args: readonly string[]) {
    const stdout: string[] = [],
      stderr: string[] = [];
    const code = await runCli([...args, "--repo", sample.repo], {
      env: sample.env,
      adapters: adapters(adapter),
      stdout: (value) => {
        stdout.push(value);
      },
      stderr: (value) => {
        stderr.push(value);
      },
    });
    return { code, stdout: stdout.join(""), stderr: stderr.join("") };
  }
  return { sample, home, target, command };
}

it("lists every collision in check output without writing a file", async () => {
  // Given: root and table conflicts span two sibling managed blocks.
  const f = await setup(
    'model = "local"\n[tools.docs]\nenabled = true\n' +
      '# legacy:servers:begin\n[mcp_servers.docs]\nurl = "https://example.com/old"\n# legacy:servers:end\n',
  );
  const before = await snapshot(f.home);
  // When: the real CLI command path plans installation.
  const result = await f.command(["install", "--check"]);
  // Then: each conflict has its own machine-recognizable line at the real target.
  expect(result.code).toBe(1);
  const conflicts = result.stdout.split("\n").filter((line) => line.startsWith("CONFLICT "));
  expect(conflicts.map((line) => line.split(" ").slice(0, 3).join(" "))).toEqual([
    `CONFLICT ${f.target} model`,
    `CONFLICT ${f.target} tools.docs`,
    `CONFLICT ${f.target} mcp_servers.docs`,
  ]);
  expect(result.stderr).toBe("");
  expect(await snapshot(f.home)).toEqual(before);
});

it("attributes TOML parse errors to the actual merge target", async () => {
  // Given: an invalid destination, rather than an invalid repository configuration.
  const f = await setup("model = [\n");
  // When: check mode parses that target.
  const result = await f.command(["install", "--check", "--json"]);
  // Then: the structured diagnostic identifies the destination file.
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    diagnostics: [{ code: "merge.toml", file: f.target }],
  });
});

it("restores bytes after forced CLI takeover of sibling blocks", async () => {
  // Given: a preexisting root key and two tables with legacy markers.
  const original =
    'model = "local"\n[tools.docs]\nlocal = true\n' +
    '# legacy:begin\n[mcp_servers.docs]\nurl = "https://example.com/old"\n# legacy:end\n';
  const f = await setup(original);
  // When: the CLI installs twice with force, then uninstalls normally.
  const installed = await f.command(["install", "--force"]);
  const rerun = await f.command(["install", "--force"]);
  const removed = await f.command(["uninstall"]);
  // Then: both rendered-planner merges retain the complete original preimage.
  expect([installed.code, rerun.code, removed.code]).toEqual([0, 0, 0]);
  expect(await readFile(f.target, "utf8")).toBe(original);
});
