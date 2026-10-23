import { expect, it } from "vitest";
import { formatOutdated } from "../../src/cli.js";
import type { OutdatedEntry } from "../../src/engine/index.js";

const entry = (outdated: boolean, message: string): OutdatedEntry => ({
  url: "https://github.com/example/skills",
  ref: "v1.2.0",
  path: "",
  sha: "a".repeat(40),
  latestSha: "b".repeat(40),
  kind: "tag",
  newerTags: outdated ? ["v1.4.0"] : [],
  outdated,
  status: outdated ? "behind" : "current",
  message,
});

it("colors the status by whether the skill is behind when color is enabled", () => {
  // Given: one skill behind upstream and one up to date.
  const behind = entry(true, "v1.2.0 -> v1.4.0 available");
  const current = entry(false, "up to date");
  // When: both lines are formatted with color.
  const lines = [formatOutdated(behind, true), formatOutdated(current, true)];
  // Then: the ref is dimmed, behind is yellow and up to date is green.
  expect(lines).toEqual([
    "https://github.com/example/skills \x1b[2mv1.2.0\x1b[0m \x1b[1;33mv1.2.0 -> v1.4.0 available\x1b[0m",
    "https://github.com/example/skills \x1b[2mv1.2.0\x1b[0m \x1b[32mup to date\x1b[0m",
  ]);
});

it("keeps outdated lines plain when color is disabled", () => {
  // Given: a skill with no ref, which follows the default branch.
  const { ref: _ref, ...latest } = entry(false, "up to date");
  // When: the line is formatted without color.
  const line = formatOutdated(latest);
  // Then: it keeps the original plain format.
  expect(line).toBe("https://github.com/example/skills latest up to date");
});
