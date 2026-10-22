import { expect, it } from "vitest";
import { rewriteMarkdown } from "../../../src/adapters/pi/markdown.js";
import { nativeCall } from "./helpers.js";

const options = { file: "/home/alice/config/skills/outline/SKILL.md" } as const;

it.each(["Task", "Agent"])("maps %s calls when the agent has a namespace", (tool) => {
  // Given: canonical delegation fields with an aliased agent.
  const text = `${tool}(subagent_type="example:Explore", prompt="inspect", run_in_background=true)`;
  // When: translating into Pi's structured delegation schema.
  const result = rewriteMarkdown(text, options);
  // Then: the native field names, identity, and typed values are correct.
  expect(result.diagnostics).toEqual([]);
  expect(nativeCall(result.text, "subagent")).toEqual({
    agent: "explorer",
    task: "inspect",
    run_in_background: true,
  });
});

it("retains runtime expressions when a delegation prompt is dynamic", () => {
  // Given: an expression that the author will evaluate at runtime.
  const text = 'Task(subagent_type="builder", prompt=buildTask("a,b"))';
  // When: rendering the structured call.
  const result = rewriteMarkdown(text, options);
  // Then: the expression is not converted into a literal prompt.
  expect(result.text).toBe('subagent({"agent":"builder","task":buildTask("a,b")})');
});

it.each(["WebSearch", "WebFetch"])("maps %s when used as an explicit tool", (tool) => {
  // Given: a canonical callable web tool.
  const text = `${tool}({"query":"example"})`;
  // When: translating the tool reference.
  const result = rewriteMarkdown(text, options);
  // Then: both canonical tools route to Pi's web tool.
  expect(nativeCall(result.text, "web_search")).toEqual({ query: "example" });
});

it("maps paired web references when both canonical tools share one label", () => {
  // Given: a combined tool reference.
  const text = "`WebSearch/WebFetch`";
  // When: translating the label.
  const result = rewriteMarkdown(text, options);
  // Then: the single native tool is referenced.
  expect(result.text).toBe("`web_search`");
});

it("serializes MCP arguments when named values contain nested delimiters", () => {
  // Given: multiline canonical MCP syntax with every supported literal class.
  const text = `mcp__docs-api__search(
    query="a,b", active=true, absent=null, count=2, ratio=-1.5,
    filters={ids:[1,2]}
  )`;
  // When: rendering the native MCP proxy invocation.
  const result = rewriteMarkdown(text, options);
  // Then: the proxy receives a normalized name and JSON-string arguments.
  expect(result.diagnostics).toEqual([]);
  expect(nativeCall(result.text, "mcp")).toEqual({
    tool: "docs_api_search",
    args: JSON.stringify({
      query: "a,b",
      active: true,
      absent: null,
      count: 2,
      ratio: -1.5,
      filters: { ids: [1, 2] },
    }),
  });
});

it("uses empty JSON arguments when an MCP reference has no call", () => {
  // Given: a bare canonical MCP name.
  const text = "mcp__tracker__lookup";
  // When: adapting the reference.
  const result = rewriteMarkdown(text, options);
  // Then: the proxy still gets its required args field.
  expect(nativeCall(result.text, "mcp")).toEqual({ tool: "tracker_lookup", args: "{}" });
});

it("serializes runtime MCP values when an argument is an expression", () => {
  // Given: a runtime value rather than a quoted literal.
  const text = "mcp__docs__search(query=queryText)";
  // When: rendering the invocation.
  const result = rewriteMarkdown(text, options);
  // Then: native args will be a JSON string at runtime.
  expect(result.text).toBe('mcp({tool:"docs_search",args:JSON.stringify({"query":queryText})})');
});

it("diagnoses malformed MCP syntax when delimiters do not balance", () => {
  // Given: an incomplete authoring call.
  const text = 'mcp__docs__search(query=["a")';
  // When: attempting conversion.
  const result = rewriteMarkdown(text, options);
  // Then: a located error prevents silent malformed output.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      severity: "error",
      file: options.file,
      code: "dialect.syntax",
    }),
  );
});

it("makes support paths relative when a skill uses the plugin-root placeholder", () => {
  // Given: both full skill and short root forms.
  const text = "${CLAUDE_PLUGIN_ROOT}/skills/outline/references/a.md ${CLAUDE_PLUGIN_ROOT}/b.md";
  // When: converting Markdown within the skill.
  const result = rewriteMarkdown(text, { ...options, skillDir: "skills/outline" });
  // Then: both references resolve from the installed skill.
  expect(result.text).toBe("./references/a.md ./b.md");
});

it("preserves path tokens when they contain a canonical tool name", () => {
  // Given: a filename and a URL, not tool invocations.
  const text = "`/home/alice/Read` https://example.com/mcp__docs__search";
  // When: converting Markdown.
  const result = rewriteMarkdown(text, options);
  // Then: path bytes remain usable.
  expect(result.text).toBe(text);
});

it("preserves quoted paths and routes that are not applicable Pi skills", () => {
  // Given: slash-prefixed filesystem paths and application routes.
  const text = "`/tmp` `/path` `/settings` `/docs`";
  // When: converting Markdown with only an unrelated applicable skill.
  const result = rewriteMarkdown(text, { ...options, skillNames: ["outline"] });
  // Then: non-skill slash references remain unchanged.
  expect(result.text).toBe(text);
});

it("uses native skill commands when a Markdown reference names a skill", () => {
  // Given: canonical skill references and a non-skill file path.
  const text = "`/outline` `/implement` `/home/alice/check.md`";
  // When: translating installed command references.
  const result = rewriteMarkdown(text, { ...options, skillNames: ["outline", "implement"] });
  // Then: native commands replace references without touching file paths.
  expect(result.text).toBe("`/skill:outline` `/skill:implement` `/home/alice/check.md`");
});

it("rewrites only the skill names applicable to Pi", () => {
  // Given: one available skill and one unrelated slash route.
  const text = "`/outline` `/settings`";
  // When: adapting the skill reference.
  const result = rewriteMarkdown(text, { ...options, skillNames: ["outline"] });
  // Then: only the applicable skill becomes a native command.
  expect(result.text).toBe("`/skill:outline` `/settings`");
});
