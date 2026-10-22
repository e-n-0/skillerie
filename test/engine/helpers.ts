import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistry } from "../../src/adapters/index.js";
import type { Adapter, Environment, HarnessId } from "../../src/core/types.js";

export const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));

export async function sampleRepo() {
  const root = await mkdtemp(join(tmpdir(), "skillerie-engine-"));
  const repo = join(root, "repo");
  await cp(join(fixtures, "sample-repo"), repo, { recursive: true });
  const env: Environment = { HOME: join(root, "home"), PATH: dirname(process.execPath) };
  return { root, repo, env, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** A pure renderer used by both engine and command integration tests. */
export function fakeAdapter(id: HarnessId = "opencode"): Adapter {
  return {
    id,
    supportedRange: ">=1.0.0",
    capabilities: {
      toolMap: { Read: "read" },
      questionLimits: {
        maxHeaderLength: 12,
        maxOptions: 3,
        maxQuestions: 1,
        multiSelect: false,
      },
      permissionEnforcement: { toolAllowlist: true, readOnly: true, noShell: true },
      nativeAgentReplacements: {},
      supportsCommands: true,
      supportsRules: true,
    },
    defaultPaths: () => {
      const home = `/home/alice/.config/${id}`;
      return {
        home,
        configDir: home,
        skillsDir: `${home}/skills`,
        agentsDir: `${home}/agents`,
        rulesDir: `${home}/rules`,
        assetsDir: `${home}/assets`,
        commandsDir: `${home}/commands`,
      };
    },
    render: async (context) => ({
      files: [
        {
          kind: "file",
          relPath: "AGENTS.md",
          content: [
            context.model.instructions?.body ?? "",
            ...(context.model.harnesses[id]?.rules.map((rule) => rule.body) ?? []),
          ].join("\n"),
          mode: 0o644,
        },
        {
          kind: "file",
          relPath: "snapshot.json",
          content: JSON.stringify({
            skills: context.model.harnesses[id]?.skills.map((skill) => skill.name),
            paths: context.paths,
          }),
          mode: 0o644,
        },
      ],
      diagnostics: [],
      metadata: {},
    }),
    targets: () => [],
  };
}

export function adapters(...entries: readonly Adapter[]) {
  return createRegistry(entries.map((adapter) => [adapter.id, async () => ({ adapter })] as const));
}

export const brokenCases = [
  ["schema-error", "config.schema", "skillerie.yaml", "/harnesses/opencode/enabled"],
  ["duplicate-skill-name", "source.duplicate", "skills/nested/example/SKILL.md", "/name"],
  [
    "gated-reference",
    "lint.reference.not-applicable",
    "agents/builder.md",
    "/frontmatter/skills/0",
  ],
  ["unknown-variable", "config.variable", "skillerie.yaml", "/paths/docs"],
  ["unknown-version", "config.unsupportedVersion", "skillerie.yaml", "/version"],
] as const;
