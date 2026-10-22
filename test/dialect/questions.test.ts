import { expect, it } from "vitest";
import {
  convertInteractionBlocks,
  enforceQuestionLimits,
  normalizeQuestions,
  parseStructuredCalls,
  shortenHeader,
  type QuestionModel,
} from "../../src/dialect/index.js";
import { options } from "./options.js";

const question =
  'header="Choice", question="Which one?", options=[{label:"A",description:"first"},{label:"B",description:"second"}]';

it("normalizes flat fields when a question uses object choices", () => {
  // Given: a canonical flat question.
  const call = parseStructuredCalls(`AskUserQuestion(${question})`, options).calls[0];
  // When: normalizing the parsed call.
  const result = call === undefined ? undefined : normalizeQuestions(call, options);
  // Then: all adapters see the same normalized schema.
  expect(result).toEqual({
    model: {
      questions: [
        {
          header: "Choice",
          question: "Which one?",
          options: [
            { label: "A", description: "first" },
            { label: "B", description: "second" },
          ],
          multiSelect: false,
        },
      ],
    },
    diagnostics: [],
  });
});

it("normalizes multiple questions when the source uses an array", () => {
  // Given: a questions array with tuple and string options.
  const text =
    '<interaction>AskUserQuestion(questions=[{header:"First",question:"Pick?",options:[("A","first"),["B","second"]]},{header:"Next",question:"Continue?",options:["Yes","No"],multiSelect:true}])</interaction>';
  const received: QuestionModel[] = [];
  // When: rendering through an adapter callback with unrestricted limits.
  const result = convertInteractionBlocks(text, {
    ...options,
    capabilities: {
      ...options.capabilities,
      questionLimits: {
        maxHeaderLength: null,
        maxOptions: null,
        maxQuestions: null,
        multiSelect: true,
      },
    },
    renderQuestions: (model) => {
      received.push(model);
      return JSON.stringify(model);
    },
  });
  // Then: options have labels/descriptions and native multiSelect survives.
  expect(result.diagnostics).toEqual([]);
  expect(received[0]?.questions.map((item) => item.options)).toEqual([
    [
      { label: "A", description: "first" },
      { label: "B", description: "second" },
    ],
    [
      { label: "Yes", description: "" },
      { label: "No", description: "" },
    ],
  ]);
  expect(received[0]?.questions[1]?.multiSelect).toBe(true);
});

it("retains dynamic choices when options come from an expression", () => {
  // Given: choices computed at runtime, including nested calls.
  const text =
    '<interaction>AskUserQuestion(questions=[{header:"Runtime",question:"Pick?",options:choicesFor("alice", [1,2])}])</interaction>';
  const received: QuestionModel[] = [];
  // When: invoking an adapter renderer.
  const result = convertInteractionBlocks(text, {
    ...options,
    renderQuestions: (model) => {
      received.push(model);
      return JSON.stringify(model);
    },
  });
  // Then: no placeholder option is fabricated.
  expect(result.diagnostics).toEqual([]);
  expect(received[0]?.questions[0]?.dynamicOptions).toBe('choicesFor("alice", [1,2])');
  expect(received[0]?.questions[0]?.options).toEqual([]);
});

it("replaces only block spans when multiple interactions surround prose", () => {
  // Given: two valid blocks separated by prose.
  const block = `<interaction>\nAskUserQuestion(${question})\n</interaction>`;
  const text = `before\n${block}\nbetween\n${block}\nafter`;
  // When: the adapter renders each normalized question to its schema.
  const result = convertInteractionBlocks(text, {
    ...options,
    renderQuestions: (model) => JSON.stringify({ native: model.questions.length }),
  });
  // Then: the surrounding Markdown remains byte-identical.
  expect(result).toEqual({
    text: 'before\n{"native":1}\nbetween\n{"native":1}\nafter',
    diagnostics: [],
  });
});

it.each([
  ['header="Choice",question="Pick?",multiSelect="false"', "/questions/0/multiSelect"],
  [
    'header="Choice",question="Pick?",options=[{label:"A",description:"first",extra:true}]',
    "/questions/0/options/0",
  ],
  ["questions=[]", "/questions"],
  ['questions=[{header:"Only"}]', "/questions/0/question"],
  ['questions=[{header:"A",question:"Pick?", "x/y~z":1}]', "/questions/0/x~1y~0z"],
  ['questions="invalid"', "/questions"],
  ['header="",question="Pick?"', "/questions/0/header"],
  ['header="A",question="Pick?",options=true', "/questions/0/options"],
])("reports question validation errors when %s", (fields, jsonPath) => {
  // Given: malformed question data inside a balanced interaction.
  const text = `<interaction>AskUserQuestion(${fields})</interaction>`;
  // When: converting the block.
  const result = convertInteractionBlocks(text, {
    ...options,
    renderQuestions: (model) => JSON.stringify(model),
  });
  // Then: invalid blocks stay unchanged and carry precise paths.
  expect(result.text).toBe(text);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ file: options.file, jsonPath }),
  );
});

it.each([
  "<interaction>AskUserQuestion(header='A')</interaction>",
  "<interaction>AskUserQuestion(header='A'",
  "</interaction>",
  "<interaction>unrelated text</interaction>",
  `<interaction><interaction>AskUserQuestion(${question})</interaction></interaction>`,
])("preserves malformed blocks when converting %s", (text) => {
  // Given: an incomplete or invalid wrapper.
  const render = () => {
    throw new TypeError("Invalid questions must not reach rendering.");
  };
  // When: converting malformed source.
  const result = convertInteractionBlocks(text, { ...options, renderQuestions: render });
  // Then: diagnostics replace crashes and no source is lost.
  expect(result.text).toBe(text);
  expect(result.diagnostics.length).toBeGreaterThan(0);
});

it("requires adapter rendering when an interaction is valid", () => {
  // Given: no schema-specific renderer was supplied.
  const text = `<interaction>AskUserQuestion(${question})</interaction>`;
  // When: converting the source.
  const result = convertInteractionBlocks(text, options);
  // Then: it remains visible instead of silently inventing a native schema.
  expect(result.text).toBe(text);
  expect(result.diagnostics).toHaveLength(1);
});

it("enforces maximum questions when a model exceeds adapter limits", () => {
  // Given: a model larger than the declared native schema.
  const item = { header: "Choice", question: "Pick?", options: [], multiSelect: false };
  // When: enforcing a one-question limit.
  const result = enforceQuestionLimits(
    { questions: [item, item] },
    { ...options.capabilities.questionLimits, maxQuestions: 1 },
    options,
  );
  // Then: no silently truncated model can be rendered.
  expect(result.model).toBeUndefined();
  expect(result.diagnostics[0]?.jsonPath).toBe("/questions");
});

it("folds excess options when an adapter supports fewer choices", () => {
  // Given: distinct choices beyond the native cap.
  const model = {
    questions: [
      {
        header: "Long choice header",
        question: "Pick?",
        multiSelect: true,
        options: [
          { label: "A", description: "first" },
          { label: "B", description: "second" },
          { label: "C", description: "third" },
          { label: "D", description: "fourth" },
        ],
      },
    ],
  };
  // When: applying the adapter's limits.
  const result = enforceQuestionLimits(model, options.capabilities.questionLimits, options);
  // Then: the native schema fits and the source choices are preserved in the question.
  expect(result.model?.questions[0]?.options).toHaveLength(3);
  expect(result.model?.questions[0]?.multiSelect).toBe(false);
  expect(result.model?.questions[0]?.header).toBe("Long choice");
  expect(result.model?.questions[0]?.question.length).toBeGreaterThan(5);
  expect(model.questions[0]?.options).toHaveLength(4);
});

it.each([
  ["Long choice header", 12, "Long choice"],
  ["Long choices", 4, "Long"],
  ["Unbrokenword", 5, "Unbro"],
  ["Small", null, "Small"],
])("shortens headers at word boundaries when %s exceeds %s", (header, max, expected) => {
  // Given: a native header limit.
  const limit = max;
  // When: shortening the header.
  const result = shortenHeader(header, limit);
  // Then: the machine-consumed header fits the declared limit.
  expect(result).toBe(expected);
});
