import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { adapter } from "../../../src/adapters/pi/index.js";
import { check } from "../../../src/adapters/pi/check.js";
import { validateRepo } from "../../../src/engine/index.js";
import { adapters } from "../../engine/helpers.js";
import { fixture } from "./helpers.js";

let sample: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  sample = await fixture();
});
afterEach(async () => {
  await sample.cleanup();
});

it("resolves native directories when the home environment is captured", () => {
  // Given: a neutral home directory.
  const env = { HOME: "/home/alice" };
  // When: resolving Pi's defaults.
  const result = adapter.defaultPaths(env);
  // Then: generated content installs under the native agent home.
  expect(result).toEqual({
    home: "/home/alice/.pi/agent",
    configDir: "/home/alice/.pi/agent",
    skillsDir: "/home/alice/.pi/agent/skills",
    agentsDir: "/home/alice/.pi/agent/agents",
    rulesDir: "/home/alice/.pi/agent/rules",
    assetsDir: "/home/alice/.pi/agent/extensions",
  });
});

it("honors the native directory override when it is present", () => {
  // Given: Pi's explicit directory override.
  const env = { HOME: "/home/alice", PI_CODING_AGENT_DIR: "/home/alice/custom-agent" };
  // When: resolving Pi paths.
  const result = adapter.defaultPaths(env);
  // Then: all runtime directories follow the override.
  expect(result.home).toBe(env.PI_CODING_AGENT_DIR);
  expect(result.skillsDir).toBe(join(env.PI_CODING_AGENT_DIR, "skills"));
});

it("describes every managed target when installation uses a stable generation", () => {
  // Given: resolved paths and the engine's stable generation root.
  const context = { ...sample.context, paths: adapter.defaultPaths({ HOME: "/home/alice" }) };
  const generation = "/home/alice/cache/current";
  // When: describing installation.
  const result = adapter.targets(context, generation);
  // Then: owned files link and managed directories use exclusive ownership.
  expect(result).toEqual([
    ...["settings.json", "mcp.json", "AGENTS.md"].map((name) => ({
      kind: "link",
      source: join(generation, "pi", name),
      target: join(context.paths.home, name),
    })),
    ...["skills", "agents", "extensions"].map((name) => ({
      kind: "exclusiveTree",
      source: join(generation, "pi", name),
      target: join(context.paths.home, name),
      preserve: [],
    })),
  ]);
});

it("blocks unsupported restrictions when the real engine validates a source agent", async () => {
  // Given: a source agent requesting an actual filesystem read-only boundary.
  await writeFile(
    join(sample.repo, "agents/auditor.md"),
    [
      "---",
      "name: auditor",
      "description: Reviews changes.",
      "readOnly: true",
      "---",
      "Review.",
    ].join("\n"),
  );
  // When: validating through the adapter capability contract.
  const result = await validateRepo(sample.repo, { env: sample.env, adapters: adapters(adapter) });
  // Then: validation refuses the unsupported permission rather than silently weakening it.
  expect(result.snapshot).toBeUndefined();
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      severity: "error",
      code: "engine.permission",
      jsonPath: "/frontmatter/readOnly",
    }),
  );
});

it("skips optional checks when the harness executable is absent", async () => {
  // Given: a missing explicit executable, independent of the machine PATH.
  const context = {
    ...sample.context,
    harnessVersion: {
      supportedRange: adapter.supportedRange,
      executable: join(sample.root, "missing-pi"),
    },
  };
  // When: checking the harness.
  const result = await check(context);
  // Then: absence is an informational skip.
  expect(result).toEqual([expect.objectContaining({ severity: "info", code: "pi.check.skipped" })]);
});

it("reports parse-only validation when the executable has no config-only check", async () => {
  // Given: a safe executable responding to --version without models or extensions.
  const context = {
    ...sample.context,
    harnessVersion: {
      supportedRange: adapter.supportedRange,
      executable: process.execPath,
    },
  };
  // When: probing CLI availability.
  const result = await check(context);
  // Then: the adapter does not claim that a version probe validates configuration.
  expect(result).toEqual([
    expect.objectContaining({ severity: "info", code: "pi.check.unsupported" }),
  ]);
});

it("reports failed checks when the executable exits unsuccessfully", async () => {
  // Given: a deterministic local executable failure.
  const executable = join(sample.root, "pi");
  await writeFile(executable, "#!/bin/sh\nexit 2\n", { mode: 0o755 });
  const context = {
    ...sample.context,
    harnessVersion: {
      supportedRange: adapter.supportedRange,
      executable,
    },
  };
  // When: probing the executable.
  const result = await check(context);
  // Then: an unexpected failure is not presented as an absent CLI.
  expect(result).toEqual([expect.objectContaining({ severity: "error", code: "pi.check.failed" })]);
});
