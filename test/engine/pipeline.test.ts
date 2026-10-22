import { readFile, readlink, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { syncRepo, validateRepo } from "../../src/engine/index.js";
import { adapters, brokenCases, fakeAdapter, fixtures, sampleRepo } from "./helpers.js";

let sample: Awaited<ReturnType<typeof sampleRepo>>;
beforeEach(async () => {
  sample = await sampleRepo();
});
afterEach(async () => {
  await sample.cleanup();
});

it("validates the complete sample when all source kinds are present", async () => {
  // Given: a complete synthetic repository and a captured executable search path.
  const { repo, env } = sample;
  // When: validation runs through configuration, discovery, lints, and probes.
  const result = await validateRepo(repo, { env });
  // Then: all source inventories and requirement decisions reach the snapshot.
  expect(result.diagnostics).toEqual([]);
  expect(result.model?.skills).toHaveLength(3);
  expect(result.model?.agents).toHaveLength(2);
  expect(result.model?.rules).toHaveLength(2);
  expect(Object.keys(result.model?.templates ?? {})).toHaveLength(4);
  expect(result.snapshot?.requires).toContainEqual(
    expect.objectContaining({
      entityKind: "rule",
      name: "runtime",
      harness: "opencode",
      result: { satisfied: true, checks: [{ kind: "bin", name: "node", satisfied: true }] },
    }),
  );
  expect(result.model?.mcp?.mcpServers["tracker"]?.args).toEqual([join(repo, "bin/tracker.sh")]);
});

it.each(brokenCases)(
  "reports one located error when validating the %s fixture",
  async (directory, code, file, jsonPath) => {
    // Given: a repository with one invalid behavior.
    const repo = join(fixtures, "broken", directory);
    // When: the real pipeline validates it.
    const result = await validateRepo(repo, { env: sample.env });
    // Then: one precise error blocks snapshot creation.
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ severity: "error", code, file: join(repo, file), jsonPath }),
    ]);
    expect(result.snapshot).toBeUndefined();
  },
);

it("activates generation output when an enabled adapter is registered", async () => {
  // Given: a sample repository and a lazy renderer.
  const options = { env: sample.env, adapters: adapters(fakeAdapter()) };
  // When: sync completes.
  const result = await syncRepo(sample.repo, options);
  // Then: a stable pointer exposes the renderer's namespaced output.
  expect(result.diagnostics).toEqual([]);
  expect(result.generation?.hash).toBe(result.snapshot?.hash);
  expect(await readlink(join(sample.repo, "generated/current"))).toBe(
    `generations/${result.snapshot?.hash.slice("sha256:".length)}`,
  );
  expect(await readFile(join(sample.repo, "generated/current/opencode/AGENTS.md"), "utf8")).toBe(
    [
      result.model?.instructions?.body ?? "",
      ...(result.model?.harnesses.opencode?.rules.map((rule) => rule.body) ?? []),
    ].join("\n"),
  );
});

it("reports no drift when the rendered output is current", async () => {
  // Given: a freshly activated sample generation.
  const options = { env: sample.env, adapters: adapters(fakeAdapter()) };
  await syncRepo(sample.repo, options);
  const before = await readdir(join(sample.repo, "generated/generations"));
  // When: check renders into a temporary generation.
  const result = await syncRepo(sample.repo, { ...options, check: true });
  // Then: no output is activated or added to the repository cache.
  expect(result.diagnostics).toEqual([]);
  expect(result.drift).toEqual([]);
  expect(await readdir(join(sample.repo, "generated/generations"))).toEqual(before);
});

it("reports drift without activation when a source changes", async () => {
  // Given: generated output followed by an instructions edit.
  const options = { env: sample.env, adapters: adapters(fakeAdapter()) };
  await syncRepo(sample.repo, options);
  const current = await readlink(join(sample.repo, "generated/current"));
  await writeFile(join(sample.repo, "instructions.md"), "# Updated instructions\n");
  // When: check renders the changed source.
  const result = await syncRepo(sample.repo, { ...options, check: true });
  // Then: source-derived bytes differ and the active pointer stays fixed.
  expect(result.drift).toContainEqual({ relPath: "opencode/AGENTS.md", reason: "content" });
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ severity: "error", code: "sync.drift", line: 1 }),
  );
  expect(await readlink(join(sample.repo, "generated/current"))).toBe(current);
});

it("reports missing output without creating cache when no generation exists", async () => {
  // Given: a sample without generated output.
  const options = { env: sample.env, adapters: adapters(fakeAdapter()), check: true };
  // When: freshness is checked.
  const result = await syncRepo(sample.repo, options);
  // Then: every rendered entry is missing and no cache directory is created.
  expect(result.drift).toEqual([
    { relPath: "opencode/AGENTS.md", reason: "missing" },
    { relPath: "opencode/snapshot.json", reason: "missing" },
  ]);
  await expect(readdir(join(sample.repo, "generated"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("renders all registered enabled harnesses when sync is unfiltered", async () => {
  // Given: independent renderers for all configured harnesses.
  const registry = adapters(...(["opencode", "codex", "omo", "pi"] as const).map(fakeAdapter));
  // When: sync has no harness filter.
  const result = await syncRepo(sample.repo, { env: sample.env, adapters: registry });
  // Then: each harness owns one generation subtree.
  expect(result.diagnostics).toEqual([]);
  expect((await readdir(join(sample.repo, "generated/current"))).sort()).toEqual([
    "codex",
    "omo",
    "opencode",
    "pi",
  ]);
});

it("checks only selected output when current contains other harnesses", async () => {
  // Given: a full generation with two registered harnesses.
  const options = { env: sample.env, adapters: adapters(fakeAdapter(), fakeAdapter("pi")) };
  await syncRepo(sample.repo, options);
  // When: check selects just one renderer.
  const result = await syncRepo(sample.repo, { ...options, check: true, harness: "opencode" });
  // Then: unrelated harness files do not count as extra output.
  expect(result.drift).toEqual([]);
});

it("stops before activation when a renderer returns an error", async () => {
  // Given: an active generation and a renderer that reports invalid input.
  const options = { env: sample.env, adapters: adapters(fakeAdapter()) };
  await syncRepo(sample.repo, options);
  const current = await readlink(join(sample.repo, "generated/current"));
  const failing = {
    ...fakeAdapter(),
    render: async () => ({
      files: [],
      diagnostics: [
        { severity: "error" as const, code: "example.invalid", message: "Invalid input." },
      ],
      metadata: {},
    }),
  };
  // When: a later sync encounters the diagnostic.
  const result = await syncRepo(sample.repo, { env: sample.env, adapters: adapters(failing) });
  // Then: the error is returned and the active generation is retained.
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "example.invalid" }));
  expect(await readlink(join(sample.repo, "generated/current"))).toBe(current);
});
