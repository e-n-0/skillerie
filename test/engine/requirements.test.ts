import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { syncRepo, validateRepo } from "../../src/engine/index.js";
import { adapters, fakeAdapter, sampleRepo } from "./helpers.js";

let sample: Awaited<ReturnType<typeof sampleRepo>>;
beforeEach(async () => {
  sample = await sampleRepo();
});
afterEach(async () => {
  await sample.cleanup();
});

it("gates a rule off when its binary is absent from captured PATH", async () => {
  // Given: the sample's node requirement and an empty executable search directory.
  const env = { ...sample.env, PATH: join(sample.root, "missing") };
  // When: validation captures the binary probe.
  const result = await validateRepo(sample.repo, { env });
  // Then: the rule stays in inventory but is excluded from effective output.
  expect(result.diagnostics).toEqual([]);
  expect(result.model?.rules).toHaveLength(2);
  expect(result.model?.harnesses.opencode?.rules.map((rule) => rule.name)).toEqual(["style"]);
  expect(result.snapshot?.requires).toContainEqual(
    expect.objectContaining({
      name: "runtime",
      result: { satisfied: false, checks: [{ kind: "bin", name: "node", satisfied: false }] },
    }),
  );
});

it("rejects nonexecutable binary candidates when probing PATH", async () => {
  // Given: a declared binary exists but lacks executable permission.
  const bin = join(sample.root, "tools");
  await mkdir(bin);
  await writeFile(join(bin, "node"), "#!/bin/sh\n");
  await chmod(join(bin, "node"), 0o644);
  // When: requirements use that PATH directory.
  const result = await validateRepo(sample.repo, { env: { ...sample.env, PATH: bin } });
  // Then: presence alone does not satisfy the requirement.
  expect(result.model?.harnesses.opencode?.rules.map((rule) => rule.name)).toEqual(["style"]);
});

it("records a force override when a missing rule prerequisite is explicitly enabled", async () => {
  // Given: no binary can satisfy the authored requirement.
  const env = { ...sample.env, PATH: join(sample.root, "missing"), SKILLERIE_FORCE_RUNTIME: "1" };
  // When: the explicit override is captured.
  const result = await validateRepo(sample.repo, { env });
  // Then: eligibility is forced without changing the recorded probe outcome.
  expect(result.snapshot?.requires).toContainEqual(
    expect.objectContaining({
      name: "runtime",
      result: {
        satisfied: true,
        forced: true,
        checks: [{ kind: "bin", name: "node", satisfied: false }],
      },
    }),
  );
});

it("rejects an unsupported restriction when validation knows the adapter", async () => {
  // Given: a read-only agent and an adapter without runtime enforcement.
  await writeFile(
    join(sample.repo, "agents/auditor.md"),
    "---\nname: auditor\ndescription: Reviews a change.\nreadOnly: true\n---\nReview the change.\n",
  );
  const adapter = fakeAdapter();
  const limited = {
    ...adapter,
    capabilities: {
      ...adapter.capabilities,
      permissionEnforcement: { toolAllowlist: true, readOnly: false, noShell: true },
    },
  };
  // When: validate runs against this adapter registry.
  const result = await validateRepo(sample.repo, { env: sample.env, adapters: adapters(limited) });
  // Then: an enforceability diagnostic blocks the snapshot.
  expect(result.diagnostics).toEqual([
    expect.objectContaining({
      code: "engine.permission",
      file: join(sample.repo, "agents/auditor.md"),
      jsonPath: "/frontmatter/readOnly",
    }),
  ]);
});

it("rejects escaping render paths when an adapter returns invalid output", async () => {
  // Given: an adapter attempts to write outside its harness subtree.
  const adapter = {
    ...fakeAdapter(),
    render: async () => ({
      files: [{ kind: "file" as const, relPath: "../outside", content: "", mode: 0o644 }],
      diagnostics: [],
      metadata: {},
    }),
  };
  // When: sync collects the output.
  const result = await syncRepo(sample.repo, { env: sample.env, adapters: adapters(adapter) });
  // Then: validation fails before any generation is activated.
  expect(result.generation).toBeUndefined();
  expect(result.diagnostics).toEqual([
    expect.objectContaining({ code: "engine.renderPath", jsonPath: "/harnesses/opencode" }),
  ]);
});
