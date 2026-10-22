import type { Diagnostic, JsonObject } from "../../core/types.js";
import {
  enforceQuestionLimits,
  normalizeQuestions,
  parseStructuredCalls,
  resolveAgentAlias,
  type DialectOptions,
  type DialectResult,
  type StructuredValue,
} from "../../dialect/index.js";
import { renderQuestions } from "./questions.js";

function stringArgument(value: StructuredValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  switch (value.kind) {
    case "literal":
      return typeof value.value === "string" ? value.value : undefined;
    case "expression":
      return value.text;
    default:
      return unreachable(value);
  }
}

function unreachable(value: never): never {
  throw new TypeError(`Unknown structured value: ${String(value)}`);
}

export function convertCalls(text: string, options: DialectOptions): DialectResult {
  const parsed = parseStructuredCalls(text, options);
  const diagnostics: Diagnostic[] = [...parsed.diagnostics];
  let output = "";
  let cursor = 0;
  for (const call of parsed.calls) {
    const fields = call.arguments;
    let replacement: string | undefined;
    switch (call.name) {
      case "Task":
      case "Agent": {
        const args: JsonObject = {
          subagent_type: resolveAgentAlias(
            stringArgument(fields["subagent_type"]) ?? "general-purpose",
            options,
          ),
          description: stringArgument(fields["description"]) ?? "<task description>",
          prompt: stringArgument(fields["prompt"]) ?? "<task prompt>",
          ...(fields["resume"] === undefined
            ? {}
            : { task_id: stringArgument(fields["resume"]) ?? "" }),
          ...(fields["command"] === undefined
            ? {}
            : { command: stringArgument(fields["command"]) ?? "" }),
        };
        replacement = `task(${JSON.stringify(args)})`;
        break;
      }
      case "Skill": {
        const name = stringArgument(fields["skill"]);
        if (!name) {
          diagnostics.push({
            severity: "error",
            code: "opencode.skillCall",
            message: "Skill calls require a nonempty skill name.",
            ...(options.file === undefined ? {} : { file: options.file }),
          });
          break;
        }
        const args = stringArgument(fields["args"]);
        replacement = `skill(${JSON.stringify({ name: name.slice(name.lastIndexOf(":") + 1) })})`;
        if (args !== undefined) replacement += `\nInvocation context: ${args}`;
        break;
      }
      case "AskUserQuestion": {
        const normalized = normalizeQuestions(call, options);
        diagnostics.push(...normalized.diagnostics);
        if (normalized.model === undefined) break;
        const limited = enforceQuestionLimits(
          normalized.model,
          options.capabilities.questionLimits,
          options,
        );
        diagnostics.push(...limited.diagnostics);
        if (limited.model !== undefined) replacement = renderQuestions(limited.model);
        break;
      }
      default:
        return unreachable(call.name);
    }
    if (replacement !== undefined) {
      output += text.slice(cursor, call.start) + replacement;
      cursor = call.end;
    }
  }
  return { text: output + text.slice(cursor), diagnostics };
}
