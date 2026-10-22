import { afterEach, beforeEach, expect, it } from "vitest";
import { agent, discover, fixture, settings, skill } from "./helpers.js";

let repo: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  repo = await fixture();
});
afterEach(async () => {
  await repo.cleanup();
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

it("selects discovered assets automatically for their owning harness", async () => {
  // Given
  await repo.put("harnesses/omo/assets/plugins/plugin.js", "export {};\n");
  // When
  const model = await discover(repo.root);
  // Then
  expect(model.assets).toHaveLength(1);
  expect(model.assets[0]?.harnesses).toEqual(["omo"]);
  expect(model.harnesses.omo?.assets.map((asset) => asset.name)).toEqual(["plugins"]);
  expect(model.harnesses.codex?.assets).toEqual([]);
});

it("applies asset requirements when selection permits their harness", async () => {
  // Given
  await repo.put("harnesses/omo/assets/plugins/plugin.js", "export {};\n");
  // When
  const model = await discover(repo.root, {
    assets: settings({ overrides: { plugins: { requires: { bin: "node" } } } }),
  });
  // Then
  expect(model.harnesses.omo?.assets[0]).toMatchObject({
    name: "plugins",
    requires: { bin: "node" },
    harnesses: ["omo"],
  });
});

it.each([
  settings({ enabled: ["other"] }),
  settings({ disabled: ["plugins"], overrides: { plugins: { enabled: true } } }),
  settings({ overrides: { plugins: { enabled: false } } }),
  settings({
    harnesses: { omo: { enabled: ["other"], disabled: [], overrides: {} } },
  }),
  settings({
    harnesses: {
      omo: { enabled: [], disabled: ["plugins"], overrides: { plugins: { enabled: true } } },
    },
  }),
  settings({
    harnesses: { omo: { enabled: [], disabled: [], overrides: { plugins: { enabled: false } } } },
  }),
])("deselects discovered assets when normal selection excludes them: %j", async (assets) => {
  // Given: a discovered harness asset.
  await repo.put("harnesses/omo/assets/plugins/plugin.js", "export {};\n");
  // When: entity selection excludes the asset.
  const model = await discover(repo.root, { assets });
  // Then: the inventory retains it without selecting it for rendering.
  expect(model.assets[0]?.harnesses).toEqual([]);
  expect(model.harnesses.omo?.assets).toEqual([]);
});
