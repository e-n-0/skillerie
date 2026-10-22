import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, it } from "vitest";
import { convertText as codexText } from "../../../src/adapters/codex/dialect.js";
import { convertText as omoText } from "../../../src/adapters/omo/conversion.js";
import { setup } from "./helpers.js";

const execute = promisify(execFile);
const harnesses = ["codex", "omo"] as const;
let sample: Awaited<ReturnType<typeof setup>>;
let root: string;
beforeAll(async () => {
  sample = await setup();
  root = await mkdtemp(join(tmpdir(), "skillerie shell-"));
  for (const path of ["skills/root", "nested/skills/child", "docs/nested"]) {
    await mkdir(join(root, path), { recursive: true });
  }
  for (const path of [
    "one.md",
    "docs/two.md",
    "docs/nested/three.md",
    "skills/root/SKILL.md",
    "nested/skills/child/SKILL.md",
  ]) {
    await writeFile(join(root, path), "alice's note\n");
  }
  await writeFile(join(root, "other.txt"), "alice's note\n");
});
afterAll(async () => {
  await sample.cleanup();
  await rm(root, { recursive: true, force: true });
});

function convert(harness: (typeof harnesses)[number], text: string) {
  return harness === "codex"
    ? codexText(text, { file: "skill.md" })
    : omoText(text, sample.ctx, { file: "skill.md" });
}

it.each(harnesses)(
  "renders a complete command span when %s receives a variable search root",
  async (harness) => {
    // Given: a runtime shell directory and an inline search instruction.
    const source = 'Use `Glob(pattern="*.md", path="$DIR")` to list notes.';
    // When: converting and executing the replacement code span.
    const result = convert(harness, source);
    const match = /^Use `([^`]+)` to list notes\.$/.exec(result.text);
    const command = match?.[1];
    expect(command).toBe("find \"$DIR\" -name '*.md'");
    if (command === undefined) throw new TypeError("Missing command span");
    const output = await execute("/bin/sh", ["-c", command], {
      env: { ...process.env, DIR: root },
      timeout: 5_000,
    });
    // Then: the expanded directory contains every Markdown file.
    expect(output.stdout.trim().split("\n").sort()).toEqual(
      [
        "one.md",
        "docs/two.md",
        "docs/nested/three.md",
        "skills/root/SKILL.md",
        "nested/skills/child/SKILL.md",
      ]
        .map((path) => join(root, path))
        .sort(),
    );
    expect(result.diagnostics).toEqual([]);
  },
);

it.each(harnesses)(
  "runs path globs when %s receives positional recursive patterns",
  async (harness) => {
    // Given: matching files at both zero and multiple recursive directory levels.
    const source = '`Glob("**/skills/*/SKILL.md", path="$DIR")`';
    // When: executing the rendered inline command with its runtime root.
    const result = convert(harness, source);
    expect(result.text).toMatch(/^`find [^`]+ -path [^`]+`$/);
    const output = await execute("/bin/sh", ["-c", result.text.slice(1, -1)], {
      env: { ...process.env, DIR: root },
      timeout: 5_000,
    });
    // Then: the recursive wildcard includes direct and nested skill directories.
    expect(output.stdout.trim().split("\n").sort()).toEqual(
      ["skills/root/SKILL.md", "nested/skills/child/SKILL.md"]
        .map((path) => join(root, path))
        .sort(),
    );
    expect(result.diagnostics).toEqual([]);
  },
);

it.each(harnesses)(
  "uses the current directory when %s receives a rootless recursive glob",
  async (harness) => {
    // Given: a positional recursive glob without an explicit search root.
    const source = '`Glob("docs/**/*.md")`';
    // When: executing the complete replacement span from the fixture directory.
    const result = convert(harness, source);
    expect(result.text).toMatch(/^`find [^`]+ -path [^`]+`$/);
    const output = await execute("/bin/sh", ["-c", result.text.slice(1, -1)], {
      cwd: root,
      timeout: 5_000,
    });
    // Then: both direct and nested matching paths are relative to the working directory.
    expect(output.stdout.trim().split("\n").sort()).toEqual([
      "./docs/nested/three.md",
      "./docs/two.md",
    ]);
    expect(result.diagnostics).toEqual([]);
  },
);

it.each(harnesses)(
  "runs filtered grep when %s receives a runtime directory inside double backticks",
  async (harness) => {
    // Given: a pattern requiring shell escaping and a runtime search directory.
    const source = '``Grep(pattern="alice\'s note", path="$DIR", glob="*.md")``';
    // When: rendering the entire original code span and executing its command.
    const result = convert(harness, source);
    expect(result.text).toMatch(/^`grep [^`]+`$/);
    const output = await execute("/bin/sh", ["-c", result.text.slice(1, -1)], {
      env: { ...process.env, DIR: root },
      timeout: 5_000,
    });
    // Then: content matches include line numbers and exclude the text file.
    expect(output.stdout.trim().split("\n").sort()).toEqual(
      [
        "one.md",
        "docs/two.md",
        "docs/nested/three.md",
        "skills/root/SKILL.md",
        "nested/skills/child/SKILL.md",
      ]
        .map((path) => `${join(root, path)}:1:alice's note`)
        .sort(),
    );
    expect(result.diagnostics).toEqual([]);
  },
);
