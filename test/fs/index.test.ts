import { mkdtemp, readlink, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { InputSnapshot, RenderedFile, ResolvedConfig } from "../../src/core/types.js";
import { diffTree, readGeneration, swapCurrent, writeGeneration } from "../../src/fs/index.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<{ readonly writeFile: typeof writeFile }>();

  return {
    ...actual,
    writeFile: vi.fn(actual.writeFile),
  };
});

const temporaryRoots = new Set<string>();
const emptySelection = { enabled: [], disabled: [], overrides: {}, harnesses: {} };

const config = {
  version: 1,
  dialect: 1,
  starter: { enabled: true, exclude: [] },
  harnesses: {},
  paths: {
    repo: "/home/alice/config",
    home: "/home/alice",
    docs: "/home/alice/docs",
    backup: "/home/alice/.cache/skillerie/backup",
    cache: "/home/alice/.cache/skillerie",
  },
  skills: emptySelection,
  agents: emptySelection,
  rules: emptySelection,
  assets: emptySelection,
  shared: { agentsSkillsDir: "dedupe" },
  lint: {
    descriptionPrefix: { value: "Use when", severity: "warn" },
    structure: { severity: "off" },
    questions: { severity: "warn", allowProse: [] },
    references: { severity: "warn" },
  },
  generated: { commit: false },
  hooks: { postInstall: [] },
} satisfies ResolvedConfig;

function snapshot(index: number): InputSnapshot {
  const digest = index.toString(16).padStart(64, "0");

  return {
    config,
    sourceHashes: {},
    requires: [],
    engineVersion: "1.0.0",
    hash: `sha256:${digest}`,
  };
}

function file(relPath: string, content: string, mode = 0o644): RenderedFile {
  return { kind: "file", relPath, content, mode };
}

async function temporaryCache(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillerie-fs-"));
  temporaryRoots.add(root);
  return join(root, "cache");
}

afterEach(async () => {
  await Promise.all([...temporaryRoots].map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots.clear();
});

it("writes and reads file modes and symlink targets", async () => {
  // Given: rendered files include executable content and a relative symlink.
  const cacheDir = await temporaryCache();
  const files: readonly RenderedFile[] = [
    file("bin/run.sh", "#!/bin/sh\n", 0o755),
    file("skills/demo/SKILL.md", "# Demo\n"),
    { kind: "symlink", relPath: "skill-link", content: "skills/demo", mode: 0o777 },
  ];

  // When: the files are staged and read back from their generation.
  const generation = await writeGeneration(cacheDir, snapshot(1), files);
  const actual = await readGeneration(generation.dir);

  // Then: bytes, executable mode, and link target are preserved.
  expect(actual.find((entry) => entry.relPath === "bin/run.sh")).toMatchObject({
    kind: "file",
    content: Buffer.from("#!/bin/sh\n"),
    mode: 0o755,
  });
  expect(actual.find((entry) => entry.relPath === "skills/demo/SKILL.md")).toMatchObject({
    kind: "file",
    content: Buffer.from("# Demo\n"),
    mode: 0o644,
  });
  expect(actual.find((entry) => entry.relPath === "skill-link")).toMatchObject({
    kind: "symlink",
    content: "skills/demo",
  });
});

it("reuses an identical generation for the same snapshot", async () => {
  // Given: one generation already exists for a snapshot.
  const cacheDir = await temporaryCache();
  const files = [file("settings.json", "{}\n")];
  const first = await writeGeneration(cacheDir, snapshot(2), files);

  // When: the same snapshot and rendered files are written again.
  const second = await writeGeneration(cacheDir, snapshot(2), files);

  // Then: the existing generation path is returned.
  expect(second.dir).toBe(first.dir);
});

it("keeps current and previous generations while pruning older ones", async () => {
  // Given: a current generation and older, unreferenced generations.
  const cacheDir = await temporaryCache();
  const current = await writeGeneration(cacheDir, snapshot(2), [file("current.txt", "two")]);
  await swapCurrent(cacheDir, current);
  await writeGeneration(cacheDir, snapshot(1), [file("older.txt", "one")]);
  const next = await writeGeneration(cacheDir, snapshot(3), [file("next.txt", "three")]);

  // When: the next generation becomes current.
  await swapCurrent(cacheDir, next);

  // Then: current and its predecessor remain, while older output is removed.
  expect(await readlink(join(cacheDir, "current"))).toBe(relative(cacheDir, next.dir));
  expect((await readdir(join(cacheDir, "generations"))).sort()).toEqual([
    basename(current.dir),
    basename(next.dir),
  ]);
});

it("reports every supported tree difference", async () => {
  // Given: actual output with one changed entry for each difference reason.
  const cacheDir = await temporaryCache();
  const actual = await writeGeneration(cacheDir, snapshot(4), [
    file("content.txt", "actual"),
    { kind: "symlink", relPath: "kind.txt", content: "target", mode: 0o777 },
    file("mode.sh", "same", 0o644),
    file("extra.txt", "extra"),
    { kind: "symlink", relPath: "target-link", content: "actual-target", mode: 0o777 },
  ]);
  const expected: readonly RenderedFile[] = [
    file("content.txt", "expected"),
    file("kind.txt", "target"),
    file("missing.txt", "missing"),
    file("mode.sh", "same", 0o755),
    { kind: "symlink", relPath: "target-link", content: "expected-target", mode: 0o777 },
  ];

  // When: expected output is compared with the actual generation.
  const differences = await diffTree(expected, actual.dir);

  // Then: missing, extra, content, kind, target, and executable-mode drift appear.
  expect(differences).toEqual([
    { relPath: "content.txt", reason: "content" },
    { relPath: "extra.txt", reason: "extra" },
    { relPath: "kind.txt", reason: "kind" },
    { relPath: "missing.txt", reason: "missing" },
    { relPath: "mode.sh", reason: "mode" },
    { relPath: "target-link", reason: "symlink" },
  ]);
});

it("leaves the active generation unchanged when a file write fails", async () => {
  // Given: an active generation and a staged write that will fail.
  const cacheDir = await temporaryCache();
  const current = await writeGeneration(cacheDir, snapshot(5), [file("current.txt", "active")]);
  await swapCurrent(cacheDir, current);
  vi.mocked(writeFile).mockRejectedValueOnce(new Error("injected file write failure"));

  // When: writing another generation encounters the injected filesystem failure.
  await expect(
    writeGeneration(cacheDir, snapshot(6), [file("first.txt", "first"), file("fail.txt", "fail")]),
  ).rejects.toThrow("injected file write failure");

  // Then: the active pointer remains unchanged and staging is cleaned up.
  expect(await readlink(join(cacheDir, "current"))).toBe(relative(cacheDir, current.dir));
  expect((await readdir(cacheDir)).filter((name) => name.startsWith(".generation-"))).toEqual([]);
});
