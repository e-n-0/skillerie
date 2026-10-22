import { expect, it } from "vitest";
import {
  convertInteractionBlocks,
  normalizeQuestions,
  parseStructuredCalls,
  rewriteMcpRefs,
  rewriteTools,
  type QuestionModel,
} from "../../src/dialect/index.js";
import { options } from "./options.js";

it.each([
  '["Preview" -- Use the preview target, "Live" -- Use the live target]',
  '["Preview" \u2014 Use the preview target,\n"Live" \u2014 Use the live target]',
  '["Preview" -- Use the preview target\n"Live" -- Use the live target]',
  '[{label:"Preview",description:"Use the preview target"}, "Live" -- Use the live target]',
  '[("Preview","Use the preview target"), ["Live","Use the live target"]]',
])("normalizes option pairs when authored as %s", (choices) => {
  // Given: multiline keyword arguments and supported label/description forms.
  const text = `<interaction>
AskUserQuestion(
  header: "Deploy target",
  question: "Where should the release go?",
  multiSelect: true,
  options: ${choices},
)
</interaction>`;
  const received: QuestionModel[] = [];
  // When: converting the interaction through the shared parser.
  const result = convertInteractionBlocks(text, {
    ...options,
    capabilities: {
      ...options.capabilities,
      questionLimits: {
        ...options.capabilities.questionLimits,
        maxHeaderLength: null,
        multiSelect: true,
      },
    },
    renderQuestions: (model) => {
      received.push(model);
      return JSON.stringify(model);
    },
  });
  // Then: the adapter receives typed choices and the selection mode.
  expect(result.diagnostics).toEqual([]);
  expect(received[0]?.questions[0]).toEqual({
    header: "Deploy target",
    question: "Where should the release go?",
    multiSelect: true,
    options: [
      { label: "Preview", description: "Use the preview target" },
      { label: "Live", description: "Use the live target" },
    ],
  });
});

it("retains prose punctuation when dash descriptions are unquoted", () => {
  // Given: natural-language punctuation that is not string or call syntax.
  const description = `Use alice's target, keep "current", inspect (logs, events), then deploy`;
  const text = `AskUserQuestion(
    questions: [{
      header: "Deploy target",
      question: "Where?",
      options: ["Preview" -- ${description},
                "Live" -- Use the live target]
    }, {
      header: "Review",
      question: "Continue?",
      options: ["Yes", "No"],
      multiSelect: false
    }]
  )`;
  // When: parsing and normalizing the array form.
  const parsed = parseStructuredCalls(text, options);
  const call = parsed.calls[0];
  const result = call === undefined ? undefined : normalizeQuestions(call, options);
  // Then: punctuation survives and both questions reach the model.
  expect(parsed.diagnostics).toEqual([]);
  expect(result?.diagnostics).toEqual([]);
  expect(result?.model?.questions).toHaveLength(2);
  expect(result?.model?.questions[0]?.options[0]?.description).toBe(description);
  expect(result?.model?.questions[1]?.options).toEqual([
    { label: "Yes", description: "" },
    { label: "No", description: "" },
  ]);
  expect(text.slice(call?.start, call?.end)).toBe(text);
});

it.each(["[one entry per available target]", "availableTargets", '[choicesFor("alice", [1, 2])]'])(
  "retains runtime choices when options use %s",
  (choices) => {
    // Given: runtime-derived choices rather than literal labels.
    const text = `AskUserQuestion(header:"Deploy target",question:"Where?",options:${choices})`;
    // When: normalizing the source call without adapter-specific limits.
    const parsed = parseStructuredCalls(text, options);
    const call = parsed.calls[0];
    const result = call === undefined ? undefined : normalizeQuestions(call, options);
    // Then: the template is retained and no fabricated choice reaches an adapter.
    expect(parsed.diagnostics).toEqual([]);
    expect(result?.diagnostics).toEqual([]);
    expect(result?.model?.questions[0]?.dynamicOptions).toBe(choices);
    expect(result?.model?.questions[0]?.options).toEqual([]);
  },
);

const live = '<interaction>AskUserQuestion(header:"Deploy target",question:"Where?")</interaction>';

it.each([
  "`<interaction>AskUserQuestion</interaction>`",
  "``<interaction>AskUserQuestion(header: invalid)</interaction>``",
  "`<interaction>` and `<interaction>AskUserQuestion</interaction>`",
  `\`\`\`md\n${live}\n\`\`\``,
  `   ~~~markdown\r\n${live}\r\n   ~~~~`,
  `\`\`\`\`md\n\`\`\`\n${live}\n\`\`\`\n\`\`\`\``,
  `\`\`\`md\n<interaction><interaction>AskUserQuestion(broken)\n`,
])("preserves interaction documentation when shown as %s", (example) => {
  // Given: a documented interaction next to a real one.
  const text = `${example}\n${live}`;
  const received: QuestionModel[] = [];
  // When: converting the real interaction and examining the remaining source.
  const converted = convertInteractionBlocks(text, {
    ...options,
    renderQuestions: (model) => {
      received.push(model);
      return "native_question({})";
    },
  });
  const parsed = parseStructuredCalls(converted.text, options);
  const rewritten = rewriteTools(converted.text, options);
  // Then: closed examples remain opaque; unclosed fences also contain the later call.
  const unclosed = example.endsWith("AskUserQuestion(broken)\n");
  expect(converted.diagnostics).toEqual([]);
  expect(converted.text).toBe(unclosed ? text : `${example}\nnative_question({})`);
  expect(received).toHaveLength(unclosed ? 0 : 1);
  expect(parsed).toEqual({ calls: [], diagnostics: [] });
  expect(rewritten.text).toBe(converted.text);
});

it("preserves tool references when interaction examples contain other dialect calls", () => {
  // Given: an inline example with source tool and MCP syntax.
  const text =
    '`<interaction>AskUserQuestion(question="Use Task(prompt=x) and mcp__docs__search")</interaction>`';
  // When: applying the shared tool and MCP rewrites.
  const tools = rewriteTools(text, options);
  const mcp = rewriteMcpRefs(tools.text, { ...options, mcpTemplate: () => "native_mcp({})" });
  // Then: the complete example is left byte-identical.
  expect(mcp).toEqual({ text, diagnostics: [] });
});

it("keeps legacy fenced calls parseable when they have no interaction wrapper", () => {
  // Given: a legacy question example using a runtime option template.
  const text =
    '```\nAskUserQuestion(header:"Deploy target", question:"Where?", options:[one entry per target])\n```';
  // When: parsing structured calls for legacy adapter conversion.
  const result = parseStructuredCalls(text, options);
  // Then: legacy conversion still sees its call.
  expect(result.diagnostics).toEqual([]);
  expect(result.calls).toHaveLength(1);
});

it.each([
  '<interaction>Explain first. AskUserQuestion(header:"Target",question:"Where?")</interaction>',
  '<interaction>AskUserQuestion(header:"Target",question:"Where?") Explain later.</interaction>',
  '<interaction>AskUserQuestion(header:"Target",question:"Where?",options:["Live" -- ])</interaction>',
])("rejects unsupported interaction content when given %s", (text) => {
  // Given: surrounding prose or an empty description, neither a supported call form.
  const received: QuestionModel[] = [];
  // When: attempting interaction conversion.
  const result = convertInteractionBlocks(text, {
    ...options,
    renderQuestions: (model) => {
      received.push(model);
      return JSON.stringify(model);
    },
  });
  // Then: source is retained and invalid input never reaches the native renderer.
  expect(result.text).toBe(text);
  expect(result.diagnostics.length).toBeGreaterThan(0);
  expect(received).toEqual([]);
});
