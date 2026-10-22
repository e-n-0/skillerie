import { Ajv, type ValidateFunction } from "ajv";
import type {
  AgentFrontmatter,
  Diagnostic,
  JsonObject,
  Requires,
  SkillFrontmatter,
} from "../core/types.js";
import { pointerToken } from "./json.js";

export const harnessIds = ["opencode", "codex", "omo", "pi"] as const;
const text = { type: "string" } as const;
const strings = { type: "array", items: text } as const;
const stringList = { anyOf: [text, strings] } as const;
const requirement = (values?: readonly string[]) => ({
  anyOf: [
    { type: "string", minLength: 1, ...(values ? { enum: values } : {}) },
    { type: "array", items: { type: "string", minLength: 1, ...(values ? { enum: values } : {}) } },
  ],
});
export const requiresSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    bin: requirement(),
    env: requirement(),
    os: requirement(["darwin", "linux"]),
    harness: requirement(harnessIds),
  },
} as const;
const common = {
  name: { type: "string", minLength: 1, maxLength: 64, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
  description: { type: "string", minLength: 1, pattern: "\\S" },
  requires: requiresSchema,
} as const;
const ajv = new Ajv({ allErrors: true, ownProperties: true });
export const skillSchema = ajv.compile<SkillFrontmatter>({
  type: "object",
  additionalProperties: false,
  required: ["name", "description", "argument-hint", "user-invocable"],
  properties: {
    ...common,
    "argument-hint": text,
    "user-invocable": { type: "boolean" },
    "allowed-tools": stringList,
    "disable-model-invocation": { type: "boolean" },
    license: text,
    compatibility: text,
    metadata: { type: "object" },
  },
});
export const agentSchema = ajv.compile<AgentFrontmatter>({
  type: "object",
  additionalProperties: false,
  required: ["name", "description"],
  properties: {
    ...common,
    allowed_tools: stringList,
    skills: strings,
    maxTurns: { type: "integer", minimum: 1 },
    readOnly: { type: "boolean" },
    noShell: { type: "boolean" },
  },
});
export interface RuleFields {
  readonly name?: string;
  readonly paths?: readonly string[];
  readonly requires?: Requires;
}
export const ruleSchema = ajv.compile<RuleFields>({
  type: "object",
  additionalProperties: false,
  properties: { name: common.name, paths: strings, requires: requiresSchema },
});

/** Ajv narrows parsed JSON into the shared domain contract at the boundary. */
export function validateFields<T>(
  validator: ValidateFunction<T>,
  data: JsonObject,
  file: string,
): { readonly value?: T; readonly diagnostics: readonly Diagnostic[] } {
  if (validator(data)) return { value: data, diagnostics: [] };
  const errors = validator.errors ?? [];
  // Unknown fields are common in shared skills (imported metadata); warn and ignore them.
  const diagnostics: Diagnostic[] = errors.map((error) => {
    const unknown = error.keyword === "additionalProperties";
    const property: unknown = error.params["missingProperty"] ?? error.params["additionalProperty"];
    return {
      severity: unknown ? "warn" : "error",
      code: unknown ? "source.frontmatter.unknown" : "source.frontmatter",
      message: unknown
        ? `Unknown field ${typeof property === "string" ? `"${property}"` : ""} is ignored.`
        : (error.message ?? "Invalid field."),
      file,
      jsonPath:
        error.instancePath + (typeof property === "string" ? `/${pointerToken(property)}` : ""),
    };
  });
  if (errors.every((error) => error.keyword === "additionalProperties")) {
    const unknownKeys = new Set(
      errors
        .map((error) => error.params["additionalProperty"])
        .filter((key) => typeof key === "string"),
    );
    const stripped = Object.fromEntries(
      Object.entries(data).filter(([key]) => !unknownKeys.has(key)),
    );
    if (validator(stripped)) return { value: stripped, diagnostics };
  }
  return { diagnostics };
}

/** Keep a useful final sentence; otherwise reserve three characters for "...". */
export function capDescription(description: string): string {
  const normalized = description.replace(/\s+/g, " ").trim();
  const characters = Array.from(normalized);
  if (characters.length <= 1024) return normalized;
  const prefix = characters.slice(0, 1021).join("");
  const boundaries = [...prefix.matchAll(/[.!?](?=\s|$)/g)];
  const boundary = boundaries.at(-1)?.index;
  return boundary !== undefined && Array.from(prefix.slice(0, boundary + 1)).length >= 512
    ? prefix.slice(0, boundary + 1)
    : `${prefix.trimEnd()}...`;
}
