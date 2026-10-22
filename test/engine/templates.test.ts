import { expect, it } from "vitest";
import { expandTemplate } from "../../src/engine/templates.js";

const variables = {
  repo: "/home/alice/repo",
  home: "/home/alice",
  paths: { docs: "/home/alice/docs" },
} as const;

it("expands parsed values while preserving comments when a JSONC template is used", () => {
  // Given: a string key, value variables, and native placeholders.
  const content = '{\n// retained\n"${repo}": ["${paths.docs}", "{env:VALUE}", "$${repo}"],\n}';
  // When: template expansion parses the JSONC.
  const result = expandTemplate(
    { file: "settings.jsonc", relPath: "settings.jsonc", format: "jsonc", content },
    variables,
  );
  // Then: keys, comments, and native placeholders survive while values expand once.
  expect(result.diagnostics).toEqual([]);
  expect(result.template.content).toBe(
    '{\n// retained\n"${repo}": ["/home/alice/docs", "{env:VALUE}", "${repo}"],\n}',
  );
});

it("reports a JSON pointer when a template contains an unknown variable", () => {
  // Given: a parsed array containing an unsupported variable.
  const content = '{"items":["${unknown}"]}';
  // When: the template is validated.
  const result = expandTemplate(
    { file: "settings.json", relPath: "settings.json", format: "json", content },
    variables,
  );
  // Then: expansion diagnostics identify the exact source value.
  expect(result.diagnostics).toEqual([
    expect.objectContaining({
      code: "config.variable",
      file: "settings.json",
      jsonPath: "/items/0",
    }),
  ]);
});

it("reports a line when a JSON template contains a trailing comma", () => {
  // Given: strict JSON syntax containing a JSONC-only trailing comma.
  const content = '{\n"key": true,\n}';
  // When: the template is parsed as JSON.
  const result = expandTemplate(
    { file: "settings.json", relPath: "settings.json", format: "json", content },
    variables,
  );
  // Then: syntax errors carry one-based source lines.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "source.json", line: 3 }),
  );
});

it("expands TOML values when a template contains nested settings", () => {
  // Given: a TOML string value with a supported path variable.
  const content = '[settings]\npath = "${paths.docs}"\n';
  // When: the template is parsed and expanded.
  const result = expandTemplate(
    { file: "config.toml", relPath: "config.toml", format: "toml", content },
    variables,
  );
  // Then: the emitted settings carry the resolved value.
  expect(result.diagnostics).toEqual([]);
  expect(result.template.content).toContain('path = "/home/alice/docs"');
});
