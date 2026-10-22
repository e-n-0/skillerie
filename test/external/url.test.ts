import { expect, it } from "vitest";
import { parseExternalUrl } from "../../src/engine/external/url.js";

it.each([
  ["https://github.com/example/repo", "https://github.com/example/repo.git", undefined, ""],
  ["https://github.com/example/repo.git", "https://github.com/example/repo.git", undefined, ""],
  [
    "https://github.com/example/repo/tree/main/skills/review",
    "https://github.com/example/repo.git",
    "main",
    "skills/review",
  ],
  ["git@github.com:example/repo.git", "git@github.com:example/repo.git", undefined, ""],
  ["ssh://git@example.com/owner/repo.git", "ssh://git@example.com/owner/repo.git", undefined, ""],
  ["file:///tmp/example", "file:///tmp/example", undefined, ""],
])("parses %s when it identifies an external repository", (url, cloneUrl, ref, path) => {
  // Given: a supported external URL.
  const input = { url };
  // When: the URL is normalized without contacting any remote.
  const parsed = parseExternalUrl(input);
  // Then: the clone location, embedded selection, and safe cache name are deterministic.
  expect(parsed).toMatchObject({ cloneUrl, path });
  expect(parsed.ref).toBe(ref);
  expect(parsed.cacheKey).not.toMatch(/(^|\/)\.\.(\/|$)/);
});

it("honors explicit selection when a GitHub tree URL embeds different values", () => {
  // Given: explicit values that differ from both tree URL defaults.
  const input = {
    url: "https://github.com/example/repo/tree/main/skills/review",
    ref: "v2.0.0",
    path: "other",
  };
  // When: parsing selection.
  const parsed = parseExternalUrl(input);
  // Then: explicit ref and path win independently.
  expect(parsed).toMatchObject({ ref: "v2.0.0", path: "other" });
});

it.each(["../outside", "skills/../../outside", "/absolute", "skills\\outside"])(
  "rejects %s when a skill path escapes its repository",
  (path) => {
    // Given: an external entry with an unsafe path.
    const input = { url: "https://example.com/repo.git", path };
    // When / Then: parsing rejects it at the path boundary.
    expect(() => parseExternalUrl(input)).toThrow(/inside the external repository/);
  },
);

it.each([
  "--upload-pack=other",
  "http://example.com/repo",
  "https://example.com/%xx",
  "https://github.com/example/repo/blob/main/SKILL.md",
])("rejects %s when the URL is not a supported remote", (url) => {
  // Given: an unsupported URL rather than a remote.
  const input = { url };
  // When / Then: it cannot become a git option or an arbitrary web path.
  expect(() => parseExternalUrl(input)).toThrow();
});
