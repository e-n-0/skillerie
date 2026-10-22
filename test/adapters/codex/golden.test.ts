import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { syncRepo } from "../../../src/engine/index.js";
import { env, fixture, registry } from "./helpers.js";

const golden = fileURLToPath(new URL("../../golden/codex", import.meta.url));
let root: string;
let repo: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "skillerie-codex-golden-"));
  repo = join(root, "repo");
  await cp(fixture, repo, { recursive: true });
  await appendFile(
    join(repo, "skills/outline/references/checklist.md"),
    [
      "",
      'Use `Glob(pattern="*.md", path="/home/alice/notes")` to list notes.',
      'Use `Glob(pattern="*.md", path="$DIR")` to list runtime notes.',
      '- `Glob("**/skills/*/SKILL.md")`',
      'Use `Grep(pattern="TODO", path="$DIR", glob="*.ts")` to search sources.',
      "",
      "```text",
      'Grep(pattern="TODO", path="src", glob="*.ts", output_mode="content")',
      'Task(subagent_type="Explore", description="Inspect sources", prompt="Inspect the parser.", run_in_background=true)',
      "```",
      "",
    ].join("\n"),
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function inventory(directory: string): Promise<Readonly<Record<string, string>>> {
  const files: Record<string, string> = {};
  async function visit(relative: string): Promise<void> {
    for (const name of (await readdir(join(directory, relative))).sort()) {
      const path = join(relative, name);
      if ((await stat(join(directory, path))).isDirectory()) await visit(path);
      else
        files[path] = (await readFile(join(directory, path), "utf8")).replaceAll(
          repo,
          "/home/alice/config",
        );
    }
  }
  await visit("");
  return files;
}

it("matches reviewed output when the real engine renders only Codex", async () => {
  // Given: the shared sample and a registry containing only the real Codex adapter.
  // When: sync runs the complete source validation and generation pipeline.
  const result = await syncRepo(repo, { env, adapters: registry, harness: "codex" });
  // Then: the generated tree equals the checked-in neutral golden files.
  expect(result.diagnostics).toEqual([]);
  if (!result.generation) throw new TypeError("No generation produced");
  const generated = await inventory(join(result.generation.dir, "codex"));
  if (process.env["UPDATE_GOLDEN"] === "1") {
    await rm(golden, { recursive: true, force: true });
    for (const [path, content] of Object.entries(generated)) {
      await mkdir(dirname(join(golden, path)), { recursive: true });
      await writeFile(join(golden, path), content);
    }
  }
  expect(generated).toEqual(await inventory(golden));
  expect(await readdir(result.generation.dir)).toEqual(["codex"]);
});
