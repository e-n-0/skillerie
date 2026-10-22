import { expect, it } from "vitest";
import { parseStructuredCalls, rewriteTools } from "../../src/dialect/index.js";
import { options } from "./options.js";

const configured = {
  ...options,
  capabilities: {
    ...options.capabilities,
    toolMap: { ...options.capabilities.toolMap, Write: "write" },
  },
};

it.each(["```go", "~~~go", "```typescript", "```"])(
  "preserves program symbols when fenced with %s",
  (opening) => {
    // Given: declarations, methods, interface members, and qualified type names.
    const code = [
      "type Source interface {",
      "  Read(p []byte) (int, error)",
      "  Write(p []byte) (int, error)",
      "}",
      "func (r *Buffer) Read(p []byte) (int, error) { return r.src.Read(p) }",
      "func Write(p []byte) error { return nil }",
      "var source io.Reader",
      "interface Source { Read(p: Uint8Array): number; }",
      "interface EmptySource {",
      "  Read()",
      "}",
      "function Read(p: string) { return p; }",
      "class Buffer { Read(p: string) { return p; } }",
      "x.Read(data);",
      "x . Read(data);",
      "const label = `Read`;",
    ].join("\n");
    const text = `${opening}\n${code}\n${opening.startsWith("~") ? "~~~" : "```"}`;
    // When: rewriting explicit tool references.
    const result = rewriteTools(text, configured);
    // Then: the complete program survives byte-for-byte.
    expect(result.text).toBe(text);
  },
);

it.each(["", "text", "plaintext"])(
  "maps standalone calls when the example language is %s",
  (language) => {
    // Given: a shell-agnostic example with an explicit builtin call.
    const text = `\`\`\`${language}\nRead("references/guide.md")\n\`\`\``;
    // When: mapping the tool name.
    const result = rewriteTools(text, configured);
    // Then: the call changes without altering its argument.
    expect(result.text).toBe(`\`\`\`${language}\nread("references/guide.md")\n\`\`\``);
  },
);

it.each(["go", "typescript", "sh"])(
  "preserves ordinary function calls when the fence language is %s",
  (language) => {
    // Given: a language-specific call, not a tool example.
    const text = `\`\`\`${language}\nRead(data)\n\`\`\``;
    // When: rewriting names in the document.
    const result = rewriteTools(text, configured);
    // Then: a standalone program call is not enough to identify a tool.
    expect(result.text).toBe(text);
  },
);

it.each([
  ['Task(prompt="inspect")', 'task(prompt="inspect")'],
  ['Agent({"prompt":"inspect"})', 'task({"prompt":"inspect"})'],
  ['Skill(skill="example")', 'skill(skill="example")'],
  ["AskUserQuestion(questions=choices)", "question(questions=choices)"],
])("maps structured calls when fenced code contains %s", (call, expected) => {
  // Given: a recognized authoring call within a language-specific fence.
  const text = `\`\`\`python\n${call}\n\`\`\``;
  // When: mapping the structured tool name.
  const result = rewriteTools(text, configured);
  // Then: recognized keyword/object syntax still converts.
  expect(result.text).toBe(`\`\`\`python\n${expected}\n\`\`\``);
});

it.each([
  "func Task(p []byte) error { return nil }",
  "interface Queue { Task(prompt: string): void; }",
  "function Skill(skill: string) { return skill; }",
  "Task(data)",
  "Task(unknown=value)",
  "x.Task(prompt=value)",
  "x . Task(prompt=value)",
  'const example = "Task(prompt=value)";',
  "// Task(prompt=value)",
  "const example = `\nTask(prompt=value)\n`;",
  'const example = """\nTask(prompt=value)\n""";',
  "/*\nTask(prompt=value)\n*/",
])("ignores structured tool lookalikes when code contains %s", (code) => {
  // Given: program syntax sharing a canonical tool name.
  const text = `\`\`\`typescript\n${code}\n\`\`\``;
  // When: parsing calls before an adapter renders them.
  const result = parseStructuredCalls(text, configured);
  // Then: neither an adapter call nor a syntax error is invented.
  expect(result).toEqual({ calls: [], diagnostics: [] });
});

it("maps structured calls when a completed string precedes the call", () => {
  // Given: the call is code, not part of the preceding string.
  const text = '```typescript\nconst name = "alice"; Task(prompt=name)\n```';
  // When: parsing recognized keyword arguments.
  const result = parseStructuredCalls(text, configured);
  // Then: lexical protection ends at the closing quote.
  expect(result.diagnostics).toEqual([]);
  expect(result.calls.map((call) => call.name)).toEqual(["Task"]);
});

it("preserves member calls when whitespace separates the receiver and method", () => {
  // Given: a qualified program call outside a fence.
  const text = "x . Read(data)";
  // When: rewriting explicit references in ordinary Markdown.
  const result = rewriteTools(text, configured);
  // Then: whitespace does not turn the member into a tool call.
  expect(result.text).toBe(text);
});

it.each(["opencode", "codex", "omo", "pi"] as const)(
  "uses the supplied native map when rewriting fenced calls for %s",
  (harness) => {
    // Given: a distinct replacement and a structured call next to a program member.
    const text = '```text\nRead("guide.md")\nx.Read(data)\nTask(prompt="inspect")\n```';
    const native = {
      ...configured,
      harness,
      capabilities: {
        ...configured.capabilities,
        toolMap: { Read: "inspect_file", Task: "spawn_worker" },
      },
    };
    // When: applying the shared transformation with adapter-supplied data.
    const result = rewriteTools(text, native);
    // Then: native names apply only to tool calls, independently of the harness.
    expect(result.text).toBe(
      '```text\ninspect_file("guide.md")\nx.Read(data)\nspawn_worker(prompt="inspect")\n```',
    );
  },
);

it.each(['   ~~~~text\r\nRead("guide.md")\r\n   ~~~~~', '````text\nRead("guide.md")'])(
  "maps standalone calls when fences are indented, longer, or unclosed: %s",
  (text) => {
    // Given: a standalone builtin call in a nonstandard fence boundary.
    const expected = text.replace("Read(", "read(");
    // When: rewriting the shared dialect.
    const result = rewriteTools(text, configured);
    // Then: Markdown boundary variations do not alter tool recognition.
    expect(result.text).toBe(expected);
  },
);
