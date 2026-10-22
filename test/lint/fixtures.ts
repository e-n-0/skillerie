import type {
  Agent,
  Diagnostic,
  HarnessId,
  ResolvedConfig,
  Skill,
  SourceModel,
} from "../../src/core/types.js";

const HARNESS_CONFIG = {
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
  omo: {
    enabled: true,
    path: "/home/alice/.omo",
    assets: [],
    options: {},
    replaceAgents: {},
  },
  pi: {
    enabled: true,
    path: "/home/alice/.pi",
    assets: [],
    options: {},
    replaceAgents: {},
  },
} satisfies ResolvedConfig["harnesses"];

const ENTITY_SETTINGS = {
  enabled: [],
  disabled: [],
  overrides: {},
  harnesses: {},
} satisfies ResolvedConfig["skills"];

const DEFAULT_LINT = {
  descriptionPrefix: { value: "Use when", severity: "warn" },
  structure: { severity: "off" },
  questions: { severity: "error", allowProse: [] },
  references: { severity: "error" },
} satisfies ResolvedConfig["lint"];

export const DEFAULT_CONFIG = {
  version: 1,
  dialect: 1,
  starter: { enabled: true, exclude: [] },
  harnesses: HARNESS_CONFIG,
  paths: {
    repo: "/home/alice/project",
    home: "/home/alice",
    docs: "/home/alice/docs",
    backup: "/home/alice/.trash/skillerie",
    cache: "/home/alice/.cache/skillerie",
  },
  skills: ENTITY_SETTINGS,
  agents: ENTITY_SETTINGS,
  rules: ENTITY_SETTINGS,
  assets: ENTITY_SETTINGS,
  shared: { agentsSkillsDir: "dedupe" },
  lint: DEFAULT_LINT,
  generated: { commit: false },
  hooks: { postInstall: [] },
} satisfies ResolvedConfig;

export function configWithLint(lint: Partial<ResolvedConfig["lint"]> = {}): ResolvedConfig {
  return {
    ...DEFAULT_CONFIG,
    lint: { ...DEFAULT_LINT, ...lint },
  };
}

export function skillFixture(input: {
  readonly name: string;
  readonly body?: string;
  readonly appliesTo?: readonly HarnessId[];
  readonly description?: string;
}): Skill {
  const dir = `/home/alice/project/skills/${input.name}`;
  return {
    name: input.name,
    file: `${dir}/SKILL.md`,
    source: "user",
    harnesses: input.appliesTo ?? ["opencode"],
    dir,
    frontmatter: {
      name: input.name,
      description: input.description ?? "Use when a matching task is requested.",
    },
    body: input.body ?? "",
    supportFiles: [],
  };
}

export function agentFixture(input: {
  readonly name: string;
  readonly body?: string;
  readonly appliesTo?: readonly HarnessId[];
  readonly skills?: readonly string[];
}): Agent {
  return {
    name: input.name,
    file: `/home/alice/project/agents/${input.name}.md`,
    source: "user",
    harnesses: input.appliesTo ?? ["opencode"],
    frontmatter: {
      name: input.name,
      description: "Handles a focused task.",
      ...(input.skills === undefined ? {} : { skills: input.skills }),
    },
    body: input.body ?? "",
  };
}

export function modelFixture(
  skills: readonly Skill[] = [],
  agents: readonly Agent[] = [],
): SourceModel {
  const sourcesFor = (harness: HarnessId) => ({
    skills: skills.filter((skill) => skill.harnesses.includes(harness)),
    agents: agents.filter((agent) => agent.harnesses.includes(harness)),
    rules: [],
    assets: [],
  });

  return {
    repoDir: "/home/alice/project",
    skills,
    agents,
    rules: [],
    templates: {},
    assets: [],
    seeds: [],
    bin: [],
    harnesses: {
      opencode: sourcesFor("opencode"),
      codex: sourcesFor("codex"),
      omo: sourcesFor("omo"),
      pi: sourcesFor("pi"),
    },
  };
}

export function diagnosticFacts(diagnostics: readonly Diagnostic[]) {
  return diagnostics.map(({ code, severity, file, jsonPath }) => ({
    code,
    severity,
    file,
    jsonPath,
  }));
}
