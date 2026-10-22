import { expect, it } from "vitest";
import { parseStructuredCalls, resolveAgentAlias } from "../../src/dialect/index.js";
import { options } from "./options.js";

it("returns exclusive source spans when multiple calls appear", () => {
  // Given: different call kinds embedded in Markdown.
  const text = 'Use Task(subagent_type="Explore", prompt="inspect") then Skill(skill="example").';
  // When: parsing the source.
  const result = parseStructuredCalls(text, options);
  // Then: spans identify exactly the machine-consumed calls.
  expect(result.diagnostics).toEqual([]);
  expect(result.calls.map((call) => text.slice(call.start, call.end))).toEqual([
    'Task(subagent_type="Explore", prompt="inspect")',
    'Skill(skill="example")',
  ]);
});

it("parses nested objects and arrays when delimiters occur in strings", () => {
  // Given: string delimiters must not terminate the surrounding call.
  const text =
    'AskUserQuestion(questions=[{header:"Pick", question:"Which ),]?", options:[{label:"A,B",description:"use (A)"}]}])';
  // When: parsing nested literal values.
  const result = parseStructuredCalls(text, options);
  // Then: the argument is a typed literal rather than an opaque expression.
  expect(result.calls[0]?.arguments["questions"]).toEqual({
    kind: "literal",
    value: [
      {
        header: "Pick",
        question: "Which ),]?",
        options: [{ label: "A,B", description: "use (A)" }],
      },
    ],
  });
  expect(result.diagnostics).toEqual([]);
});

it("preserves Markdown escapes when parsing multiline prompts", () => {
  // Given: authored multiline strings with Markdown and recognized escapes.
  const text =
    'Task(prompt="first\n\\*literal\\* and \\`code\\` then \\"quoted\\"\\nlast", description="inspect")';
  // When: parsing a prompt value.
  const result = parseStructuredCalls(text, options);
  // Then: only string escapes are decoded; Markdown escapes remain intact.
  expect(result.calls[0]?.arguments["prompt"]).toEqual({
    kind: "literal",
    value: 'first\n\\*literal\\* and \\`code\\` then "quoted"\nlast',
  });
});

it("joins literal strings when a prompt uses concatenation", () => {
  // Given: supported literal prompt concatenation.
  const text = 'Agent(prompt="first, " + \'second\', description="inspect")';
  // When: parsing the expression.
  const result = parseStructuredCalls(text, options);
  // Then: the literal prompt is concatenated.
  expect(result.calls[0]?.arguments["prompt"]).toEqual({ kind: "literal", value: "first, second" });
});

it("parses triple quoted strings when a prompt spans lines", () => {
  // Given: quotes inside a multiline prompt.
  const text = 'Task(prompt="""first "quoted"\nlast""")';
  // When: parsing the call.
  const result = parseStructuredCalls(text, options);
  // Then: the complete prompt is retained.
  expect(result.calls[0]?.arguments["prompt"]).toEqual({
    kind: "literal",
    value: 'first "quoted"\nlast',
  });
});

it("retains dynamic expressions when values are not literals", () => {
  // Given: nested expression calls containing commas.
  const text = 'Task(prompt=build("a,b", {x:[1,2]}), run_in_background=false)';
  // When: parsing the arguments.
  const result = parseStructuredCalls(text, options);
  // Then: expressions remain source text and booleans remain typed.
  expect(result.calls[0]?.arguments).toEqual({
    prompt: { kind: "expression", text: 'build("a,b", {x:[1,2]})' },
    run_in_background: { kind: "literal", value: false },
  });
});

it("accepts object argument form when keys are quoted", () => {
  // Given: JSON-style invocation.
  const text = 'Skill({"skill":"example","args":"alice"})';
  // When: parsing the invocation.
  const result = parseStructuredCalls(text, options);
  // Then: fields use the same structured representation.
  expect(result.calls[0]?.arguments["skill"]).toEqual({ kind: "literal", value: "example" });
});

it("ignores ordinary prose when parentheses follow a tool word", () => {
  // Given: a concept, not a structured call.
  const text = "Task (a concept), Agent (a role), and Skill (a capability).";
  // When: parsing the prose.
  const result = parseStructuredCalls(text, options);
  // Then: no call or syntax error is invented.
  expect(result).toEqual({ calls: [], diagnostics: [] });
});

it("protects paths and URLs when call names occur inside them", () => {
  // Given: tokens that are not tool references.
  const text = "https://example.com/Task(prompt=x) /home/alice/Skill(args=x) ./Agent(prompt=x)";
  // When: finding calls.
  const result = parseStructuredCalls(text, options);
  // Then: paths and URLs are not parsed.
  expect(result).toEqual({ calls: [], diagnostics: [] });
});

it.each([
  'Task(prompt="unterminated)',
  "Task(prompt=[1,2})",
  'Task(prompt="ok"',
  "Skill(skill=)",
  'Task(prompt="a", prompt="b")',
  'Task(prompt="ok" description="bad")',
])("reports malformed calls when parsing %s", (text) => {
  // Given: malformed user-authored syntax.
  const source = `intro\n${text}`;
  // When: parsing the source.
  const result = parseStructuredCalls(source, options);
  // Then: an actionable source location is returned without throwing.
  expect(result.calls).toEqual([]);
  expect(result.diagnostics[0]).toMatchObject({ severity: "error", file: options.file, line: 2 });
});

it("reports unsupported fields when syntax is otherwise valid", () => {
  // Given: an unsupported field in a balanced call.
  const text = 'Skill(skill="example", unknown=true)';
  // When: parsing fields.
  const result = parseStructuredCalls(text, options);
  // Then: adapters can inspect the call and the diagnostic.
  expect(result.calls).toHaveLength(1);
  expect(result.diagnostics).toHaveLength(1);
});

it("maps agent aliases when a namespace precedes the native replacement", () => {
  // Given: an alias map separate from the source namespace.
  const name = "example:researcher";
  // When: resolving the authored name.
  const result = resolveAgentAlias(name, options);
  // Then: the adapter's replacement wins.
  expect(result).toBe("librarian");
});

it("preserves expression source when nested containers contain dynamic values", () => {
  // Given: dynamic nested values with intentionally distinct spacing and quotes.
  const expression = "[ { header: 'Runtime', options: choices( 1, 2 ) } ]";
  // When: parsing the outer structured call.
  const result = parseStructuredCalls(`AskUserQuestion(questions=${expression})`, options);
  // Then: dynamic source remains available verbatim to adapter consumers.
  expect(result.calls[0]?.arguments["questions"]).toEqual({
    kind: "expression",
    text: expression,
  });
});

it("ignores inherited properties when resolving unknown agent aliases", () => {
  // Given: a name that is also a JavaScript prototype property.
  const name = "toString";
  // When: resolving it against an ordinary adapter map.
  const result = resolveAgentAlias(name, options);
  // Then: only explicitly declared replacements are used.
  expect(result).toBe(name);
});
