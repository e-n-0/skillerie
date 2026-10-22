import type { Diagnostic, JsonValue } from "../../core/types.js";
import {
  convertInteractionBlocks,
  enforceQuestionLimits,
  normalizeQuestions,
  parseStructuredCalls,
  resolveAgentAlias,
  rewriteMcpRefs,
  rewritePluginRoot,
  rewriteTools,
} from "../../dialect/index.js";
import type {
  DialectOptions,
  DialectResult,
  McpReference,
  PluginRootOptions,
  StructuredCall,
  StructuredValue,
} from "../../dialect/index.js";
import { capabilities } from "./capabilities.js";
import { renderQuestions } from "./questions.js";

function sourceValue(value: StructuredValue): string {
  switch (value.kind) {
    case "literal":
      return JSON.stringify(value.value);
    case "expression":
      return value.text;
    default:
      throw new TypeError(`Unexpected structured value: ${String(value satisfies never)}`);
  }
}

function renderMcp(reference: McpReference): string {
  const entries = Object.entries(reference.arguments ?? {});
  const dynamic = entries.some(([, value]) => value.kind === "expression");
  const args = dynamic
    ? `JSON.stringify({${entries.map(([key, value]) => `${JSON.stringify(key)}:${sourceValue(value)}`).join(",")}})`
    : JSON.stringify(
        JSON.stringify(
          Object.fromEntries(
            entries.map(([key, value]): [string, JsonValue] => {
              switch (value.kind) {
                case "literal":
                  return [key, value.value];
                case "expression":
                  throw new TypeError("Dynamic MCP arguments require runtime serialization.");
                default:
                  throw new TypeError(`Unexpected value: ${String(value satisfies never)}`);
              }
            }),
          ),
        ),
      );
  const tool = `${reference.server.replaceAll("-", "_")}_${reference.tool}`;
  return `mcp({tool:${JSON.stringify(tool)},args:${args}})`;
}

function renderCall(call: StructuredCall, options: DialectOptions): DialectResult {
  switch (call.name) {
    case "Task":
    case "Agent": {
      const fields = Object.entries(call.arguments).map(([key, value]) => {
        const field = key === "subagent_type" ? "agent" : key === "prompt" ? "task" : key;
        const output =
          field === "agent" && value.kind === "literal" && typeof value.value === "string"
            ? JSON.stringify(resolveAgentAlias(value.value, options))
            : sourceValue(value);
        return `${JSON.stringify(field)}:${output}`;
      });
      return { text: `subagent({${fields.join(",")}})`, diagnostics: [] };
    }
    case "AskUserQuestion": {
      const normalized = normalizeQuestions(call, options);
      if (!normalized.model) return { text: "", diagnostics: normalized.diagnostics };
      const limited = enforceQuestionLimits(normalized.model, capabilities.questionLimits, options);
      return {
        text: limited.model ? renderQuestions(limited.model, options) : "",
        diagnostics: limited.diagnostics,
      };
    }
    case "Skill": {
      const skill = call.arguments["skill"];
      return {
        text: `Read and follow the skill ${skill ? sourceValue(skill) : "named by the task"}.`,
        diagnostics: [],
      };
    }
    default:
      throw new TypeError(`Unexpected call: ${String(call.name satisfies never)}`);
  }
}

export interface MarkdownOptions {
  readonly file: string;
  readonly skillDir?: string;
  readonly childAgent?: boolean;
  readonly skillNames?: readonly string[];
}

/** Shared parsers own the dialect; this module only selects Pi output shapes. */
export function rewriteMarkdown(text: string, context: MarkdownOptions): DialectResult {
  const options: PluginRootOptions = {
    ...context,
    harness: "pi",
    capabilities,
    skillDir: context.skillDir ?? "",
    renderQuestions,
    mcpTemplate: renderMcp,
  };
  const questions = convertInteractionBlocks(text, options);
  const diagnostics: Diagnostic[] = [...questions.diagnostics];
  const parsed = parseStructuredCalls(questions.text, options);
  diagnostics.push(...parsed.diagnostics);
  let output = questions.text;
  // Reverse spans keep source offsets valid without reparsing generated calls.
  for (const call of [...parsed.calls].reverse()) {
    const result = renderCall(call, options);
    diagnostics.push(...result.diagnostics);
    output = output.slice(0, call.start) + result.text + output.slice(call.end);
  }
  for (const convert of [rewriteMcpRefs, rewriteTools, rewritePluginRoot]) {
    const result = convert(output, options);
    output = result.text;
    diagnostics.push(...result.diagnostics);
  }
  // A paired web-tool label is a single Pi tool, not a path reference.
  output = output.replace(
    /\bWeb(?:Search\s*\/\s*WebFetch|Fetch\s*\/\s*WebSearch)\b/g,
    "web_search",
  );
  output = output.replace(/`\/([a-z0-9]+(?:-[a-z0-9]+)*)`/g, (reference, name: string) =>
    context.skillNames?.includes(name) ? `\`/skill:${name}\`` : reference,
  );
  if (context.childAgent) output = output.replaceAll("`ask_user_question`", "the parent agent");
  return { text: output, diagnostics };
}
