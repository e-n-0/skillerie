import { expect, it } from "vitest";
import { capabilities } from "../../../src/adapters/opencode/capabilities.js";
import { convertText } from "../../../src/adapters/opencode/text.js";
import { parse } from "jsonc-parser";

const source = { file: "/home/alice/config/skills/example/SKILL.md", skillDir: "skills/example" };

function nativeArguments(text: string, tool: string): unknown {
  const start = text.indexOf(`${tool}(`) + tool.length + 1;
  return parse(text.slice(start, text.lastIndexOf(")")));
}

it.each(Object.entries(capabilities.toolMap))(
  "maps explicit %s references to %s",
  (name, native) => {
    // Given: a canonical tool reference.
    const text = `Use \`${name}\`.`;
    // When: converting for OpenCode.
    const result = convertText(text, source);
    // Then: only the machine-dispatched name is translated.
    expect(result.diagnostics).toEqual([]);
    expect(result.text).toBe(`Use \`${native}\`.`);
  },
);

it("preserves prose and protected references when tool-like words occur", () => {
  // Given: conceptual prose, links, paths, and builtin aliases.
  const text =
    "Task (a concept), Explore, https://example.com/Read /home/alice/Skill(args=x) `Explore` `git:general-purpose`";
  // When: rewriting references.
  const result = convertText(text, source);
  // Then: only explicit native role references are renamed.
  expect(result.text).toBe(
    "Task (a concept), Explore, https://example.com/Read /home/alice/Skill(args=x) `explore` `general`",
  );
});

it("renders Task fields when nested punctuation and Markdown occur", () => {
  // Given: a structured call including unsupported native execution hints.
  const text =
    'Task(subagent_type="docs:Explore", prompt="first, \\*item\\*\\n" + "last", description="inspect", resume="task-1", command="/verify", model="example", run_in_background=true)';
  // When: converting the balanced call through the shared parser.
  const result = convertText(text, source);
  // Then: supported fields map to the native task schema.
  expect(result.diagnostics).toEqual([]);
  expect(nativeArguments(result.text, "task")).toEqual({
    subagent_type: "explore",
    prompt: "first, \\*item\\*\nlast",
    description: "inspect",
    task_id: "task-1",
    command: "/verify",
  });
});

it("uses native general when Agent omits its type", () => {
  // Given: a canonical agent call with optional fields omitted.
  const text = 'Agent(prompt=build("alice", [1,2]))';
  // When: converting it.
  const result = convertText(text, source);
  // Then: runtime expressions are retained without evaluating them.
  expect(nativeArguments(result.text, "task")).toMatchObject({
    subagent_type: "general",
    prompt: 'build("alice", [1,2])',
    description: expect.any(String),
  });
});

it("renders Skill names when namespaces and arguments are supplied", () => {
  // Given: a namespaced canonical skill call.
  const text = 'Skill(skill="docs:outline", args="alice")';
  // When: converting the call.
  const result = convertText(text, source);
  // Then: the tool receives only its native name field.
  expect(nativeArguments(result.text, "skill")).toEqual({ name: "outline" });
  expect(result.diagnostics).toEqual([]);
});

it.each([
  'Task(prompt="ok", extra=true)',
  'Skill(args="missing name")',
  'Task(prompt="unclosed"',
  'AskUserQuestion(header="A",question="Pick?",multiSelect="true")',
  "AskUserQuestion(questions=[])",
  'AskUserQuestion(header="A",question="Pick?",options=[{label:"A",description:"ok",extra:1}])',
])("reports invalid canonical calls when converting %s", (text) => {
  // Given: a malformed canonical call.
  const input = text;
  // When: converting it.
  const result = convertText(input, source);
  // Then: invalid conversion blocks generation.
  expect(result.diagnostics.some((item) => item.severity === "error")).toBe(true);
});

it("renders bounded headers and multiple when question blocks use mixed options", () => {
  // Given: multiple questions, tuples, strings, and a long header.
  const text =
    '<interaction>AskUserQuestion(questions=[{header:"A header longer than thirty characters total",question:"Pick?",options:[("A","first"),"B"],multiSelect:true},{header:"Next",question:"Continue?",options:[{label:"Yes",description:"continue"}]}])</interaction>';
  // When: rendering the interaction.
  const result = convertText(text, source);
  // Then: native objects have bounded headers and no canonical multiSelect field.
  expect(result.diagnostics).toEqual([]);
  expect(nativeArguments(result.text, "question")).toEqual({
    questions: [
      {
        header: "A header longer than thirty",
        question: "Pick?",
        options: [
          { label: "A", description: "first" },
          { label: "B", description: "" },
        ],
        multiple: true,
      },
      {
        header: "Next",
        question: "Continue?",
        options: [{ label: "Yes", description: "continue" }],
        multiple: false,
      },
    ],
  });
});

it("keeps dynamic choices unpopulated when they must be resolved at runtime", () => {
  // Given: a dynamic options expression.
  const text = 'AskUserQuestion(header="Runtime",question="Pick?",options=choicesFor("alice"))';
  // When: rendering the native question.
  const result = convertText(text, source);
  // Then: no fabricated label is submitted to the runtime.
  expect(nativeArguments(result.text, "question")).toMatchObject({
    questions: [{ options: [], multiple: false, question: expect.any(String) }],
  });
});

it("converts legacy fenced question fields when they form valid YAML", () => {
  // Given: a legacy flat question snippet.
  const text = "```yaml\nheader: Scope\nquestion: Pick?\noptions: [A, B]\nmultiSelect: true\n```";
  // When: converting the snippet.
  const result = convertText(text, source);
  // Then: it reaches the same native question schema.
  expect(nativeArguments(result.text, "question")).toEqual({
    questions: [
      {
        header: "Scope",
        question: "Pick?",
        options: [
          { label: "A", description: "" },
          { label: "B", description: "" },
        ],
        multiple: true,
      },
    ],
  });
});

it("rewrites MCP names and full skill roots when support files refer to them", () => {
  // Given: both plugin-root spellings and native placeholders.
  const text =
    "`mcp__docs__search` ${CLAUDE_PLUGIN_ROOT}/skills/example/references/a.md $CLAUDE_PLUGIN_ROOT/references/b.md $ARGUMENTS";
  // When: converting support references.
  const result = convertText(text, source);
  // Then: only harness-specific tool and root syntax changes.
  expect(result.text).toBe("`docs_search` ./references/a.md ./references/b.md $ARGUMENTS");
});
