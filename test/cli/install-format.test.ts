import { expect, it } from "vitest";
import { formatInstallReport } from "../../src/cli.js";
import type { LifecycleResult } from "../../src/engine/index.js";

const home = "/home/alice";
const result = (overrides: Partial<LifecycleResult> = {}): LifecycleResult => ({
  valid: true,
  profile: "work",
  diagnostics: [],
  installations: [
    {
      harness: "opencode",
      home: `${home}/.config/opencode`,
      installed: true,
      managedPaths: [],
      actions: [
        { kind: "LINK", target: `${home}/.config/opencode/AGENTS.md` },
        { kind: "LINK", target: `${home}/.config/opencode/skills/review` },
        { kind: "SKIP", target: `${home}/.config/opencode/skills` },
        { kind: "BACKUP", target: `${home}/.config/opencode/opencode.jsonc` },
      ],
      userEdits: [],
    },
    {
      harness: "codex",
      home: `${home}/.codex`,
      installed: true,
      managedPaths: [],
      actions: [],
      userEdits: [],
    },
  ],
  ...overrides,
});

it("summarizes each harness home with counts and shortened paths after an install", () => {
  // Given: one home with changes and one already current.
  const report = result();
  // When: the install report is formatted.
  const text = formatInstallReport(report, { home });
  // Then: each home is one aligned row, SKIP is not counted, and a summary closes it.
  expect(text).toBe(
    [
      "Profile: work",
      "",
      "  opencode  ~/.config/opencode  2 linked, 1 backed up",
      "  codex     ~/.codex            up to date",
      "",
      "Installed into 1 of 2 harness homes.",
      "",
    ].join("\n"),
  );
});

it("lists planned files and the next command when a check runs verbosely", () => {
  // Given: a planned install with drift against the active generation.
  const report = result({
    valid: false,
    drift: [{ relPath: "opencode/AGENTS.md", reason: "missing" }],
  });
  // When: the check report is formatted with details.
  const text = formatInstallReport(report, { home, check: true, verbose: true });
  // Then: planned counts use future wording, each file is listed, and the next step is named.
  expect(text).toContain("  opencode  ~/.config/opencode  2 to link, 1 to back up");
  expect(text).toContain("      LINK   ~/.config/opencode/skills/review");
  expect(text).toContain("1 generated files differ from the active generation.");
  expect(text).toContain("Run skillerie install to apply these changes.");
});

it("names edited files and suggests --force when the install leaves user edits", () => {
  // Given: a home where a managed file was edited by the user.
  const [first, second] = result().installations;
  if (!first || !second) throw new Error("fixture");
  const report = result({
    valid: false,
    installations: [{ ...first, userEdits: [`${home}/.config/opencode/AGENTS.md`] }, second],
  });
  // When: the install report is formatted.
  const text = formatInstallReport(report, { home });
  // Then: the edit is counted, listed, and the --force hint closes the report.
  expect(text).toContain("1 edited by you");
  expect(text).toContain("      edited ~/.config/opencode/AGENTS.md");
  expect(text).toContain(
    "Some files were edited by you and left alone. Use --force to back them up and replace them.",
  );
});
