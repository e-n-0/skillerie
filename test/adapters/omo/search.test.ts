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
let sample: Awaited<ReturnType<typeof setup>>;
let root: string;
beforeAll(async () => {
  sample = await setup();
  root = await mkdtemp(join(tmpdir(), "skillerie-search-"));
  await mkdir(join(root, "nested"));
  await writeFile(join(root, "one.md"), "alice's note\n");
  await writeFile(join(root, "nested", "two.md"), "alice's note\n");
  await writeFile(join(root, "other.txt"), "alice's note\n");
});
afterAll(async () => {
  await sample.cleanup();
  await rm(root, { recursive: true, force: true });
});

const harnesses = ["codex", "omo"] as const;
function convert(harness: (typeof harnesses)[number], text: string) {
  return harness === "codex"
    ? codexText(text, { file: "skill.md" })
    : omoText(text, sample.ctx, { file: "skill.md" });
}

function command(text: string, harness: (typeof harnesses)[number]): string {
  const name = harness === "codex" ? "exec_command" : "bash";
  const match = new RegExp(`^${name}\\((\\{.*\\})\\)$`, "s").exec(text);
  if (!match?.[1]) throw new TypeError(`Missing native shell call: ${text}`);
  const value: unknown = JSON.parse(match[1]);
  const key = harness === "codex" ? "cmd" : "command";
  if (typeof value !== "object" || value === null || !(key in value))
    throw new TypeError("Missing command payload");
  const result: unknown = Object.getOwnPropertyDescriptor(value, key)?.value;
  if (typeof result !== "string") throw new TypeError("Command must be a string");
  expect(Object.keys(value)).toEqual([key]);
  return result;
}

it.each(harnesses)("runs a filtered content search when %s maps Grep to shell", async (harness) => {
  // Given: matching files of two types and an apostrophe in the pattern.
  const source = `Grep(pattern="alice's note", path=${JSON.stringify(root)}, glob="*.md", output_mode="content")`;
  // When: the rendered native command runs through the shell.
  const result = convert(harness, source);
  const output = await execute("/bin/sh", ["-c", command(result.text, harness)], {
    timeout: 5_000,
  });
  // Then: both Markdown matches retain line numbers and the text file is excluded.
  expect(result.diagnostics).toEqual([]);
  expect(output.stdout.trim().split("\n").sort()).toEqual(
    [join(root, "one.md"), join(root, "nested", "two.md")]
      .map((path) => `${path}:1:alice's note`)
      .sort(),
  );
});

it.each(harnesses)(
  "runs a recursive file search when %s receives positional Glob",
  async (harness) => {
    // Given: Markdown files at the root and in a nested directory.
    const source = `Glob("**/*.md", path=${JSON.stringify(root)})`;
    // When: the rendered find command runs through the native shell payload.
    const result = convert(harness, source);
    const output = await execute("/bin/sh", ["-c", command(result.text, harness)], {
      timeout: 5_000,
    });
    // Then: recursive matching includes the root without admitting other extensions.
    expect(result.diagnostics).toEqual([]);
    expect(output.stdout.trim().split("\n").sort()).toEqual(
      [join(root, "one.md"), join(root, "nested", "two.md")].sort(),
    );
  },
);

it.each(harnesses)("keeps executable search payloads inside inline code for %s", (harness) => {
  // Given: a named Glob call used as an inline instruction.
  const input = '`Glob(pattern="*.md", path="/home/alice/notes")`';
  // When: rendering the inline search.
  const result = convert(harness, input);
  // Then: the payload is a find command rather than search fields on a shell tool.
  expect(result.text).toBe("`find '/home/alice/notes' -name '*.md'`");
});

it.each(harnesses)(
  "retains runtime search values without inventing a command for %s",
  (harness) => {
    // Given: values supplied by the calling agent at runtime.
    const input = "Grep(pattern=searchPattern, path=searchRoot, glob=fileGlob)";
    // When: rendering a command that cannot yet be assembled.
    const result = convert(harness, input);
    // Then: all expressions survive as instructions, not incompatible shell arguments.
    expect(result.text).toContain(harness === "codex" ? "`exec_command`" : "`bash`");
    expect(result.text).toContain("grep");
    for (const expression of ["searchPattern", "searchRoot", "fileGlob"])
      expect(result.text).toContain(expression);
    expect(result.text).not.toMatch(/(?:exec_command|bash)\(\s*(?:pattern|path|glob)/);
    expect(result.diagnostics).toEqual([]);
  },
);

it.each(harnesses)("preserves language symbols and interaction examples for %s", (harness) => {
  // Given: declarations, strings, paths, and documentation of interaction syntax.
  const input = [
    '```go\nfunc Grep(pattern string) {}\nvar text = "Glob(pattern)"\n```',
    "https://example.com/Grep(pattern) ./Glob(pattern)",
    '`<interaction>Grep(pattern="example")</interaction>`',
  ].join("\n");
  // When: adapting the surrounding Markdown.
  const result = convert(harness, input);
  // Then: these are not treated as search instructions.
  expect(result.text).toBe(input);
  expect(result.diagnostics).toEqual([]);
});

it.each(harnesses)("reports invalid search syntax for %s", (harness) => {
  // Given: a search with an unterminated argument list.
  // When: rendering the malformed call.
  const result = convert(harness, 'Grep(pattern="alice"');
  // Then: malformed input cannot silently become a native-looking command.
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: "error" }));
});

it.each(harnesses)("keeps search patterns opaque to later tool rewrites for %s", (harness) => {
  // Given: a valid search pattern that resembles a tool call.
  const pattern = "Read(value)";
  // When: converting the search.
  const result = convert(
    harness,
    `Grep(pattern=${JSON.stringify(pattern)}, output_mode="content")`,
  );
  // Then: the shell searches for the authored expression without renaming its symbols.
  expect(command(result.text, harness)).toBe(`grep -rnE -- '${pattern}' .`);
});

it.each(harnesses)("keeps delegated search examples inside the prompt for %s", (harness) => {
  // Given: a delegation whose prompt documents a search call.
  const prompt = 'Inspect Grep(pattern="alice", path="src") before changing the parser.';
  const source = `Task(subagent_type="Explore", description="Inspect", prompt=${JSON.stringify(prompt)})`;
  // When: converting the delegation.
  const result = convert(harness, source);
  // Then: a single native payload retains the complete message without nested shell payloads.
  const data: unknown = JSON.parse(result.text.slice(result.text.indexOf("(") + 1, -1));
  expect(data).toMatchObject(harness === "codex" ? { message: prompt } : { prompt });
  expect(result.diagnostics).toEqual([]);
});
