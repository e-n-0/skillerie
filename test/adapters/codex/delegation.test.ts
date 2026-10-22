import { expect, it } from "vitest";
import { convertText } from "../../../src/adapters/codex/dialect.js";

function payload(text: string): unknown {
  const match = /^spawn_agent\((\{[\s\S]*\})\)$/.exec(text.trim());
  if (!match?.[1]) throw new TypeError(`Missing native delegation: ${text}`);
  return JSON.parse(match[1]);
}

it.each(["Task", "Agent"])("renders native fields when %s has named arguments", (name) => {
  // Given: a source agent alias, prompt, and unsupported scheduling fields.
  const source = `${name}(subagent_type="tools:Explore", description="Inspect sources", prompt="Inspect the parser.", run_in_background=true, model="parent", resume="old", command="unused")`;
  // When: Codex renders the delegation.
  const result = convertText(source, { file: "skill.md" });
  // Then: native routing and prompt survive without source-only fields.
  expect(payload(result.text)).toEqual({
    agent_type: "explorer",
    message: "Inspect the parser.",
  });
  expect(result.diagnostics).toEqual([]);
});

it.each(["Task", "Agent"])("keeps a multiline prompt when %s uses assignment syntax", (name) => {
  // Given: a fenced assignment-style call and a prompt containing nested syntax.
  const prompt = 'Inspect parse(value).\nWrite the findings to "/home/alice/report.md".';
  const source = [
    "```text",
    `${name}(`,
    '  subagent_type = "tools:auditor",',
    '  description = "Inspect parser behavior",',
    "  run_in_background = false,",
    `  prompt = """${prompt}"""`,
    ")",
    "```",
  ].join("\n");
  // When: converting the whole call.
  const result = convertText(source, { file: "skill.md" });
  // Then: the complete prompt is passed as a single native message.
  expect(payload(result.text.replace(/^```text\n|\n```$/g, ""))).toEqual({
    agent_type: "auditor",
    message: prompt,
  });
  expect(result.diagnostics).toEqual([]);
});

it("renders a field block when delegation fields are assigned without a call", () => {
  // Given: a standalone block of assignment-style delegation fields.
  const source = [
    'subagent_type = "tools:Plan"',
    'description = "Plan a change"',
    'prompt = "Inspect scope\\nWrite a plan."',
    "run_in_background = true",
  ].join("\n");
  // When: converting the block.
  const result = convertText(source, { file: "skill.md" });
  // Then: the block becomes one complete native delegation.
  expect(payload(result.text)).toEqual({
    agent_type: "default",
    message: "Inspect scope\nWrite a plan.",
  });
  expect(result.diagnostics).toEqual([]);
});

it("keeps runtime prompt expressions when rendering a dynamic delegation", () => {
  // Given: routing and prompt values supplied at runtime.
  const source = 'Agent(subagent_type=selectedAgent, prompt=taskPrompt, description="Inspect")';
  // When: rendering a native template.
  const result = convertText(source, { file: "skill.md" });
  // Then: native fields refer to the same expressions without quoting or evaluating them.
  expect(result.text).toBe('spawn_agent({"agent_type":selectedAgent,"message":taskPrompt})');
  expect(result.diagnostics).toEqual([]);
});

it.each(['Task(subagent_type=false, prompt="Inspect")', "Agent(prompt=42)"])(
  "rejects invalid delegation values when given %s",
  (source) => {
    // Given: invalid literal types in required native fields.
    // When: rendering the delegation.
    const result = convertText(source, { file: "skill.md" });
    // Then: the error is reported instead of shipping a malformed native payload.
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ severity: "error", code: "codex.task" }),
    );
  },
);

it("preserves unrelated fields when the text is not a delegation block", () => {
  // Given: ordinary source declarations and quoted examples in a program.
  const source = '```ts\nconst prompt = "Task(prompt)";\nconst description = "Agent";\n```';
  // When: adapting the Markdown.
  const result = convertText(source, { file: "skill.md" });
  // Then: programming syntax is not mistaken for delegation.
  expect(result.text).toBe(source);
  expect(result.diagnostics).toEqual([]);
});
