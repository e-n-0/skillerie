import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { loadConfig } from "../../src/config/index.js";
import { lintModel } from "../../src/lint/index.js";
import { discoverSources } from "../../src/model/index.js";
import { agent, discover, fixture, skill, config } from "./helpers.js";

let repo: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  repo = await fixture();
});
afterEach(async () => {
  await repo.cleanup();
});

it("discovers recursive entrypoints when skills and agents are grouped", async () => {
  // Given
  await repo.put("skills/group/example/SKILL.md", skill("example"));
  await repo.put("agents/group/reviewer.md", agent("reviewer"));
  // When
  const model = await discover(repo.root);
  // Then
  expect(model.skills.map((entry) => entry.name)).toEqual(["example"]);
  expect(model.agents.map((entry) => entry.name)).toEqual(["reviewer"]);
  expect(model.skills[0]?.file).toBe(join(repo.root, "skills/group/example/SKILL.md"));
});

it("separates support files when independently nested skill roots exist", async () => {
  // Given
  await repo.put("skills/outer/SKILL.md", skill("outer"));
  await repo.put("skills/outer/reference.md", "reference");
  await repo.put("skills/outer/group/inner/SKILL.md", skill("inner"));
  await repo.put("skills/outer/group/inner/script.sh", "script");
  // When
  const model = await discover(repo.root);
  // Then
  expect(
    model.skills
      .find((entry) => entry.name === "outer")
      ?.supportFiles.map((entry) => entry.relPath),
  ).toEqual(["reference.md"]);
  expect(
    model.skills
      .find((entry) => entry.name === "inner")
      ?.supportFiles.map((entry) => entry.relPath),
  ).toEqual(["script.sh"]);
});

it("retains executable bits when support files are discovered", async () => {
  // Given
  await repo.put("skills/example/SKILL.md", skill("example"));
  const script = await repo.put("skills/example/bin/run.sh", "exit 0\n");
  await chmod(script, 0o751);
  // When
  const model = await discover(repo.root);
  // Then
  expect(model.skills[0]?.supportFiles[0]?.mode).toBe(0o751);
});

it.each([".DS_Store", ".git/objects/data", "__pycache__/data", "cache.pyc", "cache.pyo"])(
  "ignores junk %s when copying support files",
  async (path) => {
    // Given
    await repo.put("skills/example/SKILL.md", skill("example"));
    await repo.put(`skills/example/${path}`, "junk");
    // When
    const model = await discover(repo.root);
    // Then
    expect(model.skills[0]?.supportFiles).toEqual([]);
  },
);

it("ignores entrypoints when they are inside ignored directories", async () => {
  // Given
  await repo.put("skills/.git/hidden/SKILL.md", "invalid");
  await repo.put("agents/__pycache__/hidden.md", "invalid");
  // When
  const model = await discover(repo.root);
  // Then
  expect(model.skills).toEqual([]);
  expect(model.agents).toEqual([]);
});

it("loads rule applicability when paths and requires are authored", async () => {
  // Given
  await repo.put(
    "rules/typescript.md",
    "---\npaths: ['src/**/*.ts']\nrequires:\n  bin: node\n---\nrule\n",
  );
  await repo.put("rules/nested/ignored.md", "ignored");
  // When
  const model = await discover(repo.root);
  // Then
  expect(
    model.rules.map((rule) => ({ name: rule.name, paths: rule.paths, requires: rule.requires })),
  ).toEqual([{ name: "typescript", paths: ["src/**/*.ts"], requires: { bin: "node" } }]);
});

it("supports plain rules when frontmatter is absent", async () => {
  // Given
  await repo.put("rules/shared.md", "rule\n");
  // When
  const model = await discover(repo.root);
  // Then
  expect(model.rules[0]?.paths).toEqual([]);
  expect(model.rules[0]?.body).toBe("rule\n");
});

it("retains instruction bytes when instructions are discovered", async () => {
  // Given
  await repo.put("instructions.md", "instructions\r\n");
  // When
  const model = await discover(repo.root);
  // Then
  expect(model.instructions).toEqual({
    file: join(repo.root, "instructions.md"),
    body: "instructions\r\n",
    source: "user",
  });
});

it("discovers harness resources when templates assets and seeds exist", async () => {
  // Given
  await repo.put("harnesses/omo/templates/nested/config.jsonc", "{ /* comment */ }\n");
  await repo.put("harnesses/omo/templates/config.toml", "enabled = true\n");
  await repo.put("harnesses/omo/templates/settings.json", "{}\n");
  await repo.put("harnesses/omo/templates/notes.txt", "notes\n");
  await repo.put("harnesses/omo/assets/plugins/plugin.js", "export {};\n");
  await repo.put("harnesses/omo/assets/theme.json", "{}");
  await repo.put("harnesses/omo/seeds/state/ready", "1");
  await repo.put("bin/helper.sh", "exit 0\n");
  // When
  const model = await discover(repo.root);
  // Then
  expect(model.templates.omo?.files.map((file) => [file.relPath, file.format])).toEqual([
    ["config.toml", "toml"],
    ["nested/config.jsonc", "jsonc"],
    ["notes.txt", "text"],
    ["settings.json", "json"],
  ]);
  expect(model.assets.map((asset) => [asset.name, asset.kind, asset.harness])).toEqual([
    ["plugins", "directory", "omo"],
    ["theme.json", "file", "omo"],
  ]);
  expect(model.seeds[0]?.relPath).toBe("state/ready");
  expect(model.bin[0]?.relPath).toBe("helper.sh");
});

it("discovers empty assets when an opted-in directory has no files", async () => {
  // Given
  await mkdir(join(repo.root, "harnesses/omo/assets/empty"), { recursive: true });
  const base = config(repo.root);
  // When
  const model = await discover(repo.root, {
    harnesses: {
      omo: {
        ...base.harnesses.omo,
        enabled: true,
        path: "/home/alice/.omo",
        assets: ["empty"],
        options: {},
        replaceAgents: {},
      },
    },
  });
  // Then
  expect(model.harnesses.omo?.assets[0]).toMatchObject({ name: "empty", kind: "directory" });
});

it("limits scoped sources when only one harness owns them", async () => {
  // Given
  await repo.put("harnesses/codex/skills/scoped/SKILL.md", skill("scoped"));
  await repo.put("harnesses/codex/agents/scoped-agent.md", agent("scoped-agent"));
  // When
  const model = await discover(repo.root);
  // Then
  expect(model.skills[0]).toMatchObject({
    source: "harness-scoped",
    harness: "codex",
    harnesses: ["codex"],
  });
  expect(model.harnesses.opencode?.skills).toEqual([]);
  expect(model.harnesses.codex?.agents.map((entry) => entry.name)).toEqual(["scoped-agent"]);
});

it("sorts inventory when files were authored in another order", async () => {
  // Given
  await repo.put("skills/zulu/SKILL.md", skill("zulu"));
  await repo.put("skills/alpha/SKILL.md", skill("alpha"));
  // When
  const model = await discover(repo.root);
  // Then
  expect(model.skills.map((entry) => entry.name)).toEqual(["alpha", "zulu"]);
});

it("discovers all configured source families", async () => {
  // Given
  const skillFile = await repo.put("content/skills/example/SKILL.md", skill("example"));
  const agentFile = await repo.put("content/agents/reviewer.md", agent("reviewer"));
  const ruleFile = await repo.put("content/rules/shared.md", "rule\n");
  const instructionsFile = await repo.put("notes/instructions.md", "instructions\n");
  const mcpFile = await repo.put("integrations/servers.json", '{"mcpServers":{}}\n');
  const binFile = await repo.put("tools/helper.sh", "exit 0\n");
  const templateFile = await repo.put(
    "runtime/harnesses/omo/templates/config.toml",
    "enabled = true\n",
  );
  await repo.put(
    "skillerie.yaml",
    [
      "version: 1",
      "sources:",
      "  skills: '${repo}/content/skills'",
      "  agents: content/agents",
      "  rules: content/rules",
      "  instructions: notes/instructions.md",
      "  mcp: integrations/servers.json",
      "  bin: tools",
      "  harnesses: runtime/harnesses",
    ].join("\n"),
  );
  const loaded = await loadConfig(repo.root, { HOME: "/home/alice" });
  if (!loaded.config) throw new Error(JSON.stringify(loaded.diagnostics));

  // When
  const result = await discoverSources(repo.root, loaded.config);
  if (!result.model) throw new Error(JSON.stringify(result.diagnostics));

  // Then
  expect(result.model.skills[0]?.file).toBe(skillFile);
  expect(result.model.agents[0]?.file).toBe(agentFile);
  expect(result.model.rules[0]?.file).toBe(ruleFile);
  expect(result.model.instructions?.file).toBe(instructionsFile);
  expect(result.model.mcp?.file).toBe(mcpFile);
  expect(result.model.bin[0]?.sourcePath).toBe(binFile);
  expect(result.model.templates.omo?.files[0]?.file).toBe(templateFile);
});

it("lints a skill discovered from a configured source path", async () => {
  // Given
  const skillFile = await repo.put("content/skills/example/SKILL.md", skill("example"));
  await repo.put("skillerie.yaml", "version: 1\nsources:\n  skills: content/skills\n");
  const loaded = await loadConfig(repo.root, { HOME: "/home/alice" });
  if (!loaded.config) throw new Error(JSON.stringify(loaded.diagnostics));
  const result = await discoverSources(repo.root, loaded.config);
  if (!result.model) throw new Error(JSON.stringify(result.diagnostics));

  // When
  const findings = lintModel(result.model, loaded.config);

  // Then
  expect(findings).toContainEqual(
    expect.objectContaining({
      code: "lint.description.prefix",
      file: skillFile,
    }),
  );
});
