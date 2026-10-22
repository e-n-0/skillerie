import { expect, it } from "vitest";
import { parseFrontmatter } from "../../src/model/frontmatter.js";

it("preserves input when there is no leading fence", () => {
  // Given
  const input = "payload\n---\nname: example\n---\n";
  // When
  const result = parseFrontmatter(input, "example.md");
  // Then
  expect(result).toEqual({ body: input, diagnostics: [] });
});

it("preserves body bytes when parsing CRLF frontmatter", () => {
  // Given
  const body = "\r\npayload\r\n\r\n";
  // When
  const result = parseFrontmatter(`---\r\nname: example\r\n---\r\n${body}`, "example.md");
  // Then
  expect(result.body).toBe(body);
  expect(result.frontmatter?.["name"]).toBe("example");
});

it("uses YAML 1.2 when parsing boolean-like words", () => {
  // Given
  const text = "---\nvalue: no\nflag: true\n---\n";
  // When
  const result = parseFrontmatter(text, "example.md");
  // Then
  expect(result.frontmatter).toEqual({ value: "no", flag: true });
});

it("returns an empty mapping when frontmatter contains no fields", () => {
  // Given
  const text = "---\n# comment\n---\n";
  // When
  const result = parseFrontmatter(text, "example.md");
  // Then
  expect(result.frontmatter).toEqual({});
  expect(result.diagnostics).toEqual([]);
});

it("supports structured YAML when parsing nested values", () => {
  // Given
  const text = "---\nmetadata:\n  tags: [one, two]\n  value: 3\n---\n";
  // When
  const result = parseFrontmatter(text, "example.md");
  // Then
  expect(result.frontmatter).toEqual({ metadata: { tags: ["one", "two"], value: 3 } });
});

it("decodes multiline YAML when parsing block scalars", () => {
  // Given
  const text = "---\nfolded: >-\n  first\n  second\nliteral: |\n  first\n  second\n---\n";
  // When
  const result = parseFrontmatter(text, "example.md");
  // Then
  expect(result.frontmatter).toEqual({ folded: "first second", literal: "first\nsecond\n" });
});

it("reports a source line when duplicate keys are authored", () => {
  // Given
  const text = "---\nname: first\nname: second\n---\n";
  // When
  const result = parseFrontmatter(text, "example.md");
  // Then
  expect(result.frontmatter).toBeUndefined();
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ file: "example.md", line: 3, severity: "error" }),
  );
});

it("reports a source line when YAML is malformed", () => {
  // Given
  const text = "---\nvalue: [\n---\n";
  // When
  const result = parseFrontmatter(text, "example.md");
  // Then
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ file: "example.md", line: expect.any(Number) }),
  );
});

it("reports the opening line when the fence is unterminated", () => {
  // Given
  const text = "---\nname: example\n";
  // When
  const result = parseFrontmatter(text, "example.md");
  // Then
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ line: 1, code: "frontmatter.fence" }),
  );
});

it.each(["[one, two]", "null", "value: .inf", "value: &loop [*loop]", "? [one, two]\n: value"])(
  "rejects non-JSON mappings when frontmatter is %s",
  (yaml) => {
    // Given
    const text = `---\n${yaml}\n---\n`;
    // When
    const result = parseFrontmatter(text, "example.md");
    // Then
    expect(result.frontmatter).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ severity: "error", file: "example.md" }),
    );
  },
);

it("supports aliases when their resolved values are JSON-compatible", () => {
  // Given
  const text = "---\nfirst: &value [one, two]\nsecond: *value\n---\n";
  // When
  const result = parseFrontmatter(text, "example.md");
  // Then
  expect(result.frontmatter?.["second"]).toEqual(["one", "two"]);
  expect(result.diagnostics).toEqual([]);
});
