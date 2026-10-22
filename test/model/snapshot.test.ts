import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { EntityRequiresResult } from "../../src/core/types.js";
import { loadConfig } from "../../src/config/index.js";
import { buildSnapshot, discoverSources } from "../../src/model/index.js";
import { config, discover, fixture, skill } from "./helpers.js";

let repo: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  repo = await fixture();
});
afterEach(async () => {
  await repo.cleanup();
});

it("hashes every input family when a source model is captured", async () => {
  // Given
  const files = [
    "skillerie.yaml",
    "instructions.md",
    "bin/helper.sh",
    "harnesses/omo/templates/settings.json",
    "harnesses/omo/assets/plugins/plugin.js",
    "harnesses/omo/seeds/ready",
  ];
  for (const file of files) await repo.put(file, "abc");
  await repo.put("skills/example/SKILL.md", skill("example"));
  await repo.put("skills/example/support.bin", Buffer.from([0, 1, 255]));
  await repo.put("agents/reviewer.md", "---\nname: reviewer\ndescription: example\n---\n");
  await repo.put("rules/shared.md", "rule");
  await repo.put("mcp.json", "{}");
  const model = await discover(repo.root);
  // When
  const snapshot = await buildSnapshot(config(repo.root), model, [], "1.0.0");
  // Then
  expect(Object.keys(snapshot.sourceHashes).sort()).toEqual(
    [
      ...files,
      "skills/example/SKILL.md",
      "skills/example/support.bin",
      "agents/reviewer.md",
      "rules/shared.md",
      "mcp.json",
    ].sort(),
  );
  expect(snapshot.sourceHashes["instructions.md"]).toBe(
    "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  expect(snapshot.sourceHashes["skills/example/support.bin"]).toBe(
    `sha256:${createHash("sha256")
      .update(Buffer.from([0, 1, 255]))
      .digest("hex")}`,
  );
});

it("hashes files under their configured source paths", async () => {
  // Given
  await repo.put("skillerie.yaml", "version: 1\nsources:\n  skills: content/skill-set\n");
  await repo.put("content/skill-set/example/SKILL.md", skill("example"));
  const loaded = await loadConfig(repo.root, { HOME: "/home/alice" });
  if (!loaded.config) throw new Error(JSON.stringify(loaded.diagnostics));
  const result = await discoverSources(repo.root, loaded.config);
  if (!result.model) throw new Error(JSON.stringify(result.diagnostics));

  // When
  const snapshot = await buildSnapshot(loaded.config, result.model, [], "1.0.0");

  // Then
  expect(snapshot.sourceHashes["content/skill-set/example/SKILL.md"]).toBeDefined();
});

it("retains source bytes when files change after discovery", async () => {
  // Given
  await repo.put("instructions.md", "abc");
  const model = await discover(repo.root);
  await repo.put("instructions.md", "changed");
  // When
  const snapshot = await buildSnapshot(config(repo.root), model, [], "1.0.0");
  // Then
  expect(snapshot.sourceHashes["instructions.md"]).toBe(
    "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

it("includes starter input hashes when a user entity replaces starter content", async () => {
  // Given
  const starter = await fixture();
  try {
    await starter.put("skills/example/SKILL.md", skill("example"));
    await starter.put("skills/example/obsolete.txt", "abc");
    await repo.put("skills/example/SKILL.md", skill("example"));
    const model = await discover(repo.root, {}, starter.root);
    // When
    const snapshot = await buildSnapshot(config(repo.root), model, [], "1.0.0");
    // Then
    expect(snapshot.sourceHashes["starter/skills/example/obsolete.txt"]).toBeDefined();
    expect(snapshot.sourceHashes["skills/example/SKILL.md"]).toBeDefined();
  } finally {
    await starter.cleanup();
  }
});

it("omits junk hashes when source trees contain ignored files", async () => {
  // Given
  await repo.put("skills/example/SKILL.md", skill("example"));
  await repo.put("skills/example/.DS_Store", "junk");
  const model = await discover(repo.root);
  // When
  const snapshot = await buildSnapshot(config(repo.root), model, [], "1.0.0");
  // Then
  expect(Object.keys(snapshot.sourceHashes)).toEqual(["skills/example/SKILL.md"]);
});

it("canonicalizes object keys when resolved configuration insertion order changes", async () => {
  // Given
  const model = await discover(repo.root);
  const first = config(repo.root, {
    paths: {
      repo: repo.root,
      home: "/home/alice",
      docs: "/home/alice/docs",
      backup: "/home/alice/backup",
      cache: "/home/alice/cache",
    },
  });
  const second = config(repo.root, {
    paths: {
      cache: "/home/alice/cache",
      backup: "/home/alice/backup",
      docs: "/home/alice/docs",
      home: "/home/alice",
      repo: repo.root,
    },
  });
  const expected = await buildSnapshot(first, model, [], "1.0.0");
  // When
  const snapshot = await buildSnapshot(second, model, [], "1.0.0");
  // Then
  expect(snapshot.hash).toBe(expected.hash);
});

it("hashes the canonical payload when the hash field itself is excluded", async () => {
  // Given
  const resolved = config(repo.root);
  const model = await discover(repo.root);
  const payload = { config: resolved, sourceHashes: {}, requires: [], engineVersion: "1.0.0" };
  const keys = new Set<string>();
  JSON.stringify(payload, (key, value: unknown) => {
    keys.add(key);
    return value;
  });
  const expected = `sha256:${createHash("sha256")
    .update(JSON.stringify(payload, [...keys].sort()))
    .digest("hex")}`;
  // When
  const snapshot = await buildSnapshot(resolved, model, [], "1.0.0");
  // Then
  expect(snapshot.hash).toBe(expected);
});

it("canonicalizes decisions when entity requirement evaluation order changes", async () => {
  // Given
  const model = await discover(repo.root);
  const decisions: readonly EntityRequiresResult[] = [
    { entityKind: "skill", name: "one", harness: "codex", result: { satisfied: true, checks: [] } },
    {
      entityKind: "rule",
      name: "two",
      harness: "omo",
      result: { satisfied: false, checks: [{ kind: "bin", name: "missing", satisfied: false }] },
    },
  ];
  const expected = await buildSnapshot(config(repo.root), model, decisions, "1.0.0");
  // When
  const snapshot = await buildSnapshot(config(repo.root), model, [...decisions].reverse(), "1.0.0");
  // Then
  expect(snapshot.hash).toBe(expected.hash);
});

it("changes the input hash when engine version changes", async () => {
  // Given
  const model = await discover(repo.root);
  const previous = await buildSnapshot(config(repo.root), model, [], "1.0.0");
  // When
  const snapshot = await buildSnapshot(config(repo.root), model, [], "2.0.0");
  // Then
  expect(snapshot.hash).not.toBe(previous.hash);
});

it("changes the input hash when a requirement result changes", async () => {
  // Given
  const model = await discover(repo.root);
  const previous = await buildSnapshot(config(repo.root), model, [], "1.0.0");
  // When
  const snapshot = await buildSnapshot(
    config(repo.root),
    model,
    [
      {
        entityKind: "skill",
        name: "example",
        harness: "codex",
        result: { satisfied: false, checks: [] },
      },
    ],
    "1.0.0",
  );
  // Then
  expect(snapshot.hash).not.toBe(previous.hash);
});

it("freezes detached input data when the snapshot is built", async () => {
  // Given
  const resolved = config(repo.root);
  const model = await discover(repo.root);
  // When
  const snapshot = await buildSnapshot(resolved, model, [], "1.0.0");
  // Then
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.config.paths)).toBe(true);
  expect(snapshot.config).not.toBe(resolved);
  expect(Object.isFrozen(resolved)).toBe(false);
});

it("includes disabled source files when the model retains excluded entities", async () => {
  // Given
  await repo.put("skills/example/SKILL.md", skill("example"));
  const resolved = config(repo.root);
  const result = await discoverSources(repo.root, {
    ...resolved,
    skills: { ...resolved.skills, disabled: ["example"] },
  });
  if (!result.model) throw new Error("Missing test model");
  // When
  const snapshot = await buildSnapshot(resolved, result.model, [], "1.0.0");
  // Then
  expect(snapshot.sourceHashes["skills/example/SKILL.md"]).toBeDefined();
});
