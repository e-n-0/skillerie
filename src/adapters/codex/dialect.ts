import type { Diagnostic } from "../../core/types.js";
import {
  convertInteractionBlocks,
  enforceQuestionLimits,
  normalizeQuestions,
  parseStructuredCalls,
  rewriteArguments,
  rewriteMcpRefs,
  rewritePluginRoot,
  rewriteTools,
} from "../../dialect/index.js";
import type { DialectOptions, DialectResult, QuestionModel } from "../../dialect/index.js";
import { capabilities } from "./capabilities.js";
import { rewriteDelegations } from "./delegation.js";
import { rewriteSearchCalls } from "../omo/search.js";

export const questionFallback =
  "Use request_user_input in Plan mode, or Default mode with " +
  "default_mode_request_user_input enabled. In exec mode or when the tool is unavailable, " +
  "ask the same question in plain text with numbered choices and wait for the answer.";

export function renderQuestions(model: QuestionModel): string {
  const questions = model.questions.map((question, index) => ({
    id: `question_${index + 1}`,
    header: question.header,
    question: question.question,
    options: question.options,
  }));
  return `${questionFallback}\n\nrequest_user_input(${JSON.stringify({ questions }, null, 2)})`;
}

/** The shared parser owns balanced calls and question schema normalization. */
export function convertText(
  text: string,
  context: { readonly file: string; readonly skillDir?: string },
): DialectResult {
  const options: DialectOptions = {
    harness: "codex",
    capabilities,
    file: context.file,
    renderQuestions,
    arguments: { mode: "replace", text: "the user's invocation prompt" },
  };
  const diagnostics: Diagnostic[] = [];
  const apply = (result: DialectResult): void => {
    diagnostics.push(...result.diagnostics);
    output = result.text;
  };
  let output = text;
  // Older source examples may contain whole fenced or column-zero question calls.
  const calls = parseStructuredCalls(output, options);
  diagnostics.push(...calls.diagnostics);
  for (const call of [...calls.calls].reverse()) {
    if (call.name !== "AskUserQuestion") continue;
    const before = output.slice(0, call.start);
    const after = output.slice(call.end);
    if (before.trimEnd().endsWith("<interaction>")) continue;
    const fenced = /(^|\n)(`{3,})[^\n]*\n\s*$/.exec(before);
    const closing = fenced ? new RegExp(`^\\s*${fenced[2]}[ \\t]*(?:\\n|$)`).exec(after) : null;
    if (!closing && !/(?:^|\n)$/.test(before)) continue;
    const normalized = normalizeQuestions(call, options);
    diagnostics.push(...normalized.diagnostics);
    if (!normalized.model) continue;
    const limited = enforceQuestionLimits(normalized.model, capabilities.questionLimits, options);
    diagnostics.push(...limited.diagnostics);
    if (!limited.model) continue;
    const start = closing && fenced ? fenced.index + (fenced[1]?.length ?? 0) : call.start;
    const end = closing ? call.end + closing[0].length : call.end;
    output = output.slice(0, start) + renderQuestions(limited.model) + output.slice(end);
  }
  apply(convertInteractionBlocks(output, options));
  apply(
    rewriteDelegations(output, options, (part) =>
      rewriteSearchCalls(part, options, (source) => {
        const tools = rewriteTools(source, options);
        const mcp = rewriteMcpRefs(tools.text, options);
        const argumentsResult = rewriteArguments(mcp.text, options);
        const rooted = rewritePluginRoot(argumentsResult.text, {
          ...options,
          skillDir: context.skillDir ?? "",
        });
        return {
          text: rooted.text,
          diagnostics: [
            ...tools.diagnostics,
            ...mcp.diagnostics,
            ...argumentsResult.diagnostics,
            ...rooted.diagnostics,
          ],
        };
      }),
    ),
  );
  return { text: output, diagnostics };
}
