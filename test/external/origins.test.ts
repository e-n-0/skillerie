import { expect, it } from "vitest";
import type { ExternalRevision, Skill } from "../../src/core/types.js";
import { externalDiagnostics } from "../../src/engine/diagnostics.js";
import { externalOrigin } from "../../src/model/external.js";
import { renderSkill } from "../../src/adapters/opencode/content.js";

const revision: ExternalRevision = {
  url: "https://github.com/o/r/tree/2a40fd212345678901234567890123456789012345/a/b",
  sha: "2a40fd212345678901234567890123456789012345",
  path: "a/b",
};

it("normalizes the repository URL when locating a diagnostic from a tree entry", () => {
  // Given: an external entry configured with a GitHub tree URL.
  const sources = [{ directory: "/cache/repo/a/b", revision }];
  // When: a loading error leaves the engine.
  const diagnostics = externalDiagnostics(
    [
      {
        severity: "error",
        code: "source.frontmatter",
        message: "Invalid YAML.",
        file: "/cache/repo/a/b/SKILL.md",
      },
    ],
    sources,
  );
  // Then: ref and path appear only once in the exact location.
  expect(diagnostics[0]?.file).toBe("https://github.com/o/r@2a40fd2/a/b/SKILL.md");
});

it.each([
  [revision.url, "https://github.com/o/r"],
  ["https://github.com/o/r.git", "https://github.com/o/r"],
  ["https://example.com/o/r.git", "https://example.com/o/r"],
])("normalizes provenance when the external URL is %s", async (url, repository) => {
  // Given: a parsed external skill with no support files.
  const skill: Skill = {
    name: "review",
    file: "/cache/repo/a/b/SKILL.md",
    dir: "/cache/repo/a/b",
    source: "external",
    harnesses: ["opencode"],
    external: { ...revision, url },
    frontmatter: { name: "review", description: "Use when reviewing." },
    body: "Review changes.",
    supportFiles: [],
  };
  // When: provenance is included in the rendered skill.
  const result = await renderSkill(skill, "/repo");
  const origin = externalOrigin(skill);
  // Then: the shared provenance helper and rendered source comment use the repository URL.
  expect(origin).toBe(`${repository}@2a40fd21/a/b`);
  expect(String(result.files[0]?.content)).toContain(
    `<!-- Source: ${repository}@2a40fd21/a/b/SKILL.md -->`,
  );
});
