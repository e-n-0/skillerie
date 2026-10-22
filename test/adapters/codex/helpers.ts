import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import { parse } from "yaml";
import type { McpConfig, RenderResult, ResolvedContext, Skill } from "../../../src/core/types.js";
import { adapter } from "../../../src/adapters/codex/index.js";
import { validateRepo } from "../../../src/engine/index.js";

export const fixture = fileURLToPath(new URL("../../fixtures/sample-repo", import.meta.url));
export const env = { HOME: "/home/alice", PATH: dirname(process.execPath) };
export const registry = new Map([["codex", async () => ({ adapter })]] as const);

export async function context(): Promise<ResolvedContext> {
  const result = await validateRepo(fixture, { env, adapters: registry });
  if (!result.model || !result.snapshot) throw new TypeError(JSON.stringify(result.diagnostics));
  return {
    model: result.model,
    snapshot: result.snapshot,
    harness: "codex",
    paths: adapter.defaultPaths(env),
    harnessVersion: { supportedRange: adapter.supportedRange },
    env,
  };
}

export function withMcp(ctx: ResolvedContext, mcp: Partial<McpConfig>): ResolvedContext {
  return {
    ...ctx,
    model: {
      ...ctx.model,
      mcp: { file: "mcp.json", mcpServers: {}, harnessOverrides: {}, settings: {}, ...mcp },
    },
  };
}

export function skill(fields: Partial<Skill["frontmatter"]> = {}): Skill {
  return {
    name: "test-skill",
    file: "/home/alice/config/skills/test-skill/SKILL.md",
    dir: "/home/alice/config/skills/test-skill",
    source: "user",
    harnesses: ["codex"],
    frontmatter: {
      name: "test-skill",
      description: "Use when you need to inspect a change. Then verify it.",
      ...fields,
    },
    body: "`Read` the sources.",
    supportFiles: [],
  };
}

export function text(result: RenderResult, path: string): string {
  const file = result.files.find((entry) => entry.relPath === path);
  if (!file) throw new TypeError(`Missing rendered file: ${path}`);
  return file.content.toString();
}

interface NativeQuestions {
  readonly questions: readonly {
    readonly id: string;
    readonly header: string;
    readonly question: string;
    readonly options: readonly { readonly label: string; readonly description: string }[];
  }[];
}

const validateQuestions = new Ajv().compile<NativeQuestions>({
  type: "object",
  required: ["questions"],
  additionalProperties: false,
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "header", "question", "options"],
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          header: { type: "string" },
          question: { type: "string" },
          options: {
            type: "array",
            items: {
              type: "object",
              required: ["label", "description"],
              additionalProperties: false,
              properties: { label: { type: "string" }, description: { type: "string" } },
            },
          },
        },
      },
    },
  },
});

export function nativeQuestions(text: string): NativeQuestions {
  const marker = "\n\nrequest_user_input(";
  const data: unknown = JSON.parse(text.slice(text.indexOf(marker) + marker.length, -1));
  if (!validateQuestions(data)) throw new TypeError(JSON.stringify(validateQuestions.errors));
  return data;
}

interface SkillInterface {
  readonly interface: {
    readonly display_name: string;
    readonly short_description: string;
    readonly default_prompt: string;
  };
  readonly policy?: { readonly allow_implicit_invocation: boolean };
}

const validateInterface = new Ajv().compile<SkillInterface>({
  type: "object",
  required: ["interface"],
  additionalProperties: false,
  properties: {
    interface: {
      type: "object",
      required: ["display_name", "short_description", "default_prompt"],
      additionalProperties: false,
      properties: {
        display_name: { type: "string" },
        short_description: { type: "string" },
        default_prompt: { type: "string" },
      },
    },
    policy: {
      type: "object",
      required: ["allow_implicit_invocation"],
      additionalProperties: false,
      properties: { allow_implicit_invocation: { type: "boolean" } },
    },
  },
});

export function interfaceYaml(text: string): SkillInterface {
  const data: unknown = parse(text);
  if (!validateInterface(data)) throw new TypeError(JSON.stringify(validateInterface.errors));
  return data;
}
