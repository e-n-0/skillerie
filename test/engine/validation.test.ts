import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { validateRepo } from "../../src/engine/index.js";
import { sampleRepo } from "./helpers.js";

let sample: Awaited<ReturnType<typeof sampleRepo>>;
beforeEach(async () => {
  sample = await sampleRepo();
});
afterEach(async () => {
  await sample.cleanup();
});

it("reports an engine mismatch before discovering sources when a pin is incompatible", async () => {
  // Given: a repository pin outside the running engine version.
  await writeFile(join(sample.repo, "skillerie.yaml"), "version: 1\nengine: ^9.0.0\n");
  // When: validation checks compatibility at startup.
  const result = await validateRepo(sample.repo, { env: sample.env });
  // Then: an engine diagnostic identifies the authored pin.
  expect(result.diagnostics).toEqual([
    expect.objectContaining({
      code: "engine.incompatible",
      file: join(sample.repo, "skillerie.yaml"),
      jsonPath: "/engine",
    }),
  ]);
});

it("reports unknown MCP variables when a server value cannot expand", async () => {
  // Given: a server argument containing an unsupported variable.
  await writeFile(
    join(sample.repo, "mcp.json"),
    JSON.stringify({ mcpServers: { tracker: { command: "sh", args: ["${unknown}"] } } }),
  );
  // When: source values expand.
  const result = await validateRepo(sample.repo, { env: sample.env });
  // Then: the diagnostic points to the exact server argument.
  expect(result.diagnostics).toEqual([
    expect.objectContaining({
      code: "config.variable",
      file: join(sample.repo, "mcp.json"),
      jsonPath: "/mcpServers/tracker/args/0",
    }),
  ]);
});

it("reports malformed support JSON when a skill ships invalid data", async () => {
  // Given: a support file with invalid JSON syntax.
  const file = join(sample.repo, "skills/implement/references/example.json");
  await writeFile(file, '{"enabled": }');
  // When: validation checks copied source files.
  const result = await validateRepo(sample.repo, { env: sample.env });
  // Then: the source filename and one-based syntax line are retained.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "source.json", file, line: 1 }),
  );
});

it("reports a gated skill reference when it appears in an effective rule", async () => {
  // Given: one harness with a disabled skill and a rule referencing it.
  await writeFile(
    join(sample.repo, "skillerie.yaml"),
    "version: 1\nharnesses:\n  opencode: {}\nskills:\n  disabled: [outline]\n",
  );
  await writeFile(join(sample.repo, "instructions.md"), "# Instructions\n");
  await writeFile(
    join(sample.repo, "agents/auditor.md"),
    "---\nname: auditor\ndescription: Reviews a change.\n---\nReview the result.\n",
  );
  await writeFile(
    join(sample.repo, "rules/style.md"),
    "# Planning\nPrepare a plan with `/outline`.\n",
  );
  // When: validation examines effective rule references.
  const result = await validateRepo(sample.repo, { env: sample.env });
  // Then: the reference fails for its rule source, rather than silently disappearing.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "lint.reference.not-applicable",
      file: join(sample.repo, "rules/style.md"),
      jsonPath: "/body",
    }),
  );
});

it("validates asset JSONC when a harness asset is discovered", async () => {
  // Given: a malformed JSONC source in a harness asset tree.
  const directory = join(sample.repo, "harnesses/opencode/assets/example");
  await mkdir(directory, { recursive: true });
  const file = join(directory, "settings.jsonc");
  await writeFile(file, '{"enabled": }');
  // When: source syntax validation covers discovered assets.
  const result = await validateRepo(sample.repo, { env: sample.env });
  // Then: malformed copied content is reported with a source location.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "source.json", file, line: 1 }),
  );
});
