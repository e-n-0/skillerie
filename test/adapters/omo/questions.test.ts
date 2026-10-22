import { afterEach, beforeEach, expect, it } from "vitest";
import { convertText } from "../../../src/adapters/omo/conversion.js";
import { payload, setup } from "./helpers.js";

let sample: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  sample = await setup();
});
afterEach(async () => {
  await sample.cleanup();
});

function question(source: string) {
  return convertText(source, sample.ctx, { file: "skills/example/SKILL.md" });
}

it("uses the native question schema when a canonical interaction is supplied", () => {
  // Given: a long header and more than four source choices.
  const source =
    '<interaction>AskUserQuestion(header="Deployment target details", question="Where?", options=["A","B","C","D","E","F"], multiSelect=true)</interaction>';
  // When: the question is converted with shared limits.
  const result = question(source);
  // Then: the native payload obeys header and option limits and preserves multiselect.
  expect(payload(result.text)).toEqual({
    questions: [
      {
        header: "Deployment",
        question: expect.any(String),
        multiSelect: true,
        options: ["A", "B", "C", "D"].map((label) => ({ label, description: "" })),
      },
    ],
    waitForAnswer: true,
  });
  expect(result.diagnostics).toEqual([]);
});

it.each(["choices", "[one entry per worktree]", '[choicesFor("alice", [1, 2])]'])(
  "renders valid JSON when interaction options come from %s",
  (options) => {
    // Given: options populated from a runtime expression rather than fixed choices.
    const source = `<interaction>AskUserQuestion(header="Scope", question="Choose?", options=${options}, multiSelect=false)</interaction>`;
    // When: the interaction is converted into a native JSON payload.
    const result = question(source);
    // Then: no source expression or fabricated choice becomes a native options value.
    expect(payload(result.text)).toMatchObject({
      questions: [{ header: "Scope", options: [], multiSelect: false }],
      waitForAnswer: true,
    });
    expect(result.diagnostics).toEqual([]);
  },
);

it.each([
  'AskUserQuestion(header="Scope", question="Choose?", options=[one entry per worktree])',
  '```text\nAskUserQuestion(header="Scope", question="Choose?", options=choices)\n```',
])("renders valid JSON when a standalone question has runtime options: %s", (source) => {
  // Given: a standalone or fenced question whose choices are runtime derived.
  // When: conversion handles the legacy structured call form.
  const result = question(source);
  const native = source.startsWith("```") ? (result.text.split("\n")[1] ?? "") : result.text;
  // Then: the native payload can be parsed without treating runtime prose as JSON.
  expect(payload(native)).toMatchObject({
    questions: [{ header: "Scope", options: [], multiSelect: false }],
    waitForAnswer: true,
  });
  expect(result.diagnostics).toEqual([]);
});

it.each([
  'AskUserQuestion(header="Scope", question="Choose?", multiSelect="false")',
  'AskUserQuestion(header="Scope", question="Choose?", unknown=true)',
  "AskUserQuestion(questions=[])",
  "AskUserQuestion(questions=[1])",
  'AskUserQuestion(header="", question="Choose?")',
  'AskUserQuestion(header="Scope", question="Choose?", options=[true])',
  `AskUserQuestion(questions=${JSON.stringify(
    Array.from({ length: 5 }, () => ({
      header: "Scope",
      question: "Choose?",
      options: ["A", "B"],
      multiSelect: false,
    })),
  )})`,
])("reports a located diagnostic when question input is invalid: %s", (source) => {
  // Given: a malformed interaction.
  // When: native conversion parses the block.
  const result = question(`<interaction>${source}</interaction>`);
  // Then: an error remains attached to the source file.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      severity: "error",
      file: "skills/example/SKILL.md",
    }),
  );
});

it("normalizes question-only fenced calls when the source uses the legacy form", () => {
  // Given: a question call in a fenced fragment.
  const source =
    '```text\nAskUserQuestion(header="Scope", question="Choose?", options=["A","B"])\n```';
  // When: conversion processes standalone structured calls too.
  const result = question(source);
  // Then: the fenced fragment uses the native tool and schema.
  const native = result.text.split("\n")[1] ?? "";
  expect(native.startsWith("ask_user_question(")).toBe(true);
  expect(payload(native)).toMatchObject({ waitForAnswer: true });
  expect(result.diagnostics).toEqual([]);
});
