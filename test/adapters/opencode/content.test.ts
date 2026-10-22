import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Agent, Skill } from "../../../src/core/types.js";
import {
  agentPermissions,
  renderAgent,
  renderSkill,
} from "../../../src/adapters/opencode/content.js";
import { parseFrontmatter } from "../../../src/model/index.js";
import { validateRepo } from "../../../src/engine/index.js";
import { adapter } from "../../../src/adapters/opencode/index.js";
import { adapters } from "../../engine/helpers.js";
import { sampleContext } from "./helpers.js";

let sample: Awaited<ReturnType<typeof sampleContext>>;
beforeEach(async () => {
  sample = await sampleContext();
});
afterEach(async () => {
  await sample.cleanup();
});

const agent: Agent = {
  name: "reader",
  file: "/home/alice/config/agents/reader.md",
  source: "user",
  harnesses: ["opencode"],
  frontmatter: { name: "reader", description: "Reads a change." },
  body: 'Use `Read`. AskUserQuestion(header="Scope", question="Pick?", options=["A","B"])',
};

function sampleSkill(): Skill {
  const skill = sample.ctx.model.harnesses.opencode?.skills[0];
  if (!skill) throw new TypeError("The sample requires a skill.");
  return skill;
}

it("reduces skill metadata when rendering a canonical skill", async () => {
  // Given: every canonical field, including invocation-only fields.
  const base = sampleSkill();
  const skill = {
    ...base,
    frontmatter: {
      ...base.frontmatter,
      license: "MIT",
      compatibility: "Node 22",
      metadata: { category: "docs" },
      "disable-model-invocation": true,
    },
  };
  // When: rendering the skill.
  const result = await renderSkill(skill, sample.repo);
  const entry = result.files.find((item) => item.relPath.endsWith("/SKILL.md"));
  const parsed = parseFrontmatter(String(entry?.content), "SKILL.md");
  // Then: only fields OpenCode consumes remain in its frontmatter.
  expect(parsed.frontmatter).toEqual({
    name: skill.name,
    description: skill.frontmatter.description,
    license: "MIT",
    compatibility: "Node 22",
  });
  expect(result.diagnostics).toEqual([]);
});

it("emits commands only when skills are explicitly user-invocable", async () => {
  // Given: a skill with explicit command eligibility.
  const base = sampleSkill();
  const skill = { ...base, frontmatter: { ...base.frontmatter, "user-invocable": true } };
  // When: rendering it.
  const result = await renderSkill(skill, sample.repo);
  const command = result.files.find((entry) => entry.relPath === `commands/${skill.name}.md`);
  // Then: the native command loads the same skill without unsupported metadata.
  expect(parseFrontmatter(String(command?.content), "command.md").frontmatter).toEqual({
    description: skill.frontmatter.description,
  });
  expect(String(command?.content).match(/skill\((\{[^)]*\})\)/)?.[1]).toBe(
    JSON.stringify({ name: skill.name }),
  );
});

it("omits commands when user invocation is false", async () => {
  // Given: a non-invocable skill.
  const base = sampleSkill();
  const skill = { ...base, frontmatter: { ...base.frontmatter, "user-invocable": false } };
  // When: rendering it.
  const result = await renderSkill(skill, sample.repo);
  // Then: no command is installed for that skill.
  expect(result.files.filter((entry) => entry.relPath.startsWith("commands/"))).toEqual([]);
});

it("rewrites support Markdown but preserves binary bytes and executable bits", async () => {
  // Given: support files with one translated call and one opaque binary.
  const base = sampleSkill();
  const markdown = join(sample.root, "guide.md");
  const binary = join(sample.root, "helper.bin");
  await writeFile(markdown, "`mcp__docs__search` ${CLAUDE_PLUGIN_ROOT}/references/a.md");
  await writeFile(binary, Buffer.from([0, 255, 128, 10]));
  const skill = {
    ...base,
    supportFiles: [
      { relPath: "guide.md", sourcePath: markdown, mode: 0o644 },
      { relPath: "helper.bin", sourcePath: binary, mode: 0o755 },
    ],
  };
  // When: rendering support files.
  const result = await renderSkill(skill, sample.repo);
  // Then: prose is adapted while opaque assets remain byte-identical.
  expect(result.files.find((entry) => entry.relPath.endsWith("/guide.md"))?.content).toBe(
    "`docs_search` ./references/a.md",
  );
  expect(result.files.find((entry) => entry.relPath.endsWith("/helper.bin"))).toMatchObject({
    content: await readFile(binary),
    mode: 0o755,
  });
});

it.each(["Write", "Edit"])("retains runtime edit policy when %s is permitted", (tool) => {
  // Given: an allowlist with a file-modification capability and MCP tool.
  const input = {
    ...agent,
    frontmatter: {
      ...agent.frontmatter,
      allowed_tools: [tool, "Read", "mcp__docs__search"],
      skills: ["outline"],
    },
  };
  // When: deriving deny-only native permissions.
  const result = agentPermissions(input);
  // Then: no static allow bypasses global edit or MCP policies.
  expect(result.diagnostics).toEqual([]);
  expect(result.permission).toEqual({
    glob: "deny",
    grep: "deny",
    list: "deny",
    bash: "deny",
    task: "deny",
    todowrite: "deny",
    webfetch: "deny",
    websearch: "deny",
    lsp: "deny",
    question: "deny",
  });
  expect(Object.values(result.permission).every((value) => value === "deny")).toBe(true);
});

it("accepts comma lists when mapping allowed builtin tools", () => {
  // Given: canonical comma-separated tool restrictions.
  const input = {
    ...agent,
    frontmatter: { ...agent.frontmatter, allowed_tools: "Read, AskUserQuestion, Bash" },
  };
  // When: mapping names to permission groups.
  const result = agentPermissions(input);
  // Then: listed groups are omitted from deny-only overrides.
  expect(result.permission).not.toHaveProperty("read");
  expect(result.permission).not.toHaveProperty("question");
  expect(result.permission).not.toHaveProperty("bash");
  expect(result.permission).toHaveProperty("edit", "deny");
});

it("rejects unknown tool names when an agent requests them", () => {
  // Given: a tool that is neither builtin nor MCP syntax.
  const input = { ...agent, frontmatter: { ...agent.frontmatter, allowed_tools: ["UnknownTool"] } };
  // When: mapping its permissions.
  const result = agentPermissions(input);
  // Then: misspelled restrictions cannot silently pass.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "opencode.tool", severity: "error" }),
  );
});

it("renders native subagent metadata when a step budget is supplied", () => {
  // Given: an agent with skills, a step budget, and shell restriction.
  const input = {
    ...agent,
    frontmatter: { ...agent.frontmatter, maxTurns: 9, skills: ["outline"], noShell: true },
  };
  // When: rendering native Markdown.
  const result = renderAgent(input);
  // Then: native metadata controls iteration and shell/delegation access.
  expect(result.diagnostics).toEqual([]);
  expect(parseFrontmatter(String(result.file.content), "agent.md").frontmatter).toEqual({
    description: input.frontmatter.description,
    mode: "subagent",
    steps: 9,
    permission: { bash: "deny", task: "deny" },
  });
});

it("warns when allowed_tools is guidance only and still renders the agent", () => {
  // Given: an allowlist the deny-only permission model cannot guarantee.
  const input = {
    ...agent,
    frontmatter: { ...agent.frontmatter, allowed_tools: ["Read"] },
  };
  // When: rendering the native agent definition.
  const result = renderAgent(input);
  // Then: the warning explains the limitation without blocking the file.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      severity: "warn",
      code: "opencode.permission.unenforced",
      file: agent.file,
      jsonPath: "/frontmatter/allowed_tools",
      message: expect.stringContaining("guidance only"),
    }),
  );
  expect(result.file.relPath).toBe("agents/reader.md");
});

it("warns that an unenforceable allowed_tools is guidance only through the real engine", async () => {
  // Given: a tool allowlist that deny-only native metadata cannot guarantee.
  await writeFile(
    join(sample.repo, "agents/builder.md"),
    "---\nname: builder\ndescription: Reads a change.\nallowed_tools: [Read]\n---\nRead the change.\n",
  );
  // When: validating with the real adapter injected.
  const result = await validateRepo(sample.repo, {
    env: sample.env,
    adapters: adapters(adapter),
  });
  // Then: the harness still renders, with a warning that the list is not enforced.
  expect(result.snapshot).toBeDefined();
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "engine.permission.unenforced",
      severity: "warn",
      jsonPath: "/frontmatter/allowed_tools",
    }),
  );
});

it.each(["readOnly"] as const)(
  "blocks unsupported %s restrictions through the real engine",
  async (field) => {
    // Given: an agent restriction that deny-only native metadata cannot guarantee.
    await writeFile(
      join(sample.repo, "agents/builder.md"),
      `---\nname: builder\ndescription: Reads a change.\n${field}: true\n---\nRead the change.\n`,
    );
    // When: validating with the real adapter injected.
    const result = await validateRepo(sample.repo, {
      env: sample.env,
      adapters: adapters(adapter),
    });
    // Then: the engine rejects the harness instead of treating prose as enforcement.
    expect(result.snapshot).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "engine.permission",
        severity: "error",
        jsonPath: `/frontmatter/${field}`,
      }),
    );
  },
);
