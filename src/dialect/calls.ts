import type { Diagnostic } from "../core/types.js";
import type { DialectOptions, StructuredCall, StructuredCallsResult } from "./types.js";
import { balancedEnd, diagnostic, literalValue, parseFields } from "./syntax.js";
import { codeLiteral, fencedBlocks, interactionExamples } from "./markdown.js";

const fields = {
  Task: [
    "subagent_type",
    "prompt",
    "description",
    "model",
    "resume",
    "command",
    "run_in_background",
  ],
  Agent: [
    "subagent_type",
    "prompt",
    "description",
    "model",
    "resume",
    "command",
    "run_in_background",
  ],
  Skill: ["skill", "args"],
  AskUserQuestion: ["questions", "header", "question", "options", "multiSelect"],
} as const;

/** Namespaces are authoring conveniences, not part of native agent identities. */
export function resolveAgentAlias(name: string, options: DialectOptions): string {
  const bare = name.slice(name.lastIndexOf(":") + 1);
  const replacements = options.capabilities.nativeAgentReplacements;
  return Object.hasOwn(replacements, bare) ? (replacements[bare] ?? bare) : bare;
}

/** Reject references embedded in URL/path tokens without touching surrounding prose. */
export function protectedReference(text: string, start: number, end: number): boolean {
  const left = text.slice(0, start).match(/[^\s`"'()[\]{},;<>]*$/)?.[0] ?? "";
  const right = text.slice(end).match(/^[^\s`"'()[\]{},;<>]*/)?.[0] ?? "";
  return (
    /[/\\]/.test(left + right) ||
    /[\w.:-]$/.test(left) ||
    /\.\s*$/.test(text.slice(0, start)) ||
    /^[\w-]/.test(right)
  );
}

export function parseStructuredCalls(text: string, options: DialectOptions): StructuredCallsResult {
  const calls: StructuredCall[] = [];
  const diagnostics: Diagnostic[] = [];
  const examples = interactionExamples(text);
  const fences = fencedBlocks(text);
  const pattern = /\b(Task|Agent|Skill|AskUserQuestion)(\s*)\(/g;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    if (examples.some((span) => span.start <= match.index && match.index < span.end)) continue;
    const name = match[1];
    if (name !== "Task" && name !== "Agent" && name !== "Skill" && name !== "AskUserQuestion")
      continue;
    if (protectedReference(text, match.index, match.index + name.length)) continue;
    const fence = fences.find((span) => span.start <= match.index && match.index < span.end);
    const fenced = fence !== undefined;
    if (fence !== undefined && codeLiteral(text, fence, match.index)) continue;
    const before = text.slice(text.lastIndexOf("\n", match.index - 1) + 1, match.index);
    if (fenced && /\b(?:func|function|class|interface|type|new)\b/.test(before)) continue;
    const start = pattern.lastIndex - 1;
    const tail = text.slice(start + 1);
    // Whitespace before "(" is common prose unless named arguments follow.
    if ((fenced || match[2] !== "") && !/^\s*(?:\{|[A-Za-z_]\w*\s*[:=])/.test(tail)) continue;
    const end = balancedEnd(text, start);
    if (fenced && end !== undefined && /^\s*[:{]/.test(text.slice(end))) continue;
    if (end === undefined) {
      diagnostics.push(
        diagnostic(options, { text, offset: match.index }, `Unbalanced ${name} call.`),
      );
      continue;
    }
    const parsed = parseFields(text.slice(start + 1, end - 1));
    const allowed: readonly string[] = fields[name];
    if (
      fenced &&
      parsed !== undefined &&
      (Object.keys(parsed).length === 0 ||
        Object.keys(parsed).some((key) => !allowed.includes(key)))
    )
      continue;
    if (parsed === undefined) {
      diagnostics.push(
        diagnostic(options, { text, offset: match.index }, `Invalid ${name} arguments.`),
      );
    } else {
      for (const key of Object.keys(parsed)) {
        if (!allowed.includes(key)) {
          diagnostics.push(
            diagnostic(options, { text, offset: match.index }, `Unknown ${name} field: ${key}.`),
          );
        }
      }
      calls.push({
        name,
        start: match.index,
        end,
        arguments: Object.fromEntries(
          Object.entries(parsed).map(([key, value]) => [key, literalValue(value)]),
        ),
      });
    }
    pattern.lastIndex = end;
  }
  return { calls, diagnostics };
}
