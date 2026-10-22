import { expect, it } from "vitest";
import {
  rewriteArguments,
  rewriteMcpRefs,
  rewritePluginRoot,
  rewriteTools,
} from "../../src/dialect/index.js";
import { options } from "./options.js";

it("maps explicit builtin references when prose contains ordinary words", () => {
  // Given: ordinary prose, explicit code names, and callable names.
  const text =
    'Read this Task (a concept). Use `Read`, ``WebSearch``, Read(path="a"), and Task(prompt="go").';
  // When: rewriting tools from adapter data.
  const result = rewriteTools(text, options);
  // Then: only the explicit references and call positions change.
  expect(result.text).toBe(
    'Read this Task (a concept). Use `read`, ``websearch``, read(path="a"), and task(prompt="go").',
  );
});

it("uses adapter maps when native tools differ from harness defaults", () => {
  // Given: deliberately nonstandard data for the same harness.
  const configured = {
    ...options,
    capabilities: { ...options.capabilities, toolMap: { Read: "inspect" } },
  };
  // When: rewriting a builtin reference.
  const result = rewriteTools("`Read`", configured);
  // Then: capabilities, not a harness branch, determine the name.
  expect(result.text).toBe("`inspect`");
});

it("protects URLs and filesystem paths when names resemble tools", () => {
  // Given: absolute, relative, Windows, and URL references.
  const text =
    "`/home/alice/Read` ./Read(x) ../Task(x) https://example.com/Read(x) https://example.com/?q=Read(x) C:\\Read(x) `Read.md` `Read/file`";
  // When: mapping native tool references.
  const result = rewriteTools(text, options);
  // Then: non-tool tokens survive exactly.
  expect(result.text).toBe(text);
});

it("maps backtick agent aliases when replacements are declared", () => {
  // Given: known aliases and a non-role namespace.
  const text = "`Explore` `researcher` `git:general-purpose` `custom:general-purpose`";
  // When: mapping explicit code references.
  const result = rewriteTools(text, options);
  // Then: native replacements and supported prose namespaces are honored.
  expect(result.text).toBe("`explore` `librarian` `general` `custom:general-purpose`");
});

it("rewrites canonical MCP names when no call template is supplied", () => {
  // Given: literal references and a call.
  const text = "`mcp__docs__search` mcp__tracker__get_item(id=2)";
  // When: translating native reference names.
  const result = rewriteMcpRefs(text, options);
  // Then: names change without changing call arguments.
  expect(result.text).toBe("`docs_search` tracker_get_item(id=2)");
});

it("uses the MCP template when a reference has structured arguments", () => {
  // Given: a call containing nested literals and a second bare reference.
  const text =
    'mcp__docs-api__search(query="a,b", filters={ids:[1,2]}) then `mcp__tracker__get_item`';
  // When: rendering through adapter policy.
  const result = rewriteMcpRefs(text, {
    ...options,
    mcpTemplate: (reference) => JSON.stringify(reference),
  });
  // Then: the callback sees parsed arguments, not a lossy string split.
  expect(result.text).toBe(
    JSON.stringify({
      server: "docs-api",
      tool: "search",
      arguments: {
        query: { kind: "literal", value: "a,b" },
        filters: { kind: "literal", value: { ids: [1, 2] } },
      },
    }) + ' then `{"server":"tracker","tool":"get_item"}`',
  );
});

it("protects MCP paths when references are embedded in URLs", () => {
  // Given: non-tool MCP tokens.
  const text = "https://example.com/mcp__docs__search /home/alice/mcp__tracker__get_item";
  // When: rewriting MCP references.
  const result = rewriteMcpRefs(text, { ...options, mcpTemplate: () => "changed" });
  // Then: the template is not applied to paths.
  expect(result.text).toBe(text);
});

it("reports malformed MCP calls when a template consumes arguments", () => {
  // Given: mismatched delimiters.
  const text = 'mcp__docs__search(query=["a")';
  // When: rendering MCP calls.
  const result = rewriteMcpRefs(text, { ...options, mcpTemplate: () => "changed" });
  // Then: malformed source remains visible with its source location.
  expect(result.text).toBe(text);
  expect(result.diagnostics[0]).toMatchObject({ file: options.file, line: 1 });
});

it("keeps invocation placeholders when the mode is keep", () => {
  // Given: a placeholder used both inline and in code.
  const text = "$ARGUMENTS\n```sh\necho $ARGUMENTS\n```\n";
  // When: retaining native argument handling.
  const result = rewriteArguments(text, { ...options, arguments: { mode: "keep" } });
  // Then: all source bytes survive.
  expect(result.text).toBe(text);
});

it("replaces invocation arguments when they occur outside block fences", () => {
  // Given: indented fences, inline code, longer fences, and CRLF.
  const text =
    "$ARGUMENTS `$ARGUMENTS`\r\n   ```sh\r\necho $ARGUMENTS\r\n   ```\r\n````md\n```\n$ARGUMENTS\n````\n$ARGUMENTS $ARGUMENTS_EXTRA";
  // When: applying a replacement containing literal replacement metacharacters.
  const result = rewriteArguments(text, {
    ...options,
    arguments: { mode: "replace", text: "$&prompt" },
  });
  // Then: fenced shell examples and partial identifiers remain intact.
  expect(result.text).toBe(
    "$&prompt `$&prompt`\r\n   ```sh\r\necho $ARGUMENTS\r\n   ```\r\n````md\n```\n$ARGUMENTS\n````\n$&prompt $ARGUMENTS_EXTRA",
  );
});

it("preserves an unclosed block fence when replacing arguments", () => {
  // Given: a code example whose closing fence is missing.
  const text = "$ARGUMENTS\n```sh\n$ARGUMENTS";
  // When: replacing only ordinary Markdown.
  const result = rewriteArguments(text, {
    ...options,
    arguments: { mode: "replace", text: "prompt" },
  });
  // Then: the unfinished code block is still opaque.
  expect(result.text).toBe("prompt\n```sh\n$ARGUMENTS");
});

it.each(["${CLAUDE_PLUGIN_ROOT}", "$CLAUDE_PLUGIN_ROOT"])(
  "makes skill support paths relative when using %s",
  (root) => {
    // Given: the complete discovered skill path and fallback root references.
    const text = `${root}/skills/group/example/references/guide.md ${root}/scripts/run.sh ${root} ${root}/skills/group/examples/other`;
    // When: translating root placeholders.
    const result = rewritePluginRoot(text, { ...options, skillDir: "skills/group/example" });
    // Then: complete prefixes are stripped before generic root replacement.
    expect(result.text).toBe("./references/guide.md ./scripts/run.sh ./ ../examples/other");
  },
);

it("escapes skill directory metacharacters when replacing plugin roots", () => {
  // Given: a discovered path with regex punctuation.
  const text = "${CLAUDE_PLUGIN_ROOT}/skills/example.v1/file $CLAUDE_PLUGIN_ROOT_EXTRA/file";
  // When: making paths skill-relative.
  const result = rewritePluginRoot(text, { ...options, skillDir: "./skills/example.v1/" });
  // Then: punctuation is literal and unrelated variables survive.
  expect(result.text).toBe("./file $CLAUDE_PLUGIN_ROOT_EXTRA/file");
});
