import { expect, it } from "vitest";
import { rewriteMarkdown } from "../../../src/adapters/pi/markdown.js";
import { isJsonObject } from "../../../src/model/json.js";
import { nativeCall } from "./helpers.js";

const context = { file: "/home/alice/config/skills/outline/SKILL.md" } as const;
const question = {
  header: "Scope",
  question: "Which scope?",
  options: [
    { label: "Focused", description: "One change" },
    { label: "Complete", description: "Whole feature" },
  ],
  multiSelect: true,
} as const;

it.each(["flat", "array"])("converts %s questions when wrapped in an interaction", (form) => {
  // Given: the two canonical question layouts.
  const argument =
    form === "flat" ? JSON.stringify(question) : JSON.stringify({ questions: [question] });
  const text = `<interaction>AskUserQuestion(${argument})</interaction>`;
  // When: converting to Pi's questionnaire tool.
  const result = rewriteMarkdown(text, context);
  // Then: the native questions array replaces the canonical schema.
  expect(result.diagnostics).toEqual([]);
  expect(nativeCall(result.text, "ask_user_question")).toEqual({ questions: [question] });
});

it("enforces native limits when headers and option lists exceed Pi's schema", () => {
  // Given: a long header and too many choices.
  const source = {
    ...question,
    header: "Choose the implementation scope",
    options: [
      ...question.options,
      { label: "Review", description: "Inspect" },
      { label: "Plan", description: "Design" },
      { label: "Test", description: "Verify" },
    ],
  };
  // When: converting the question.
  const result = rewriteMarkdown(
    `<interaction>AskUserQuestion(${JSON.stringify(source)})</interaction>`,
    context,
  );
  // Then: fields respect Pi's declared limits.
  const payload = nativeCall(result.text, "ask_user_question");
  expect(payload["questions"]).toEqual([
    expect.objectContaining({
      header: expect.any(String),
      options: source.options.slice(0, 4),
      multiSelect: true,
    }),
  ]);
  const questions = payload["questions"];
  if (!Array.isArray(questions)) throw new TypeError("Expected questions.");
  const first: unknown = questions[0];
  if (!isJsonObject(first) || typeof first["header"] !== "string")
    throw new TypeError("Expected a question header.");
  expect(first["header"].length).toBeLessThanOrEqual(16);
});

it("rejects too many questions when the native maximum is exceeded", () => {
  // Given: five authored questions.
  const text = `<interaction>AskUserQuestion(${JSON.stringify({ questions: Array.from({ length: 5 }, () => question) })})</interaction>`;
  // When: applying Pi limits.
  const result = rewriteMarkdown(text, context);
  // Then: rendering returns an error instead of an invalid native questionnaire.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      severity: "error",
      code: "dialect.question",
      jsonPath: "/questions",
    }),
  );
});

it("relays question data when the Markdown belongs to a child agent", () => {
  // Given: a child prompt with a structured question.
  const text = `<interaction>AskUserQuestion(${JSON.stringify(question)})</interaction>`;
  // When: adapting it for a child without an interactive tool.
  const result = rewriteMarkdown(text, { ...context, childAgent: true });
  // Then: the request survives as structured data without a child tool call.
  expect(result.diagnostics).toEqual([]);
  expect(result.text).not.toMatch(/(?:AskUserQuestion|ask_user_question)\(/);
  const payload: unknown = JSON.parse(result.text.slice(result.text.indexOf("{")));
  expect(payload).toEqual({ questions: [question] });
});

it("retains dynamic choices when options are populated at runtime", () => {
  // Given: choices are not known at generation time.
  const text =
    '<interaction>AskUserQuestion(header="Scope", question="Which?", options=availableScopes)</interaction>';
  // When: converting to Pi.
  const result = rewriteMarkdown(text, context);
  // Then: no fabricated static choice is supplied.
  expect(result.diagnostics).toEqual([]);
  expect(result.text).toContain("availableScopes");
});

it("reports malformed questions when an interaction wrapper is incomplete", () => {
  // Given: an unterminated interaction block.
  const text = "<interaction>AskUserQuestion(";
  // When: converting the Markdown.
  const result = rewriteMarkdown(text, context);
  // Then: the source location is preserved in an error.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      severity: "error",
      file: context.file,
      code: "dialect.syntax",
    }),
  );
});
