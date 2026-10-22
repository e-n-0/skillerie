import type { Diagnostic, QuestionLimits } from "../core/types.js";
import type { DialectOptions, DialectResult, QuestionModel, QuestionsResult } from "./types.js";
import { parseStructuredCalls } from "./calls.js";
import { diagnostic } from "./syntax.js";
import { normalizeQuestions, questionDiagnostic } from "./question-model.js";
import { interactionExamples } from "./markdown.js";

export { normalizeQuestions } from "./question-model.js";

export function shortenHeader(header: string, maxLength: number | null): string {
  if (maxLength === null || header.length <= maxLength) return header;
  const prefix = header.slice(0, maxLength).trimEnd();
  if (prefix.length < maxLength || /\s/.test(header[maxLength] ?? "")) return prefix;
  const boundary = prefix.lastIndexOf(" ");
  return boundary > 0 ? prefix.slice(0, boundary) : prefix;
}

/** Folding retains omitted choices as prose without sending invalid native options. */
export function enforceQuestionLimits(
  model: QuestionModel,
  limits: QuestionLimits,
  options: DialectOptions,
): QuestionsResult {
  if (limits.maxQuestions !== null && model.questions.length > limits.maxQuestions) {
    return {
      diagnostics: [
        questionDiagnostic(
          options,
          "/questions",
          `At most ${limits.maxQuestions} questions are supported.`,
        ),
      ],
    };
  }
  return {
    diagnostics: [],
    model: {
      questions: model.questions.map((question) => {
        const count = limits.maxOptions ?? question.options.length;
        const extra = question.options.slice(count);
        const notes: string[] = [];
        if (extra.length > 0) {
          notes.push(
            `Additional choices: ${extra.map((item) => `${item.label}: ${item.description}`).join("; ")}.`,
          );
        }
        if (question.multiSelect && !limits.multiSelect) {
          notes.push("Pick one choice per round and repeat for additional selections.");
        }
        if (question.dynamicOptions !== undefined) {
          notes.push(
            `Populate real label/description choices from ${question.dynamicOptions} before asking.`,
          );
        }
        return {
          ...question,
          header: shortenHeader(question.header, limits.maxHeaderLength),
          options: question.options.slice(0, count),
          question: [question.question, ...notes].join("\n"),
          multiSelect: question.multiSelect && limits.multiSelect,
        };
      }),
    },
  };
}

/** Only exact interaction wrappers are converted; malformed blocks stay visible. */
export function convertInteractionBlocks(text: string, options: DialectOptions): DialectResult {
  const diagnostics: Diagnostic[] = [];
  const tags = /<\/?interaction>/g;
  const examples = interactionExamples(text);
  let opening: { readonly start: number; readonly body: number } | undefined;
  let invalid = false;
  let cursor = 0;
  let output = "";
  for (let match = tags.exec(text); match !== null; match = tags.exec(text)) {
    if (examples.some((span) => span.start <= match.index && match.index < span.end)) continue;
    if (match[0] === "<interaction>") {
      if (opening !== undefined) {
        diagnostics.push(
          diagnostic(
            options,
            { text, offset: match.index },
            "Nested interaction blocks are not supported.",
          ),
        );
        invalid = true;
      } else {
        opening = { start: match.index, body: tags.lastIndex };
        invalid = false;
      }
      continue;
    }
    if (opening === undefined) {
      diagnostics.push(
        diagnostic(
          options,
          { text, offset: match.index },
          "Interaction closing tag has no opening tag.",
        ),
      );
      continue;
    }
    const body = text.slice(opening.body, match.index);
    const parsed = parseStructuredCalls(body, options);
    const lineOffset = text.slice(0, opening.body).split("\n").length - 1;
    diagnostics.push(
      ...parsed.diagnostics.map((item) => ({
        ...item,
        ...(item.line === undefined ? {} : { line: item.line + lineOffset }),
      })),
    );
    const call = parsed.calls[0];
    const exact =
      call !== undefined &&
      call.name === "AskUserQuestion" &&
      body.slice(0, call.start).trim() === "" &&
      body.slice(call.end).trim() === "";
    if (!exact || parsed.calls.length !== 1) {
      diagnostics.push(
        diagnostic(
          options,
          { text, offset: opening.start },
          "Interaction must contain one AskUserQuestion call.",
        ),
      );
    } else if (!invalid && parsed.diagnostics.length === 0) {
      const normalized = normalizeQuestions(call, options);
      diagnostics.push(...normalized.diagnostics);
      if (normalized.model !== undefined) {
        const limited = enforceQuestionLimits(
          normalized.model,
          options.capabilities.questionLimits,
          options,
        );
        diagnostics.push(...limited.diagnostics);
        if (limited.model !== undefined) {
          if (options.renderQuestions === undefined) {
            diagnostics.push(
              diagnostic(
                options,
                { text, offset: opening.start },
                "An adapter question renderer is required.",
              ),
            );
          } else {
            output +=
              text.slice(cursor, opening.start) + options.renderQuestions(limited.model, options);
            cursor = tags.lastIndex;
          }
        }
      }
    }
    opening = undefined;
  }
  if (opening !== undefined) {
    diagnostics.push(
      diagnostic(options, { text, offset: opening.start }, "Unclosed interaction block."),
    );
  }
  return { text: output + text.slice(cursor), diagnostics };
}
