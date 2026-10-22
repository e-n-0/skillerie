import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { discoverSources } from "../../src/model/index.js";
import { agent, config, fixture, skill } from "./helpers.js";

let repo: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  repo = await fixture();
});
afterEach(async () => {
  await repo.cleanup();
});

it.each(["Example", "bad_name", "bad--name", "-name", "name-", "x".repeat(65)])(
  "reports invalid name %s when a skill is discovered",
  async (name) => {
    // Given
    await repo.put(`skills/${name}/SKILL.md`, skill(name));
    // When
    const result = await discoverSources(repo.root, config(repo.root));
    // Then
    expect(result.model).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ severity: "error", jsonPath: "/name" }),
    );
  },
);

it("accepts the name boundary when a skill name has 64 characters", async () => {
  // Given
  const name = "a".repeat(64);
  await repo.put(`skills/${name}/SKILL.md`, skill(name));
  // When
  const result = await discoverSources(repo.root, config(repo.root));
  // Then
  expect(result.model?.skills[0]?.name).toBe(name);
});

it.each([
  ["skills/example/SKILL.md", skill("other")],
  ["agents/example.md", agent("other")],
])("reports mismatched name when reading %s", async (path, text) => {
  // Given
  const file = await repo.put(path, text);
  // When
  const result = await discoverSources(repo.root, config(repo.root));
  // Then
  expect(result.model).toBeUndefined();
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "source.name-mismatch", file, jsonPath: "/name" }),
  );
});

it.each(["name", "description"])(
  "reports the missing field when a skill omits %s",
  async (field) => {
    // Given
    const text = skill("example")
      .split("\n")
      .filter((line) => !line.startsWith(`${field}:`))
      .join("\n");
    const file = await repo.put("skills/example/SKILL.md", text);
    // When
    const result = await discoverSources(repo.root, config(repo.root));
    // Then
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ file, jsonPath: `/${field}` }),
    );
  },
);

it("accepts a skill when invocation metadata is omitted", async () => {
  // Given: a skill with only its required metadata.
  await repo.put(
    "skills/example/SKILL.md",
    "---\nname: example\ndescription: example\n---\npayload\n",
  );
  // When: discovery parses the skill.
  const result = await discoverSources(repo.root, config(repo.root));
  // Then: no artificial invocation fields mask later configuration overrides.
  expect(result.diagnostics).toEqual([]);
  expect(result.model?.skills[0]?.frontmatter).toEqual({ name: "example", description: "example" });
});

it.each(["name", "description"])(
  "reports the missing field when an agent omits %s",
  async (field) => {
    // Given
    await repo.put(
      "agents/example.md",
      agent("example")
        .split("\n")
        .filter((line) => !line.startsWith(`${field}:`))
        .join("\n"),
    );
    // When
    const result = await discoverSources(repo.root, config(repo.root));
    // Then
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ jsonPath: `/${field}` }));
  },
);

it("rejects string booleans when user-invocable is quoted", async () => {
  // Given
  await repo.put(
    "skills/example/SKILL.md",
    skill("example").replace("user-invocable: true", 'user-invocable: "true"'),
  );
  // When
  const result = await discoverSources(repo.root, config(repo.root));
  // Then
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ jsonPath: "/user-invocable" }),
  );
});

it("rejects invalid requires when an unsupported operating system is authored", async () => {
  // Given
  await repo.put("agents/example.md", agent("example", "requires:\n  os: windows\n"));
  // When
  const result = await discoverSources(repo.root, config(repo.root));
  // Then
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ jsonPath: "/requires/os" }));
});

it.each(["skills/first/example/SKILL.md", "harnesses/codex/skills/example/SKILL.md"])(
  "rejects duplicate names when %s collides with a global skill",
  async (path) => {
    // Given
    await repo.put("skills/example/SKILL.md", skill("example"));
    await repo.put(path, skill("example"));
    // When
    const result = await discoverSources(repo.root, config(repo.root));
    // Then
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "source.duplicate" }),
    );
  },
);

it("rejects case variants when names collide case-insensitively", async () => {
  // Given
  await repo.put("agents/group/example.md", agent("example"));
  await repo.put("agents/other/Example.md", agent("Example"));
  // When
  const result = await discoverSources(repo.root, config(repo.root));
  // Then
  expect(result.model).toBeUndefined();
  expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
});

it.each([
  "skills/example/SKILL.md",
  "agents/example.md",
  "skills",
  "skills/example/reference.md",
  "harnesses",
])("rejects symlinks when a source uses %s", async (path) => {
  // Given
  const target = await repo.put("target.md", skill("example"));
  const file = join(repo.root, path);
  await repo.put(`${path}.placeholder`, "");
  await symlink(target, file);
  // When
  const result = await discoverSources(repo.root, config(repo.root));
  // Then
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "source.symlink", file, line: 1 }),
  );
});

it("reports a source location when the repository does not exist", async () => {
  // Given
  const root = join(repo.root, "missing");
  // When
  const result = await discoverSources(root, config(root));
  // Then
  expect(result.model).toBeUndefined();
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ file: root, line: 1 }));
});

it("rejects files when a canonical source directory is expected", async () => {
  // Given
  const file = await repo.put("skills", "payload");
  // When
  const result = await discoverSources(repo.root, config(repo.root));
  // Then
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ file, code: "source.kind", line: 1 }),
  );
});

it("rejects directories when a singleton source file is expected", async () => {
  // Given
  await repo.put("instructions.md/nested.md", "payload");
  // When
  const result = await discoverSources(repo.root, config(repo.root));
  // Then
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      file: join(repo.root, "instructions.md"),
      code: "source.kind",
      line: 1,
    }),
  );
});
