import { expect, it } from "vitest";
import type { Agent } from "../../../src/core/types.js";
import { generalAgent, normalizeTools, renderAgent } from "../../../src/adapters/pi/agents.js";
import { parseFrontmatter } from "../../../src/model/index.js";

const agent: Agent = {
  name: "auditor",
  file: "/home/alice/config/agents/auditor.md",
  source: "user",
  harnesses: ["pi"],
  frontmatter: { name: "auditor", description: "Reviews changes." },
  body: 'Use `Read` and WebFetch({"url":"https://example.com"}).',
};

it.each([
  ["Read, Write, Edit, Glob, WebSearch, WebFetch, mcp__docs__search, Read"],
  [["Read", "Write", "Edit", "Glob", "WebSearch", "WebFetch", "mcp__docs__search", "Read"]],
])("normalizes allowlists when authored as %j", (tools) => {
  // Given: canonical builtins, MCP tools, and duplicates.
  // When: converting the allowed tool collection.
  const result = normalizeTools(tools);
  // Then: Pi receives unique lowercase native tool names.
  expect(result).toEqual(["read", "write", "edit", "find", "web_search", "mcp"]);
});

it("drops orchestration tools when a child allowlist includes parent-only tools", () => {
  // Given: tools unavailable to child agents.
  const tools = [
    "Read",
    "Task",
    "Agent",
    "AskUserQuestion",
    "Skill",
    "subagent",
    "ask_user_question",
  ];
  // When: normalizing the tool list.
  const result = normalizeTools(tools);
  // Then: parent-only entries cannot leak into child tool selection.
  expect(result).toEqual(["read"]);
});

it("normalizes builtins without renaming custom extension tools", () => {
  // Given: differently cased builtins and a case-sensitive extension name.
  const tools = ["READ", "glob", "webfetch", "ExampleTool"];
  // When: resolving Pi tool names.
  const result = normalizeTools(tools);
  // Then: native builtin aliases change while extension identity stays intact.
  expect(result).toEqual(["read", "find", "web_search", "ExampleTool"]);
});

it("drops obsolete metadata when rendering a canonical child agent", () => {
  // Given: legacy metadata supplied programmatically alongside canonical fields.
  const source = {
    ...agent,
    frontmatter: {
      ...agent.frontmatter,
      allowed_tools: ["Read", "Glob", "AskUserQuestion"],
      model: "example-model",
      effort: "high",
      routing_tier: "fast",
      hooks: { before: ["example"] },
      skills: ["outline"],
      maxTurns: 12,
    },
  };
  // When: rendering the agent.
  const result = renderAgent(source);
  // Then: machine-consumed metadata preserves canonical fields without runtime model pins.
  const parsed = parseFrontmatter(String(result.file.content), agent.file);
  expect(parsed.diagnostics).toEqual([]);
  expect(parsed.frontmatter).toEqual({
    name: "auditor",
    description: agent.frontmatter.description,
    tools: "read, find",
    skills: ["outline"],
    maxTurns: 12,
  });
});

it("rewrites all agent Markdown when tool references occur in its body", () => {
  // Given: agent Markdown with explicit canonical tool references.
  // When: rendering it.
  const result = renderAgent(agent);
  // Then: native tool identifiers replace the authored identifiers.
  const parsed = parseFrontmatter(String(result.file.content), agent.file);
  expect(parsed.body).toContain("`read`");
  expect(parsed.body).toContain('web_search({"url":"https://example.com"})');
});

it("rewrites agent skill references only for applicable Pi skills", () => {
  // Given: an agent body with one applicable skill and one route.
  const source = { ...agent, body: "Use `/outline` and keep `/settings` unchanged." };
  // When: rendering with the current Pi skill set.
  const result = renderAgent(source, ["outline"]);
  // Then: only the applicable skill reference becomes a native command.
  expect(String(result.file.content)).toContain(
    "Use `/skill:outline` and keep `/settings` unchanged.",
  );
});

it("excludes shell access when an agent requests noShell without an allowlist", () => {
  // Given: an explicit native shell restriction.
  const source = { ...agent, frontmatter: { ...agent.frontmatter, noShell: true } };
  // When: rendering native tool selection.
  const result = renderAgent(source);
  // Then: bash is excluded by the runtime allowlist, not by prompt text.
  const metadata = parseFrontmatter(String(result.file.content), agent.file).frontmatter;
  expect(result.diagnostics).toEqual([]);
  expect(metadata?.["tools"]).toBe("read, write, edit, grep, find, mcp, web_search");
});

it("narrows an existing allowlist when noShell also applies", () => {
  // Given: a tool list that would otherwise include bash.
  const source = {
    ...agent,
    frontmatter: {
      ...agent.frontmatter,
      noShell: true,
      allowed_tools: ["Read", "Bash"],
    },
  };
  // When: rendering the restrictions.
  const result = renderAgent(source);
  // Then: shell access is removed from native tool selection.
  expect(parseFrontmatter(String(result.file.content), agent.file).frontmatter?.["tools"]).toBe(
    "read",
  );
});

it.each([{ allowed_tools: ["Bash(git:*)"] }, { allowed_tools: ["mcp__docs__search"] }])(
  "warns for unsupported allowlists %j",
  (restriction) => {
    // Given: an allowlist with entries Pi cannot enforce exactly.
    const source = { ...agent, frontmatter: { ...agent.frontmatter, ...restriction } };
    // When: adapting the child agent.
    const result = renderAgent(source);
    // Then: the warning is retained while the child file is rendered.
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "warn",
        code: "pi.permission.unenforced",
        file: agent.file,
        jsonPath: "/frontmatter/allowed_tools",
      }),
    );
    expect(result.file.relPath).toBe("agents/auditor.md");
  },
);

it("errors when Pi cannot enforce a filesystem read-only restriction", () => {
  // Given: an explicit hard restriction unsupported by Pi.
  const source = { ...agent, frontmatter: { ...agent.frontmatter, readOnly: true } };
  // When: adapting the child agent.
  const result = renderAgent(source);
  // Then: the unsupported hard restriction remains an error.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      severity: "error",
      code: "pi.permission",
      file: agent.file,
      jsonPath: "/frontmatter/readOnly",
    }),
  );
});

it("preserves an empty allowlist when the child must have no tools", () => {
  // Given: an explicitly empty tool selection.
  const source = { ...agent, frontmatter: { ...agent.frontmatter, allowed_tools: [] } };
  // When: rendering native frontmatter.
  const result = renderAgent(source);
  // Then: an empty list is not mistaken for unrestricted defaults.
  expect(parseFrontmatter(String(result.file.content), agent.file).frontmatter?.["tools"]).toBe("");
});

it("provides general-purpose tools when generating the default child agent", () => {
  // Given: no source definition is needed for the generated child.
  // When: rendering the default definition.
  const result = generalAgent();
  // Then: its runtime tool list is complete and has no question or delegation tools.
  const parsed = parseFrontmatter(String(result.content), result.relPath);
  expect(parsed.frontmatter).toEqual({
    name: "general-purpose",
    description: expect.any(String),
    tools: "read, write, edit, grep, find, bash, mcp, web_search",
  });
  expect(parsed.body).not.toMatch(/(?:AskUserQuestion|ask_user_question)\(/);
});
