import { createHash } from "node:crypto";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadConfig } from "../../src/config/index.js";
import { configRepo, env } from "./fixture.js";

it("applies normalized defaults when the config contains only its version", async () => {
  // Given: the minimum versioned configuration and a captured home.
  const repo = await configRepo("version: 1\n");
  const hash = createHash("sha256").update(repo).digest("hex");
  const selection = { enabled: [], disabled: [], overrides: {}, harnesses: {} };

  // When: configuration is loaded.
  const result = await loadConfig(repo, env);

  // Then: every omitted setting has a deterministic normalized value.
  expect(result).toEqual({
    config: {
      version: 1,
      dialect: 1,
      harnesses: {},
      paths: {
        repo,
        home: "/home/alice",
        docs: "/home/alice/docs",
        backup: "/home/alice/.Trash/skillerie",
        cache: `/home/alice/.cache/skillerie/${hash}`,
      },
      sources: {
        skills: join(repo, "skills"),
        agents: join(repo, "agents"),
        rules: join(repo, "rules"),
        instructions: join(repo, "instructions.md"),
        mcp: join(repo, "mcp.json"),
        bin: join(repo, "bin"),
        harnesses: join(repo, "harnesses"),
      },
      skills: selection,
      agents: selection,
      rules: selection,
      assets: selection,
      shared: { agentsSkillsDir: "dedupe" },
      lint: {
        descriptionPrefix: { value: "Use when", severity: "warn" },
        structure: { severity: "off" },
        questions: { severity: "error", allowProse: [] },
        references: { severity: "error" },
      },
      generated: { commit: false },
      hooks: { postInstall: [] },
    },
    diagnostics: [],
  });
});

it.each([
  ["opencode", "/home/alice/.config/opencode"],
  ["codex", "/home/alice/.codex"],
  ["omo", "/home/alice/.omo"],
  ["pi", "/home/alice/.pi/agent"],
] as const)("defaults %s when the harness is configured", async (name, path) => {
  // Given: an opted-in harness with no explicit settings.
  const repo = await configRepo(`version: 1\nharnesses:\n  ${name}: {}\n`);

  // When: configuration is loaded.
  const result = await loadConfig(repo, env);

  // Then: the harness is enabled with default runtime options.
  expect(result.config?.harnesses[name]).toEqual({
    enabled: true,
    path,
    options: name === "omo" ? { agentDir: "/home/alice/.omo/agent" } : {},
  });
});

it.each([
  ["XDG_CONFIG_HOME", "/home/alice/config", "opencode", "/home/alice/config/opencode"],
  ["CODEX_HOME", "/home/alice/codex", "codex", "/home/alice/codex"],
] as const)("honors %s when resolving a default harness path", async (key, value, name, path) => {
  // Given: an environment override distinct from the default.
  const repo = await configRepo(`version: 1\nharnesses:\n  ${name}: {}\n`);

  // When: configuration is loaded with the captured environment.
  const result = await loadConfig(repo, { ...env, [key]: value });

  // Then: the configured harness uses the environment root.
  expect(result.config?.harnesses[name]?.path).toBe(path);
});

it("honors the agent directory override when OMO is configured", async () => {
  // Given: an explicit OMO root and a separate environment agent root.
  const repo = await configRepo("version: 1\nharnesses:\n  omo:\n    path: ~/runtime\n");

  // When: configuration is loaded with the agent directory override.
  const result = await loadConfig(repo, {
    ...env,
    OMO_CODING_AGENT_DIR: "/home/alice/content",
  });

  // Then: runtime and agent roots remain separate.
  expect(result.config?.harnesses.omo).toMatchObject({
    path: "/home/alice/runtime",
    options: { agentDir: "/home/alice/content" },
  });
});

it("uses an explicit harness path when a default environment root exists", async () => {
  // Given: a configured path that differs from the environment default.
  const repo = await configRepo("version: 1\nharnesses:\n  codex:\n    path: ./runtime\n");

  // When: configuration is loaded.
  const result = await loadConfig(repo, {
    ...env,
    CODEX_HOME: "/home/alice/fallback",
  });

  // Then: author configuration takes precedence over the default root.
  expect(result.config?.harnesses.codex?.path).toBe(join(repo, "runtime"));
});

it("uses the backup override when a different backup path is configured", async () => {
  // Given: both a configured path and the backup environment override.
  const repo = await configRepo("version: 1\npaths:\n  backup: ~/configured\n");

  // When: configuration is loaded.
  const result = await loadConfig(repo, {
    ...env,
    SKILLERIE_BACKUP_DIR: "~/backups",
  });

  // Then: the explicit environment override selects the backup directory.
  expect(result.config?.paths.backup).toBe("/home/alice/backups");
});

it("uses the XDG cache root when output is not committed", async () => {
  // Given: a cache environment distinct from the home default.
  const repo = await configRepo("version: 1\n");
  const hash = createHash("sha256").update(repo).digest("hex");

  // When: configuration is loaded.
  const result = await loadConfig(repo, {
    ...env,
    XDG_CACHE_HOME: "/home/alice/cache",
  });

  // Then: the cache is namespaced by repository identity.
  expect(result.config?.paths.cache).toBe(`/home/alice/cache/skillerie/${hash}`);
});

it("uses repository output when generated commits are enabled", async () => {
  // Given: committed generation and a conflicting author cache directory.
  const repo = await configRepo(
    "version: 1\ngenerated:\n  commit: true\npaths:\n  cache: ~/unused\n",
  );

  // When: configuration is loaded.
  const result = await loadConfig(repo, {
    ...env,
    XDG_CACHE_HOME: "/home/alice/unused",
  });

  // Then: committed output lives in the repository.
  expect(result.config?.paths.cache).toBe(join(repo, "generated"));
});

it("keeps disabled harnesses disabled when defaults are applied", async () => {
  // Given: an explicitly disabled harness.
  const repo = await configRepo("version: 1\nharnesses:\n  pi:\n    enabled: false\n");

  // When: configuration is loaded.
  const result = await loadConfig(repo, env);

  // Then: opt-out is not replaced by the enabled default.
  expect(result.config?.harnesses.pi?.enabled).toBe(false);
});
