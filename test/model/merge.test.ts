import { afterEach, beforeEach, expect, it } from "vitest";
import { agent, config, discover, fixture, settings, skill } from "./helpers.js";

let repo: Awaited<ReturnType<typeof fixture>>;
let starter: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  repo = await fixture();
  starter = await fixture();
});
afterEach(async () => {
  await repo.cleanup();
  await starter.cleanup();
});

it("replaces the whole skill when user content shadows a starter name", async () => {
  // Given
  await starter.put("skills/example/SKILL.md", skill("example", "license: MIT\n"));
  await starter.put("skills/example/obsolete.txt", "old");
  await repo.put("skills/example/SKILL.md", skill("example"));
  await repo.put("skills/example/current.txt", "new");
  // When
  const model = await discover(repo.root, {}, starter.root);
  // Then
  expect(model.skills[0]?.source).toBe("user");
  expect(model.skills[0]?.supportFiles.map((file) => file.relPath)).toEqual(["current.txt"]);
  expect(model.skills[0]?.frontmatter.license).toBeUndefined();
});

it("replaces agents and rules when user names shadow starter entities", async () => {
  // Given
  await starter.put("agents/reviewer.md", agent("reviewer", "maxTurns: 1\n"));
  await repo.put("agents/reviewer.md", agent("reviewer", "maxTurns: 2\n"));
  await starter.put("rules/shared.md", "---\npaths: ['old/**']\n---\nold\n");
  await repo.put("rules/shared.md", "---\npaths: ['new/**']\n---\nnew\n");
  // When
  const model = await discover(repo.root, {}, starter.root);
  // Then
  expect(model.agents[0]?.frontmatter.maxTurns).toBe(2);
  expect(model.rules[0]?.paths).toEqual(["new/**"]);
});

it("retains starter provenance when no user entity shadows it", async () => {
  // Given
  await starter.put("skills/example/SKILL.md", skill("example"));
  // When
  const model = await discover(repo.root, {}, starter.root);
  // Then
  expect(model.skills[0]?.source).toBe("starter");
});

it("omits all starter content when starter is disabled", async () => {
  // Given
  await starter.put("skills/example/SKILL.md", "invalid");
  await starter.put("instructions.md", "starter");
  // When
  const model = await discover(
    repo.root,
    { starter: { enabled: false, exclude: [] } },
    starter.root,
  );
  // Then
  expect(model.skills).toEqual([]);
  expect(model.instructions).toBeUndefined();
});

it("excludes starter names without excluding their user replacements", async () => {
  // Given
  await starter.put("skills/example/SKILL.md", "invalid");
  await starter.put("agents/reviewer.md", agent("reviewer"));
  await starter.put("rules/shared.md", "rule");
  await repo.put("skills/example/SKILL.md", skill("example"));
  // When
  const model = await discover(
    repo.root,
    { starter: { enabled: true, exclude: ["example", "reviewer", "shared"] } },
    starter.root,
  );
  // Then
  expect(model.skills[0]?.source).toBe("user");
  expect(model.agents).toEqual([]);
  expect(model.rules).toEqual([]);
});

it("replaces instructions when a user file exists", async () => {
  // Given
  await starter.put("instructions.md", "starter");
  await repo.put("instructions.md", "user");
  // When
  const model = await discover(repo.root, {}, starter.root);
  // Then
  expect(model.instructions?.source).toBe("user");
});

it("retains excluded entities when disable lists win over enable lists", async () => {
  // Given
  await repo.put("skills/example/SKILL.md", skill("example"));
  // When
  const model = await discover(repo.root, {
    skills: settings({
      enabled: ["example"],
      disabled: ["example"],
      harnesses: {
        codex: { enabled: ["example"], disabled: [], overrides: { example: { enabled: true } } },
      },
    }),
  });
  // Then
  expect(model.skills[0]?.harnesses).toEqual([]);
  expect(model.harnesses.codex?.skills).toEqual([]);
});

it("applies per-harness disable lists when other harnesses remain enabled", async () => {
  // Given
  await repo.put("agents/reviewer.md", agent("reviewer"));
  // When
  const model = await discover(repo.root, {
    agents: settings({
      harnesses: { codex: { enabled: [], disabled: ["reviewer"], overrides: {} } },
    }),
  });
  // Then
  expect(model.agents[0]?.harnesses).toEqual(["opencode", "omo"]);
  expect(model.harnesses.codex?.agents).toEqual([]);
  expect(model.harnesses.pi).toBeUndefined();
});

it("selects explicit names when a global enable list is nonempty", async () => {
  // Given
  await repo.put("skills/one/SKILL.md", skill("one"));
  await repo.put("skills/two/SKILL.md", skill("two"));
  // When
  const model = await discover(repo.root, { skills: settings({ enabled: ["one"] }) });
  // Then
  expect(model.harnesses.codex?.skills.map((entry) => entry.name)).toEqual(["one"]);
  expect(model.skills.find((entry) => entry.name === "two")?.harnesses).toEqual([]);
});

it("applies harness overrides after global overrides when fields are not authored", async () => {
  // Given
  await repo.put("agents/reviewer.md", agent("reviewer"));
  // When
  const model = await discover(repo.root, {
    agents: settings({
      overrides: { reviewer: { maxTurns: 2, requires: { bin: "node" } } },
      harnesses: {
        codex: {
          enabled: [],
          disabled: [],
          overrides: { reviewer: { maxTurns: 3, requires: { bin: "git" } } },
        },
      },
    }),
  });
  // Then
  expect(model.agents[0]?.frontmatter.maxTurns).toBe(2);
  expect(model.harnesses.codex?.agents[0]?.frontmatter.maxTurns).toBe(3);
  expect(model.harnesses.codex?.agents[0]?.requires).toEqual({ bin: "git" });
  expect(model.harnesses.opencode?.agents[0]?.requires).toEqual({ bin: "node" });
});

it("preserves authored frontmatter when configuration overrides conflict", async () => {
  // Given
  await repo.put(
    "skills/example/SKILL.md",
    skill("example", "license: MIT\nrequires:\n  bin: node\n"),
  );
  // When
  const model = await discover(repo.root, {
    skills: settings({
      overrides: { example: { license: "Apache-2.0", requires: { bin: "missing" } } },
      harnesses: {
        codex: {
          enabled: [],
          disabled: [],
          overrides: { example: { license: "BSD-3-Clause", requires: { bin: "git" } } },
        },
      },
    }),
  });
  // Then
  expect(model.harnesses.codex?.skills[0]?.frontmatter.license).toBe("MIT");
  expect(model.harnesses.codex?.skills[0]?.requires).toEqual({ bin: "node" });
});

it("uses authored empty paths when a rule overrides configured globs", async () => {
  // Given
  await repo.put("rules/shared.md", "---\npaths: []\n---\nrule");
  await repo.put("rules/fallback.md", "rule");
  // When
  const model = await discover(repo.root, {
    rules: settings({
      overrides: { shared: { paths: ["src/**"] }, fallback: { paths: ["test/**"] } },
    }),
  });
  // Then
  expect(model.rules.find((rule) => rule.name === "shared")?.paths).toEqual([]);
  expect(model.rules.find((rule) => rule.name === "fallback")?.paths).toEqual(["test/**"]);
});

it("omits executable assets when they were not explicitly opted in", async () => {
  // Given
  await repo.put("harnesses/omo/assets/plugins/plugin.js", "export {};\n");
  // When
  const model = await discover(repo.root);
  // Then
  expect(model.assets).toHaveLength(1);
  expect(model.assets[0]?.harnesses).toEqual([]);
  expect(model.harnesses.omo?.assets).toEqual([]);
});

it("enables opted-in assets when selection permits their harness", async () => {
  // Given
  await repo.put("harnesses/omo/assets/plugins/plugin.js", "export {};\n");
  const harness = config(repo.root).harnesses.omo;
  if (!harness) throw new Error("Missing test harness");
  // When
  const model = await discover(repo.root, {
    harnesses: { omo: { ...harness, assets: ["plugins"] } },
    assets: settings({ overrides: { plugins: { requires: { bin: "node" } } } }),
  });
  // Then
  expect(model.harnesses.omo?.assets[0]).toMatchObject({
    name: "plugins",
    requires: { bin: "node" },
    harnesses: ["omo"],
  });
});

it("replaces harness files when user templates seeds and helpers shadow starter paths", async () => {
  // Given
  for (const root of [starter, repo]) {
    await root.put("harnesses/omo/templates/config.json", "{}");
    await root.put("harnesses/omo/seeds/ready", "1");
    await root.put("bin/helper.sh", "exit 0");
  }
  // When
  const model = await discover(repo.root, {}, starter.root);
  // Then
  expect(model.templates.omo?.files).toHaveLength(1);
  expect(model.templates.omo?.files[0]?.file.startsWith(repo.root)).toBe(true);
  expect(model.seeds[0]?.sourcePath.startsWith(repo.root)).toBe(true);
  expect(model.bin[0]?.sourcePath.startsWith(repo.root)).toBe(true);
});
