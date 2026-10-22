import { expect, it } from "vitest";
import { rewritePluginRoot } from "../../src/dialect/index.js";
import { options } from "./options.js";

it.each(["${CLAUDE_PLUGIN_ROOT}", "$CLAUDE_PLUGIN_ROOT"])(
  "resolves authored skill paths when the root is %s",
  (root) => {
    // Given: the same logical skill stored under different source layouts.
    const directories = ["skills/example", "common/skills/example", "packages/catalog/example"];
    const text = `${root}/skills/example/references/guide.md`;
    // When: making each authored path relative to its current skill.
    const results = directories.map((skillDir) =>
      rewritePluginRoot(text, { ...options, skillDir }),
    );
    // Then: source layout does not appear in the support path.
    expect(results.map((result) => result.text)).toEqual(
      directories.map(() => "./references/guide.md"),
    );
  },
);

it.each(["${CLAUDE_PLUGIN_ROOT}", "$CLAUDE_PLUGIN_ROOT"])(
  "resolves sibling skills when the root is %s",
  (root) => {
    // Given: a sibling skill and a similarly named but distinct skill.
    const text = `${root}/skills/other/references/guide.md ${root}/skills/example-more/run.sh`;
    // When: resolving references from a nested source layout.
    const result = rewritePluginRoot(text, { ...options, skillDir: "common/skills/example" });
    // Then: each target is relative to the current skill, not a nested skills directory.
    expect(result.text).toBe("../other/references/guide.md ../example-more/run.sh");
  },
);

it("resolves discovered prefixes when the authored path includes its source layout", () => {
  // Given: source-relative paths are also supported authoring syntax.
  const text = "${CLAUDE_PLUGIN_ROOT}/common/skills/example/references/guide.md";
  // When: resolving the complete source directory.
  const result = rewritePluginRoot(text, { ...options, skillDir: "./common/skills/example/" });
  // Then: the complete discovered prefix is removed.
  expect(result.text).toBe("./references/guide.md");
});
