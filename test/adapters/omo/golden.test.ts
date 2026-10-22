import { access, appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { adapter } from "../../../src/adapters/omo/index.js";
import { syncRepo } from "../../../src/engine/index.js";
import { readGeneration } from "../../../src/fs/index.js";
import { setup } from "./helpers.js";

const goldenDir = fileURLToPath(new URL("../../golden/omo/", import.meta.url));
let sample: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  sample = await setup();
  await appendFile(
    join(sample.repo, "skills/outline/references/checklist.md"),
    [
      "",
      'Use `Glob(pattern="*.md", path="/home/alice/notes")` to list notes.',
      'Use `Glob(pattern="*.md", path="$DIR")` to list runtime notes.',
      '- `Glob("**/skills/*/SKILL.md")`',
      'Use `Grep(pattern="TODO", path="$DIR", glob="*.ts")` to search sources.',
      '<interaction>AskUserQuestion(header="Worktree", question="Choose a worktree?", options=[one entry per worktree])</interaction>',
      "",
      "```text",
      'Grep(pattern="TODO", path="src", glob="*.ts", output_mode="content")',
      "```",
      "",
    ].join("\n"),
  );
});
afterEach(async () => {
  await sample.cleanup();
});

it("matches committed OMO output when the real engine renders the sample repository", async () => {
  // Given: the shared neutral fixture with only this adapter injected.
  const registry = new Map([["omo" as const, async () => ({ adapter })]]);
  // When: the engine discovers, resolves, renders, stages, and activates OMO.
  const result = await syncRepo(sample.repo, {
    env: sample.env,
    adapters: registry,
    harness: "omo",
  });
  expect(result.diagnostics).toEqual([]);
  const dir = result.generation?.dir;
  if (dir === undefined) throw new TypeError("No generation was produced.");
  const entries = await readGeneration(join(dir, "omo"));
  const normalize = (text: string) =>
    text
      .replaceAll(sample.repo, "/home/alice/repo")
      .replaceAll(sample.env["HOME"] ?? "unused-home", "/home/alice");
  const tree = entries.map(({ relPath, kind, mode }) => ({ relPath, kind, mode }));
  if (process.env["UPDATE_GOLDEN"] === "1") {
    await mkdir(goldenDir, { recursive: true });
    for (const entry of entries) {
      const target = join(goldenDir, entry.relPath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, normalize(entry.content.toString()));
    }
    await writeFile(join(goldenDir, ".manifest.json"), JSON.stringify(tree, null, 2) + "\n");
  }
  // Then: the entire generated tree, entry types, modes, and normalized bytes match.
  expect(JSON.parse(await readFile(join(goldenDir, ".manifest.json"), "utf8"))).toEqual(tree);
  const paths = (await readdir(goldenDir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name !== ".manifest.json")
    .map((entry) =>
      join(entry.parentPath, entry.name).slice(goldenDir.length).replaceAll("\\", "/"),
    )
    .sort();
  expect(paths).toEqual(entries.map((entry) => entry.relPath).sort());
  for (const entry of entries)
    expect(normalize(entry.content.toString()), entry.relPath).toBe(
      await readFile(join(goldenDir, entry.relPath), "utf8"),
    );
});

it("plans existing source paths when the engine supplies its stable current directory", async () => {
  // Given: output staged and activated by the real engine.
  const result = await syncRepo(sample.repo, {
    env: sample.env,
    adapters: new Map([["omo", async () => ({ adapter })]]),
    harness: "omo",
  });
  if (result.snapshot === undefined) throw new TypeError("No snapshot was produced.");
  const current = join(result.snapshot.config.paths.cache, "current");
  // When: target planning receives the engine's shared generation root.
  const actions = adapter.targets(sample.ctx, current);
  // Then: every source-bearing action resolves within the generated OMO subtree.
  for (const action of actions) {
    if ("source" in action) await expect(access(action.source)).resolves.toBeUndefined();
  }
});
