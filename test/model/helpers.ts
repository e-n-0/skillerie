import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { EntitySettings, ResolvedConfig } from "../../src/core/types.js";
import { discoverSources } from "../../src/model/index.js";

export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "skillerie-model-"));
  return {
    root,
    async put(path: string, content: string | Buffer) {
      const file = join(root, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content);
      return file;
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export function settings(values: Partial<EntitySettings> = {}): EntitySettings {
  return { enabled: [], disabled: [], overrides: {}, harnesses: {}, ...values };
}

export function config(root: string, values: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    version: 1,
    dialect: 1,
    starter: { enabled: true, exclude: [] },
    harnesses: {
      opencode: {
        enabled: true,
        path: "/home/alice/.config/opencode",
        assets: [],
        options: {},
        replaceAgents: {},
      },
      codex: {
        enabled: true,
        path: "/home/alice/.codex",
        assets: [],
        options: {},
        replaceAgents: {},
      },
      omo: { enabled: true, path: "/home/alice/.omo", assets: [], options: {}, replaceAgents: {} },
      pi: { enabled: false, path: "/home/alice/.pi", assets: [], options: {}, replaceAgents: {} },
    },
    paths: {
      repo: root,
      home: "/home/alice",
      docs: "/home/alice/docs",
      backup: "/home/alice/backup",
      cache: "/home/alice/cache",
    },
    skills: settings(),
    agents: settings(),
    rules: settings(),
    assets: settings(),
    shared: { agentsSkillsDir: "dedupe" },
    lint: {
      descriptionPrefix: { value: "Use when", severity: "warn" },
      structure: { severity: "off" },
      questions: { severity: "error", allowProse: [] },
      references: { severity: "error" },
    },
    generated: { commit: false },
    hooks: { postInstall: [] },
    ...values,
  };
}

export function skill(name: string, fields = "", body = "payload\n"): string {
  return `---\nname: ${name}\ndescription: example\nargument-hint: "[input]"\nuser-invocable: true\n${fields}---\n${body}`;
}

export function agent(name: string, fields = ""): string {
  return `---\nname: ${name}\ndescription: example\n${fields}---\npayload\n`;
}

export async function discover(
  root: string,
  values: Partial<ResolvedConfig> = {},
  starter?: string,
) {
  const result = await discoverSources(root, config(root, values), starter);
  if (!result.model) throw new Error(JSON.stringify(result.diagnostics));
  return result.model;
}
