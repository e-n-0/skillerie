import type { Diagnostic } from "../../core/types.js";
import { parseStructuredCalls, resolveAgentAlias } from "../../dialect/index.js";
import type { DialectOptions, DialectResult, StructuredValue } from "../../dialect/index.js";
import { codeLiteral, fencedBlocks, interactionExamples } from "../../dialect/markdown.js";
import { assertNever, literalValue, parseFields, quoteEnd } from "../../dialect/syntax.js";

function valueText(value: StructuredValue): string {
  switch (value.kind) {
    case "literal":
      return JSON.stringify(value.value);
    case "expression":
      return value.text;
    default:
      return assertNever(value);
  }
}

export function renderDelegation(
  fields: Readonly<Record<string, StructuredValue>>,
  options: DialectOptions,
): DialectResult {
  const diagnostics: Diagnostic[] = [];
  for (const key of ["subagent_type", "prompt", "description"]) {
    const value = fields[key];
    if (value?.kind === "literal" && typeof value.value !== "string")
      diagnostics.push({
        severity: "error",
        code: "codex.task",
        message: `${key} must be a string or runtime expression.`,
        ...(options.file === undefined ? {} : { file: options.file }),
      });
  }
  if (diagnostics.length > 0) return { text: "", diagnostics };
  const agent = fields["subagent_type"];
  const route =
    agent?.kind === "literal" && typeof agent.value === "string"
      ? JSON.stringify(resolveAgentAlias(agent.value, options))
      : agent === undefined
        ? JSON.stringify("general-purpose")
        : valueText(agent);
  const prompt = fields["prompt"] ?? fields["description"];
  const message =
    prompt === undefined ? JSON.stringify("Complete the delegated task.") : valueText(prompt);
  return {
    text: `spawn_agent({"agent_type":${route},"message":${message}})`,
    diagnostics,
  };
}

const fieldStart =
  /^[ \t]*(subagent_type|description|prompt|run_in_background|model|resume|command)[ \t]*[:=][ \t]*/;

/** Read whole assignments so blank lines and field names inside prompts stay opaque. */
function assignmentBlock(
  text: string,
  start: number,
): { readonly end: number; readonly body: string } | undefined {
  const entries: string[] = [];
  let cursor = start;
  while (cursor < text.length) {
    const field = fieldStart.exec(text.slice(cursor));
    if (field === null) break;
    const valueStart = cursor + field[0].length;
    const quoted = text[valueStart] === '"' || text[valueStart] === "'";
    const lineEnd = text.indexOf("\n", valueStart);
    const end = quoted ? quoteEnd(text, valueStart) : lineEnd < 0 ? text.length : lineEnd;
    if (end === undefined) return undefined;
    const value = text.slice(valueStart, end).trim().replace(/,$/, "");
    const suffix = quoted ? /^[ \t]*,?[ \t]*(?:\r?\n|$)/.exec(text.slice(end)) : null;
    if (quoted && suffix === null) return undefined;
    entries.push(`${field[1] ?? ""}=${value}`);
    cursor = quoted ? end + (suffix?.[0].length ?? 0) : end < text.length ? end + 1 : end;
  }
  return entries.length === 0 ? undefined : { end: cursor, body: entries.join(",") };
}

function rewriteDelegationBlocks(
  text: string,
  options: DialectOptions,
  rewriteText: (text: string) => DialectResult,
): DialectResult {
  const fences = fencedBlocks(text);
  const examples = interactionExamples(text);
  const diagnostics: Diagnostic[] = [];
  const rewrite = (source: string): string => {
    const result = rewriteText(source);
    diagnostics.push(...result.diagnostics);
    return result.text;
  };
  const pattern = /^[ \t]*(?:subagent_type|description|prompt|run_in_background)[ \t]*[:=]/gm;
  let output = "";
  let cursor = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    if (examples.some((span) => span.start <= match.index && match.index < span.end)) continue;
    const fence = fences.find((span) => span.start <= match.index && match.index < span.end);
    if (
      fence !== undefined &&
      (!["", "text", "plaintext"].includes(fence.language) || codeLiteral(text, fence, match.index))
    )
      continue;
    const block = assignmentBlock(text, match.index);
    if (block === undefined) continue;
    pattern.lastIndex = block.end;
    const fields = parseFields(block.body);
    if (fields?.["subagent_type"] === undefined || fields["prompt"] === undefined) continue;
    const result = renderDelegation(
      Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, literalValue(value)])),
      options,
    );
    diagnostics.push(...result.diagnostics);
    const newline = text.slice(match.index, block.end).endsWith("\n") ? "\n" : "";
    output += rewrite(text.slice(cursor, match.index)) + result.text + newline;
    cursor = block.end;
  }
  return { text: output + rewrite(text.slice(cursor)), diagnostics };
}

/** Native payloads are emitted after prose conversion so messages remain opaque. */
export function rewriteDelegations(
  text: string,
  options: DialectOptions,
  rewriteText: (text: string) => DialectResult,
): DialectResult {
  const calls = parseStructuredCalls(text, options).calls.filter(
    (call) => call.name === "Task" || call.name === "Agent",
  );
  const diagnostics: Diagnostic[] = [];
  const rewrite = (source: string): string => {
    const result = rewriteDelegationBlocks(source, options, rewriteText);
    diagnostics.push(...result.diagnostics);
    return result.text;
  };
  let output = "";
  let cursor = 0;
  for (const call of calls) {
    const result = renderDelegation(call.arguments, options);
    diagnostics.push(...result.diagnostics);
    output += rewrite(text.slice(cursor, call.start)) + result.text;
    cursor = call.end;
  }
  return { text: output + rewrite(text.slice(cursor)), diagnostics };
}
