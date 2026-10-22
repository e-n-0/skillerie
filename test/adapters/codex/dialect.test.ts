import { expect, it } from "vitest";
import { capabilities } from "../../../src/adapters/codex/capabilities.js";
import {
  convertText,
  questionFallback,
  renderQuestions,
} from "../../../src/adapters/codex/dialect.js";
import {
  enforceQuestionLimits,
  normalizeQuestions,
  parseStructuredCalls,
} from "../../../src/dialect/index.js";
import { nativeQuestions } from "./helpers.js";

const options = { harness: "codex", capabilities } as const;
const source =
  'AskUserQuestion(header="Implementation scope", question="Which?", options=[["One","First"],["Two","Second"],["Three","Third"],["Four","Fourth"]], multiSelect=true)';

it("uses the native schema when a wrapped question exceeds option limits", () => {
  // Given: a four-option multi-selection question.
  const input = `<interaction>${source}</interaction>`;
  // When: the shared converters and Codex renderer adapt it.
  const result = convertText(input, { file: "skill.md" });
  const native = nativeQuestions(result.text);
  const call = parseStructuredCalls(source, options).calls[0];
  if (!call) throw new TypeError("Missing question call");
  const normalized = normalizeQuestions(call, options);
  if (!normalized.model) throw new TypeError("Missing question model");
  const limited = enforceQuestionLimits(normalized.model, capabilities.questionLimits, options);
  if (!limited.model) throw new TypeError("Missing limited question model");
  // Then: the native payload contains the shared folded prose, short header, and no multiSelect.
  expect(result.diagnostics).toEqual([]);
  expect(native).toEqual({
    questions: limited.model.questions.map((question, index) => ({
      id: `question_${index + 1}`,
      header: question.header,
      question: question.question,
      options: question.options,
    })),
  });
  expect(native.questions[0]?.options).toHaveLength(3);
  expect(native.questions[0]?.header.length).toBeLessThanOrEqual(12);
  expect(result.text.startsWith(`${questionFallback}\n\n`)).toBe(true);
});

it.each([source, `\`\`\`text\n${source}\n\`\`\`\n`, `<interaction>${source}</interaction>`])(
  "converts a complete question example when its wrapper is supported",
  (input) => {
    // Given: one question in a supported source wrapper.
    // When: it is rendered for Codex.
    const result = convertText(input, { file: "skill.md" });
    // Then: all wrapper forms ship the same native call and fallback instructions.
    const canonical = convertText(`<interaction>${source}</interaction>`, { file: "skill.md" });
    expect(result).toEqual(canonical);
  },
);

it("preserves dynamic choices when the source defers them until runtime", () => {
  // Given: a runtime expression instead of fixed choices.
  const input =
    '<interaction>AskUserQuestion(header="Scope", question="Which?", options=choices)</interaction>';
  // When: conversion creates a native template.
  const result = convertText(input, { file: "skill.md" });
  // Then: no fabricated options appear.
  const payload = nativeQuestions(result.text);
  expect(payload.questions[0]?.options).toEqual([]);
  expect(result.diagnostics).toEqual([]);
});

it("rejects excess questions when the native tool cannot represent them", () => {
  // Given: four questions for a tool accepting at most three.
  const questions = Array.from({ length: 4 }, () => ({
    header: "Scope",
    question: "Which?",
    options: [],
  }));
  // When: a block is converted.
  const result = convertText(
    `<interaction>AskUserQuestion(${JSON.stringify({ questions })})</interaction>`,
    { file: "skill.md" },
  );
  // Then: native schema overflow is an error, not silent truncation.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ severity: "error", code: "dialect.question" }),
  );
});

it("rewrites invocation arguments only when outside fenced examples", () => {
  // Given: invocation guidance and fenced shell syntax.
  const input = "$ARGUMENTS\n```sh\nprintf '%s' \"$ARGUMENTS\"\n```\n`$ARGUMENTS`";
  // When: Codex conversion runs.
  const result = convertText(input, { file: "skill.md" });
  // Then: shell examples retain their variable while prose uses the selected replacement.
  expect(result.text).toBe(
    "the user's invocation prompt\n```sh\nprintf '%s' \"$ARGUMENTS\"\n```\n`the user's invocation prompt`",
  );
});

it("rewrites tool and agent references when they are code rather than paths", () => {
  // Given: executable examples, MCP references, and URL/path literals.
  const input =
    "`Read` mcp__docs__search `codex:Explore`\nhttps://example.com/mcp__docs__search /tmp/Read\n${CLAUDE_PLUGIN_ROOT}/skills/test-skill/references/a.md";
  // When: shared rewrites process the skill.
  const result = convertText(input, { file: "skill.md", skillDir: "skills/test-skill" });
  // Then: only routable references change.
  expect(result.text).toBe(
    "`exec_command` docs_search `explorer`\nhttps://example.com/mcp__docs__search /tmp/Read\n./references/a.md",
  );
});

it("renders every native question when there are several valid questions", () => {
  // Given: a normalized multi-question model.
  const questions = [
    { header: "Scope", question: "Which scope?", options: [], multiSelect: false },
    { header: "Mode", question: "Which mode?", options: [], multiSelect: false },
  ];
  // When: the native call is serialized.
  const result = renderQuestions({ questions });
  // Then: stable unique question IDs are machine readable.
  const payload = nativeQuestions(result);
  expect(payload.questions.map((question) => question.id)).toEqual(["question_1", "question_2"]);
});
