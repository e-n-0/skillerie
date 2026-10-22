import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { adapter } from "../../../src/adapters/omo/index.js";
import { syncRepo } from "../../../src/engine/index.js";
import { setup } from "./helpers.js";

let sample: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  sample = await setup();
  await writeFile(
    join(sample.repo, "agents/auditor.md"),
    [
      "---",
      "name: auditor",
      "description: Reviews a change.",
      "readOnly: true",
      "allowed_tools: [Read, Bash]",
      "noShell: true",
      "---",
      "Review the change.",
    ].join("\n"),
  );
});
afterEach(async () => {
  await sample.cleanup();
});

it("blocks rendering in the engine when unsupported restrictions are applicable", async () => {
  // Given: a restricted agent selected for OMO.
  // When: the real engine runs its capability preflight.
  const result = await syncRepo(sample.repo, {
    env: sample.env,
    adapters: new Map([["omo", async () => ({ adapter })]]),
    harness: "omo",
  });
  // Then: hard restrictions fail before generation; the tool allowlist only warns.
  expect(
    result.diagnostics
      .filter((item) => item.severity === "error")
      .map((item) => item.jsonPath)
      .sort(),
  ).toEqual(["/frontmatter/noShell", "/frontmatter/readOnly"]);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ severity: "warn", jsonPath: "/frontmatter/allowed_tools" }),
  );
  expect(result.generation).toBeUndefined();
});

it("renders OMO agents when allowed_tools is guidance only", async () => {
  // Given: an agent with an allowlist but no unsupported hard restrictions.
  await writeFile(
    join(sample.repo, "agents/auditor.md"),
    [
      "---",
      "name: auditor",
      "description: Reviews a change.",
      "allowed_tools: [Read, Bash]",
      "---",
      "Review the change.",
    ].join("\n"),
  );
  // When: the engine renders the agent with OMO.
  const result = await syncRepo(sample.repo, {
    env: sample.env,
    adapters: new Map([["omo", async () => ({ adapter })]]),
    harness: "omo",
  });
  // Then: only the engine warns and rendering still produces a generation.
  expect(result.diagnostics).toEqual([
    expect.objectContaining({
      severity: "warn",
      code: "engine.permission.unenforced",
      jsonPath: "/frontmatter/allowed_tools",
      message: expect.stringContaining("guidance only"),
    }),
  ]);
  expect(result.generation).toBeDefined();
});

it("renders successfully when the restricted agent is explicitly excluded", async () => {
  // Given: the same restricted source, excluded only for OMO.
  const config = join(sample.repo, "skillerie.yaml");
  await writeFile(
    config,
    (await readFile(config, "utf8")) +
      "\nagents:\n  harnesses:\n    omo:\n      disabled: [auditor]\n",
  );
  // When: engine selection removes the source from OMO applicability.
  const result = await syncRepo(sample.repo, {
    env: sample.env,
    adapters: new Map([["omo", async () => ({ adapter })]]),
    harness: "omo",
  });
  // Then: the unrepresentable agent does not block the remaining install.
  expect(result.diagnostics).toEqual([]);
  expect(result.model?.harnesses.omo?.agents.map((agent) => agent.name)).toEqual(["builder"]);
  expect(result.generation).toBeDefined();
});
