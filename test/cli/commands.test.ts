import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import { adapters, brokenCases, fakeAdapter, fixtures, sampleRepo } from "../engine/helpers.js";

let sample: Awaited<ReturnType<typeof sampleRepo>>;
beforeEach(async () => {
  sample = await sampleRepo();
});
afterEach(async () => {
  await sample.cleanup();
});

async function command(argv: readonly string[]) {
  const output: string[] = [];
  const errors: string[] = [];
  const code = await runCli(argv, {
    env: sample.env,
    adapters: adapters(fakeAdapter()),
    stdout: (text) => {
      output.push(text);
    },
    stderr: (text) => {
      errors.push(text);
    },
  });
  return { code, stdout: output.join(""), stderr: errors.join("") };
}

it("exits zero when validate receives the complete sample repository", async () => {
  // Given: the sample's source repository.
  const args = ["validate", "--repo", sample.repo];
  // When: the CLI validates it.
  const result = await command(args);
  // Then: a clean repository has no diagnostics.
  expect(result).toMatchObject({ code: 0, stderr: "" });
  expect(result.stdout).toMatch(/^Valid: \d+ skills?, \d+ agents?, \d+ rules? for [a-z, ]+\.\n$/);
});

it.each(brokenCases)(
  "exits one with a precise diagnostic when %s is invalid",
  async (name, code, file) => {
    // Given: one broken source repository.
    const repo = join(fixtures, "broken", name);
    // When: validate runs through the CLI.
    const result = await command(["validate", "--repo", repo]);
    // Then: output contains severity, source location, and a machine-consumed error code.
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(
      new RegExp(`^error .*(?::\\d+|#/[^ ]*) ${code.replaceAll(".", "\\.")} `),
    );
    expect(result.stderr).toContain(join(repo, file));
  },
);

it("returns structured diagnostics when validate uses JSON output", async () => {
  // Given: a schema-invalid fixture.
  const repo = join(fixtures, "broken/schema-error");
  // When: JSON validation runs.
  const result = await command(["validate", "--repo", repo, "--json"]);
  // Then: output is one parseable diagnostic envelope.
  const parsed: unknown = JSON.parse(result.stdout);
  expect(parsed).toMatchObject({
    valid: false,
    diagnostics: [{ code: "config.schema", jsonPath: "/harnesses/opencode/enabled" }],
  });
  expect(result.stderr).toBe("");
});

it("writes a generation when sync is invoked through the CLI", async () => {
  // Given: a sample repository and a registered fake adapter.
  const args = ["sync", "--repo", sample.repo, "--json"];
  // When: sync runs through the command parser.
  const result = await command(args);
  // Then: successful output names the activated generation.
  const parsed: unknown = JSON.parse(result.stdout);
  expect(result.code).toBe(0);
  expect(parsed).toMatchObject({
    valid: true,
    diagnostics: [],
    generation: { dir: expect.any(String) },
  });
});

it("exits zero when sync check matches the current generation", async () => {
  // Given: a generation created through the CLI.
  await command(["sync", "--repo", sample.repo]);
  // When: check runs against unchanged source.
  const result = await command(["sync", "--repo", sample.repo, "--check"]);
  // Then: freshness succeeds without a diagnostic.
  expect(result).toEqual({ code: 0, stdout: "The active generation is up to date.\n", stderr: "" });
});

it("exits one when sync check observes a source edit", async () => {
  // Given: an active generation and edited source instructions.
  await command(["sync", "--repo", sample.repo]);
  await writeFile(join(sample.repo, "instructions.md"), "# Changed instructions\n");
  // When: JSON check compares fresh output to current.
  const result = await command(["sync", "--repo", sample.repo, "--check", "--json"]);
  // Then: drift appears in the structured output and controls the exit status.
  const parsed: unknown = JSON.parse(result.stdout);
  expect(result.code).toBe(1);
  expect(parsed).toMatchObject({
    valid: false,
    drift: expect.arrayContaining([{ relPath: "opencode/AGENTS.md", reason: "content" }]),
  });
});

it("rejects unknown harness arguments when sync is parsed", async () => {
  // Given: an unsupported harness name.
  const args = ["sync", "--repo", sample.repo, "--harness", "example", "--json"];
  // When: Commander parses the command.
  const result = await command(args);
  // Then: argument errors remain machine-readable with exit one.
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    valid: false,
    diagnostics: [{ code: "cli.arguments" }],
  });
});
