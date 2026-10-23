import { expect, it } from "vitest";
import {
  formatTally,
  formatGroupedDiagnostics,
  formatInstallReport,
  formatStatusReport,
} from "../../src/cli.js";
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

it("counts removals and restorations when uninstall reports", () => {
  // Given: an uninstall that moved two managed entries away and restored one replaced link.
  const [first, second] = result().installations;
  if (!first || !second) throw new Error("fixture");
  const { profile: _profile, ...base } = result();
  const report: LifecycleResult = {
    ...base,
    installations: [
      {
        ...first,
        actions: [
          { kind: "BACKUP", target: `${home}/.config/opencode/AGENTS.md` },
          { kind: "BACKUP", target: `${home}/.config/opencode/skills/review` },
          { kind: "RELINK", target: `${home}/.config/opencode/skills/review` },
        ],
      },
    ],
  };
  // When: the uninstall report is formatted.
  const text = formatInstallReport(report, { home, uninstall: true });
  // Then: removals and restorations are counted in uninstall terms.
  expect(text).toBe(
    [
      "  opencode  ~/.config/opencode  2 removed, 1 restored",
      "",
      "Removed skillerie from 1 harness home; replaced files were restored.",
      "",
    ].join("\n"),
  );
});

it("shows ownership, pending changes and external skills when status reports", () => {
  // Given: one current home, one with pending changes, one owned elsewhere, one not installed.
  const [first, second] = result().installations;
  if (!first || !second) throw new Error("fixture");
  const owner = { path: "/repo", name: "repo" } as unknown as NonNullable<typeof first.owner>;
  const report = result({
    valid: false,
    clean: false,
    installations: [
      { ...first, owner, actions: [] },
      { ...second, owner, actions: [{ kind: "LINK", target: `${home}/.codex/AGENTS.md` }] },
      { ...second, harness: "omo", home: `${home}/.omo`, owner: { ...owner, path: "/other" } },
      { ...second, harness: "pi", home: `${home}/.pi/agent`, installed: false },
    ],
    external: [
      {
        url: "https://github.com/acme/skills",
        ref: "v1.2.0",
        sha: "c".repeat(40),
        path: "skills/review",
      },
      { url: "https://github.com/acme/tools.git", sha: "d".repeat(40), path: "" },
    ],
  });
  // When: the status report is formatted.
  const text = formatStatusReport(report, { home, repo: "/repo" });
  // Then: each home has one state, externals use short names, and the next step is named.
  expect(text).toBe(
    [
      "Profile: work",
      "",
      "  opencode  ~/.config/opencode  installed, up to date",
      "  codex     ~/.codex            installed, 1 change pending",
      "  omo       ~/.omo              installed from /other",
      "  pi        ~/.pi/agent         not installed",
      "",
      "External skills:",
      "  acme/skills  v1.2.0  ccccccc  skills/review",
      "  acme/tools           ddddddd",
      "",
      "Run skillerie install to bring these homes up to date.",
      "",
    ].join("\n"),
  );
});

it("groups warnings by code and keeps errors whole when install prints diagnostics", () => {
  // Given: two warnings with one code and an error.
  const diagnostics = [
    {
      severity: "warn" as const,
      code: "engine.permission.unenforced",
      message: "a",
      file: "/repo/agents/explorer.md",
    },
    {
      severity: "warn" as const,
      code: "engine.permission.unenforced",
      message: "b",
      file: "/repo/agents/reviewer.md",
    },
    {
      severity: "error" as const,
      code: "install.lock",
      message: "Locked.",
      file: "/home/alice/.codex",
    },
  ];
  // When: install formats them without color.
  const lines = formatGroupedDiagnostics(diagnostics);
  // Then: the error is unchanged, the warnings share one line, and validate is suggested.
  expect(lines).toEqual([
    "error /home/alice/.codex install.lock Locked.",
    "warn engine.permission.unenforced (2): explorer, reviewer",
    "Add --verbose to see each warning.",
  ]);
});

it("counts errors, warnings and passed checks when a tally is printed", () => {
  // Given: diagnostics of every severity.
  const diagnostics = [
    { severity: "error" as const, code: "a", message: "a" },
    { severity: "warn" as const, code: "b", message: "b" },
    { severity: "warn" as const, code: "b", message: "c" },
    { severity: "info" as const, code: "c", message: "d" },
  ];
  // When: the tally is formatted.
  const text = formatTally(diagnostics);
  // Then: each severity is counted with the right plural.
  expect(text).toBe("1 error, 2 warnings, 1 passed");
});

it("hides passed checks and names skills by folder when doctor prints diagnostics", () => {
  // Given: a passed check and a warning raised from a skill's SKILL.md.
  const diagnostics = [
    { severity: "info" as const, code: "doctor.node.supported", message: "ok" },
    {
      severity: "warn" as const,
      code: "doctor.bin.missing",
      message: "x",
      file: "/repo/skills/autotest-pr/SKILL.md",
    },
  ];
  // When: doctor formats them without verbose output.
  const lines = formatGroupedDiagnostics(diagnostics, { hideInfo: true });
  // Then: the passed check is hidden and the warning names the skill folder.
  expect(lines).toEqual([
    "warn doctor.bin.missing (1): autotest-pr",
    "Add --verbose to see each warning and passed check.",
  ]);
});

it("shows the message when one file raised every warning of a code", () => {
  // Given: two warnings with one code, both attributed to skillerie.yaml.
  const diagnostics = ["a", "b"].map((name) => ({
    severity: "warn" as const,
    code: "external.offline",
    message: `https://github.com/acme/${name}: External content is not cached; run install to fetch it.`,
    file: "/repo/skillerie.yaml",
  }));
  // When: they are grouped.
  const lines = formatGroupedDiagnostics(diagnostics);
  // Then: the shared message replaces the repeated file name.
  expect(lines[0]).toBe(
    "warn external.offline (2): External content is not cached; run install to fetch it.",
  );
});
