import { expect, it } from "vitest";
import { formatOutdatedReport } from "../../src/cli.js";
import type { OutdatedEntry, OutdatedResult } from "../../src/engine/index.js";

const pinned: OutdatedEntry = {
  index: 0,
  url: "https://github.com/example/skills",
  ref: "a".repeat(40),
  path: "skills",
  sha: "a".repeat(40),
  latestSha: "b".repeat(40),
  kind: "sha",
  newerTags: [],
  outdated: true,
  status: "behind",
  selected: ["review", "release"],
  skills: [
    { name: "release", status: "unchanged", files: [] },
    { name: "review", status: "changed", files: ["SKILL.md", "a.md", "b.md", "c.md"] },
  ],
  message: "",
};
const floating: OutdatedEntry = {
  ...pinned,
  index: 1,
  url: "https://github.com/example/tools/tree/main/skills/lint",
  ref: "main",
  kind: "branch",
  selected: ["lint"],
  skills: [{ name: "lint", status: "added", files: ["SKILL.md"] }],
};
const current: OutdatedEntry = {
  ...pinned,
  index: 2,
  url: "https://github.com/example/docs",
  outdated: false,
  status: "current",
  selected: ["docs"],
};
const result = (entries: readonly OutdatedEntry[]): OutdatedResult => ({
  entries,
  diagnostics: [],
  exitCode: entries.some((entry) => entry.outdated) ? 1 : 0,
});

it("lists changed skills, unchanged skills and the next commands when sources changed", () => {
  // Given: a pinned and a floating source with changes, and one current source.
  const report = result([pinned, floating, current]);
  // When: the report is formatted without color.
  const text = formatOutdatedReport(report);
  // Then: rows are aligned per skill, files are capped, and each next step appears once.
  expect(text).toBe(
    [
      "Changed upstream:",
      "",
      "  review  changed  example/skills  aaaaaaa -> bbbbbbb  SKILL.md, a.md, b.md, +1 more",
      "  lint    added    example/tools   aaaaaaa -> bbbbbbb  SKILL.md",
      "",
      "No changes: release, docs",
      "",
      "Run skillerie update to move this pin, then skillerie install.",
      "Run skillerie install to pick up the source that follows a branch.",
      "",
    ].join("\n"),
  );
});

it("prints one line when every source is up to date", () => {
  // Given: only current sources.
  const report = result([current, { ...current, index: 3 }]);
  // When: the report is formatted.
  const text = formatOutdatedReport(report);
  // Then: a single summary line replaces the table.
  expect(text).toBe("All 2 external sources are up to date.\n");
});

it("colors statuses and dims details when color is enabled", () => {
  // Given: a changed pinned source.
  const report = result([pinned]);
  // When: the report is formatted with color.
  const text = formatOutdatedReport(report, true);
  // Then: the status is yellow and the version change is dimmed.
  expect(text).toContain("\x1b[33mchanged\x1b[0m");
  expect(text).toContain("\x1b[2maaaaaaa -> bbbbbbb\x1b[0m");
});
