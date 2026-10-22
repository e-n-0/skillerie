import { expect, it } from "vitest";
import { loadConfig } from "../../src/config/index.js";
import { configRepo, env } from "./fixture.js";

it("accepts all authoring fields when a complete version one config is loaded", async () => {
  // Given: neutral content exercising every declared schema shape.
  const override = {
    name: "debug",
    description: "Use when inspecting an example.",
    "argument-hint": "[path]",
    "user-invocable": false,
    "allowed-tools": ["Read"],
    "disable-model-invocation": true,
    license: "Apache-2.0",
    compatibility: "Example CLI",
    metadata: { nested: [null, true, 1, { server: "docs" }] },
    allowed_tools: "Read",
    skills: ["debug"],
    maxTurns: 5,
    readOnly: true,
    noShell: true,
    requires: {
      bin: ["node"],
      env: "DOCS_HOME",
      os: ["darwin", "linux"],
      harness: ["codex", "pi"],
    },
    enabled: false,
    paths: ["src/**"],
  };
  const selection = {
    enabled: ["debug"],
    disabled: ["old"],
    overrides: { debug: override },
    harnesses: {
      pi: {
        disabled: ["debug"],
        overrides: { debug: { requires: { bin: "node" } } },
      },
    },
  };
  const input = {
    version: 1,
    dialect: 1,
    engine: "^1.2.0",
    starter: { enabled: true, exclude: ["debug"] },
    harnesses: {
      opencode: {
        enabled: true,
        path: "~/runtime",
        assets: ["formatter"],
        options: { url: "https://example.com" },
        replaceAgents: { explorer: "reader" },
      },
    },
    paths: {
      docs: "~/notes",
      backup: "~/backups",
      cache: "~/cache",
      examples: "./examples",
    },
    skills: selection,
    agents: selection,
    rules: selection,
    assets: selection,
    shared: { agentsSkillsDir: "preserve" },
    lint: {
      descriptionPrefix: { value: "Use when", severity: "error" },
      structure: { severity: "warn" },
      questions: { severity: "info", allowProse: ["request an example"] },
      references: { severity: "off" },
    },
    generated: { commit: false },
    hooks: {
      postInstall: ["node bin/setup.js", { command: "node bin/check.js", fatal: false }],
    },
  };
  const repo = await configRepo(JSON.stringify(input));

  // When: the complete configuration is loaded.
  const result = await loadConfig(repo, env);

  // Then: author fields survive normalization without weakening per-harness overrides.
  expect(result.diagnostics).toEqual([]);
  expect(result.config).toMatchObject({
    engine: "^1.2.0",
    skills: selection,
    agents: selection,
    rules: selection,
    assets: selection,
    shared: input.shared,
    lint: input.lint,
    hooks: {
      postInstall: [
        { command: "node bin/setup.js", fatal: true },
        { command: "node bin/check.js", fatal: false },
      ],
    },
  });
});

it.each(["skills", "agents", "rules", "assets"] as const)(
  "defaults sparse per-harness selection when %s is configured",
  async (kind) => {
    // Given: a partial per-harness selection.
    const repo = await configRepo(
      `version: 1\n${kind}:\n  harnesses:\n    codex:\n      disabled: [debug]\n`,
    );

    // When: configuration is loaded.
    const result = await loadConfig(repo, env);

    // Then: selection defaults are applied without losing the disabled list.
    expect(result.config?.[kind]).toEqual({
      enabled: [],
      disabled: [],
      overrides: {},
      harnesses: { codex: { enabled: [], disabled: ["debug"], overrides: {} } },
    });
  },
);

it.each([
  ["engine: 1", "/engine"],
  ["starter: { exclude: [debug, debug] }", "/starter/exclude"],
  ["generated: { commit: yes }", "/generated/commit"],
  ["hooks: { postInstall: [{ fatal: false }] }", "/hooks/postInstall/0/command"],
  ["lint: { references: { severity: unknown } }", "/lint/references/severity"],
  ["agents: { overrides: { reader: { maxTurns: 0 } } }", "/agents/overrides/reader/maxTurns"],
  [
    "assets: { overrides: { formatter: { requires: { os: windows } } } }",
    "/assets/overrides/formatter/requires/os",
  ],
] as const)("rejects invalid schema data when authored as %s", async (source, jsonPath) => {
  // Given: a value outside one of the schema's contracts.
  const repo = await configRepo(`version: 1\n${source}\n`);

  // When: configuration is loaded.
  const result = await loadConfig(repo, env);

  // Then: the invalid input is rejected at the schema boundary.
  expect(result.config).toBeUndefined();
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ jsonPath }));
});
