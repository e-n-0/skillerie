import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import { sampleRepo } from "../engine/helpers.js";

let sample: Awaited<ReturnType<typeof sampleRepo>>;
beforeEach(async () => {
  sample = await sampleRepo();
});
afterEach(async () => {
  await sample.cleanup();
});

async function command(argv: readonly string[], color?: boolean) {
  const output: string[] = [];
  const errors: string[] = [];
  const code = await runCli(argv, {
    env: sample.env,
    ...(color === undefined ? {} : { color }),
    stdout: (text) => {
      output.push(text);
    },
    stderr: (text) => {
      errors.push(text);
    },
  });
  return { code, stdout: output.join(""), stderr: errors.join("") };
}

it.each(["install", "uninstall"] as const)(
  "rejects unsupported harnesses when %s parses arguments",
  async (name) => {
    // Given: an unsupported harness selection.
    const args = [name, "--repo", sample.repo, "--harness", "unknown", "--json"];
    // When: the command parses its options.
    const result = await command(args);
    // Then: Commander failures use the same JSON error contract as validate and sync.
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      valid: false,
      diagnostics: [{ code: "cli.arguments" }],
    });
    expect(result.stderr).toBe("");
  },
);

it.each(["install", "uninstall", "status", "doctor"] as const)(
  "returns configuration diagnostics when %s loads invalid input",
  async (name) => {
    // Given: a configuration version the engine does not support.
    await writeFile(join(sample.repo, "skillerie.yaml"), "version: 99\n");
    // When: a lifecycle command loads the repository.
    const result = await command([name, "--repo", sample.repo, "--json"]);
    // Then: no command stub or unstructured output escapes the CLI boundary.
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      valid: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "config.unsupportedVersion" }),
      ]),
    });
    expect(result.stderr).toBe("");
  },
);

it("rejects a disabled harness when install selects it", async () => {
  // Given: a configured but disabled harness.
  await writeFile(
    join(sample.repo, "skillerie.yaml"),
    "version: 1\nharnesses:\n  opencode:\n    enabled: false\n",
  );
  // When: install explicitly selects that harness.
  const result = await command([
    "install",
    "--check",
    "--repo",
    sample.repo,
    "--harness",
    "opencode",
    "--json",
  ]);
  // Then: selection fails with an engine diagnostic.
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    valid: false,
    diagnostics: expect.arrayContaining([expect.objectContaining({ code: "engine.harness" })]),
  });
});

it("colors doctor diagnostics only when color is enabled", async () => {
  // Given: the same doctor run with and without color support.
  const args = ["doctor", "--repo", sample.repo];
  // When: doctor prints its diagnostics.
  const colored = await command(args, true);
  const plain = await command(args);
  // Then: severities are styled with color, and plain output has no escape codes.
  expect(colored.stderr).toContain("\x1b[1;36minfo\x1b[0m ");
  expect(plain.stderr).not.toContain("\x1b[");
  expect(plain.stderr).toMatch(/^info /m);
});
