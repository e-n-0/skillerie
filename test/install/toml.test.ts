import { parse } from "smol-toml";
import { expect, it } from "vitest";
import { tomlOwnership } from "../../src/install/toml.js";

it.each([
  ['model = "local"\n', 'model = "managed"\n', ["/model"]],
  ["[tools]\nlocal = true\n", "[tools]\nmanaged = true\n", ["/tools"]],
  ["tools = { local = true }\n", "[tools.docs]\nenabled = true\n", ["/tools"]],
  ["tools.docs.enabled = true\n", "[tools.docs]\nmanaged = true\n", ["/tools/docs"]],
  ["[tools.docs]\nenabled = true\n", "tools.docs = false\n", ["/tools/docs"]],
  ['["tools.docs"]\nenabled = true\n', '["tools.docs"]\nmanaged = true\n', ["/tools.docs"]],
  ['[[tools]]\nname = "local"\n', '[[tools]]\nname = "managed"\n', ["/tools"]],
] as const)("detects structural collisions for %s", (before, managed, paths) => {
  // Given: two individually valid TOML documents.
  parse(before);
  parse(managed);
  // When: ownership is computed.
  const result = tomlOwnership(before, managed);
  // Then: collisions name the smallest conflicting definitions.
  expect(result.conflicts.map((item) => item.jsonPath)).toEqual(paths);
  expect(parse(managed + result.content)).toEqual(parse(managed));
});

it("preserves disjoint tables and multiline values when scanning definitions", () => {
  // Given: header-looking strings and arrays are values, not declarations.
  const before =
    'note = """\n[tools.docs]\nfake = true\n"""\n' +
    'items = [\n"[tools.docs]",\n]\n[tools.tracker]\nenabled = true\n';
  const managed = '[tools.docs]\nurl = "https://example.com"\n';
  // When: unrelated tables are compared.
  const result = tomlOwnership(before, managed);
  // Then: implicit parents and text inside values do not collide.
  expect(result.conflicts).toEqual([]);
  expect(result.content).toBe(before);
});
