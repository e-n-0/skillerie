import { afterEach, beforeEach, expect, it } from "vitest";
import { capabilities } from "../../../src/adapters/omo/capabilities.js";
import { convertText } from "../../../src/adapters/omo/conversion.js";
import { payload, setup } from "./helpers.js";

let sample: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  sample = await setup();
});
afterEach(async () => {
  await sample.cleanup();
});

function convert(text: string) {
  return convertText(text, sample.ctx, {
    file: "skills/example/SKILL.md",
    skillDir: "skills/example",
  });
}

it.each(Object.entries(capabilities.toolMap))(
  "maps the canonical %s tool when referenced as code",
  (canonical, native) => {
    // Given: a canonical tool reference.
    const text = "`" + canonical + "`";
    // When: OMO converts explicit tool references.
    const result = convert(text);
    // Then: the reference uses the declared native tool.
    expect(result.text).toBe("`" + native + "`");
    expect(result.diagnostics).toEqual([]);
  },
);

it("converts MCP calls when the source names a server and tool", () => {
  // Given: a structured MCP call with a literal argument.
  const source = 'mcp__docs__lookup(query="types")';
  // When: the shared MCP rewrite uses OMO's native renderer.
  const result = convert(source);
  // Then: the native tool name and payload are machine-readable.
  expect(result.text).toBe('mcp_docs_lookup({"query":"types"})');
  expect(result.diagnostics).toEqual([]);
});

it("keeps protected tool names when they occur in paths or URLs", () => {
  // Given: names that are part of source locations, not tool calls.
  const source = "https://example.com/mcp__docs__lookup ./Read(file) ./Skill(name)";
  // When: conversion runs.
  const result = convert(source);
  // Then: the shared parser preserves protected references.
  expect(result.text).toBe(source);
});

it("rewrites skill root and invocation variables when outside a code fence", () => {
  // Given: source-relative support paths and invocation context.
  const source = "${CLAUDE_PLUGIN_ROOT}/skills/example/ref.md $ARGUMENTS\n```\n$ARGUMENTS\n```";
  // When: conversion runs.
  const result = convert(source);
  // Then: the root is local and fenced shell syntax survives.
  expect(result.text).toMatch(/^\.\/ref\.md/);
  expect(result.text.match(/\$ARGUMENTS/g)).toHaveLength(1);
});

it("renders native task payloads when canonical aliases and namespaces are used", () => {
  // Given: a namespaced canonical alias and accepted source-only fields.
  const ctx = sample.ctx;
  // When: a structured task is converted.
  const result = convertText(
    'Task(subagent_type="tools:Explore", prompt="Inspect", description="Inspect sources", run_in_background=true, model="parent", resume="old", command="ignored")',
    ctx,
    { file: "skills/example/SKILL.md" },
  );
  // Then: only native task fields remain and background mode is a boolean.
  expect(payload(result.text)).toEqual({
    subagent_type: "explore",
    prompt: "Inspect",
    description: "Inspect sources",
    run_in_background: true,
  });
  expect(result.diagnostics).toEqual([]);
});

it.each(["Task", "Agent"])("maps Explore and preserves false when the source uses %s", (name) => {
  // Given: the built-in canonical exploration alias.
  const source = `${name}(subagent_type="Explore", run_in_background=false)`;
  // When: native task rendering supplies missing prompt fields.
  const result = convert(source);
  // Then: the alias is resolved without changing the boolean.
  expect(payload(result.text)).toMatchObject({
    subagent_type: "explore",
    run_in_background: false,
  });
});

it.each([
  'Task(prompt="x", mystery=true)',
  'Task(run_in_background="true")',
  "Task(run_in_background=background)",
  "Task(prompt=false)",
  "Skill(skill=42)",
  'Skill(skill="missing")',
])("reports a diagnostic when the structured call is invalid: %s", (source) => {
  // Given: an unrepresentable native call.
  // When: conversion parses it.
  const result = convert(source);
  // Then: the adapter returns an error instead of silently accepting it.
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ severity: "error" }));
});

it("uses read to load a skill when the source invokes Skill", () => {
  // Given: a skill present in the effective inventory.
  const source = 'Skill(skill="tools:outline", args="review the plan")';
  // When: the canonical invocation is converted.
  const result = convert(source);
  // Then: it references the installed skill file instead of an unavailable native skill tool.
  expect(result.text).toContain("/skills/outline/SKILL.md");
  expect(result.text).not.toMatch(/\bSkill\(/);
  expect(result.diagnostics).toEqual([]);
});

it("maps backtick agent references when canonical aliases are used", () => {
  // Given: both canonical and namespaced native-agent references.
  const ctx = sample.ctx;
  // When: prose references are converted.
  const result = convertText("`Explore` `productivity:Explore`", ctx, { file: "agent.md" });
  // Then: both references name the native agent.
  expect(result.text).toBe("`explore` `explore`");
});
