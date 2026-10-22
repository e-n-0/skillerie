import { join } from "node:path";
import type { Diagnostic, ResolvedContext } from "../../core/types.js";
import {
  convertInteractionBlocks,
  enforceQuestionLimits,
  normalizeQuestions,
  parseStructuredCalls,
  resolveAgentAlias,
  rewriteArguments,
  rewriteMcpRefs,
  rewritePluginRoot,
  rewriteTools,
} from "../../dialect/index.js";
import type {
  DialectOptions,
  DialectResult,
  StructuredCall,
  StructuredValue,
} from "../../dialect/index.js";
import { agentDirectory, capabilitiesFor } from "./capabilities.js";
import { renderQuestions } from "./questions.js";
import { rewriteSearchCalls } from "./search.js";

function valueText(value: StructuredValue): string {
  switch (value.kind) {
    case "literal":
      return JSON.stringify(value.value);
    case "expression":
      return value.text;
    default:
      return unreachable(value);
  }
}

function taskCall(call: StructuredCall, options: DialectOptions): DialectResult {
  const diagnostics: Diagnostic[] = [];
  const fields = call.arguments;
  for (const key of ["subagent_type", "prompt", "description"]) {
    const value = fields[key];
    if (value?.kind === "literal" && typeof value.value !== "string") {
      diagnostics.push({
        severity: "error",
        code: "omo.task",
        message: `${key} must be a string or runtime expression.`,
        ...(options.file === undefined ? {} : { file: options.file }),
      });
    }
  }
  const background = fields["run_in_background"];
  if (
    background !== undefined &&
    (background.kind !== "literal" || typeof background.value !== "boolean")
  ) {
    diagnostics.push({
      severity: "error",
      code: "omo.task",
      message: "run_in_background must be a literal boolean.",
      ...(options.file === undefined ? {} : { file: options.file }),
    });
  }
  const agent = fields["subagent_type"];
  const route =
    agent?.kind === "literal" && typeof agent.value === "string"
      ? JSON.stringify(resolveAgentAlias(agent.value, options))
      : agent === undefined
        ? JSON.stringify("general-purpose")
        : valueText(agent);
  const values = [
    `"subagent_type":${route}`,
    `"prompt":${fields["prompt"] === undefined ? JSON.stringify("<task instructions>") : valueText(fields["prompt"])}`,
    `"description":${fields["description"] === undefined ? JSON.stringify("<task summary>") : valueText(fields["description"])}`,
  ];
  if (background !== undefined) values.push(`"run_in_background":${valueText(background)}`);
  return { text: `task({${values.join(",")}})`, diagnostics };
}

function skillCall(call: StructuredCall, ctx: ResolvedContext): DialectResult {
  const skill = call.arguments["skill"];
  const args = call.arguments["args"];
  if (skill?.kind !== "literal" || typeof skill.value !== "string") {
    return {
      text: "",
      diagnostics: [
        {
          severity: "error",
          code: "omo.skill",
          message: "Skill requires a literal skill name.",
        },
      ],
    };
  }
  const name = skill.value.slice(skill.value.lastIndexOf(":") + 1);
  if (!ctx.model.harnesses.omo?.skills.some((entry) => entry.name === name)) {
    return {
      text: "",
      diagnostics: [
        {
          severity: "error",
          code: "omo.skill",
          message: `Skill ${name} is not available for OMO.`,
        },
      ],
    };
  }
  const path = join(agentDirectory(ctx), "skills", name, "SKILL.md");
  return {
    text: `Read \`${path}\` with \`read\` and follow its instructions.${
      args === undefined ? "" : ` Invocation context: ${valueText(args)}.`
    }`,
    diagnostics: [],
  };
}

/** Parse once with shared syntax; only native payload rendering lives here. */
export function convertText(
  text: string,
  ctx: ResolvedContext,
  source: { readonly file: string; readonly skillDir?: string; readonly childAgent?: boolean },
): DialectResult {
  const options: DialectOptions = {
    harness: "omo",
    capabilities: capabilitiesFor(ctx),
    file: source.file,
    ...(source.childAgent === undefined ? {} : { childAgent: source.childAgent }),
    renderQuestions,
    arguments: { mode: "replace", text: "the invocation arguments" },
  };
  const interactions = convertInteractionBlocks(text, options);
  const parsed = parseStructuredCalls(interactions.text, options);
  const diagnostics = [...interactions.diagnostics, ...parsed.diagnostics];
  const rewrite = (text: string): string => {
    const result = rewriteSearchCalls(text, options, (part) => {
      const tools = rewriteTools(part, options);
      const mcp = rewriteMcpRefs(tools.text, {
        ...options,
        mcpTemplate: (reference) => {
          const name = `mcp_${reference.server}_${reference.tool}`;
          if (reference.arguments === undefined) return name;
          return `${name}({${Object.entries(reference.arguments)
            .map(([key, value]) => `${JSON.stringify(key)}:${valueText(value)}`)
            .join(",")}})`;
        },
      });
      const argumentsResult = rewriteArguments(mcp.text, options);
      const rooted =
        source.skillDir === undefined
          ? { text: argumentsResult.text, diagnostics: [] }
          : rewritePluginRoot(argumentsResult.text, { ...options, skillDir: source.skillDir });
      return {
        text: rooted.text,
        diagnostics: [
          ...tools.diagnostics,
          ...mcp.diagnostics,
          ...argumentsResult.diagnostics,
          ...rooted.diagnostics,
        ],
      };
    });
    diagnostics.push(...result.diagnostics);
    return result.text;
  };
  let output = "";
  let cursor = 0;
  for (const call of parsed.calls) {
    let result: DialectResult;
    switch (call.name) {
      case "Task":
      case "Agent":
        result = taskCall(call, options);
        break;
      case "Skill":
        result = skillCall(call, ctx);
        break;
      case "AskUserQuestion": {
        const normalized = normalizeQuestions(call, options);
        diagnostics.push(...normalized.diagnostics);
        if (normalized.model === undefined) continue;
        const limited = enforceQuestionLimits(
          normalized.model,
          options.capabilities.questionLimits,
          options,
        );
        diagnostics.push(...limited.diagnostics);
        if (limited.model === undefined) continue;
        result = { text: renderQuestions(limited.model), diagnostics: [] };
        break;
      }
      default:
        return unreachable(call.name);
    }
    diagnostics.push(...result.diagnostics);
    output += rewrite(interactions.text.slice(cursor, call.start)) + result.text;
    cursor = call.end;
  }
  return {
    text: output + rewrite(interactions.text.slice(cursor)),
    diagnostics,
  };
}

function unreachable(value: never): never {
  throw new TypeError(`Unknown call: ${String(value)}`);
}
