import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { nextPatch, parseNote, prependChangelog, renderNotes } from "./changes.js";

const SCRIPT = path.resolve(".github/scripts/changes.ts");

describe("parseNote", () => {
  it("reads the PR number from the file name", () => {
    expect(parseNote(".changes/42.yaml", "type: fix\ndescription: Fix the thing.\n")).toEqual({
      pr: 42,
      type: "fix",
      description: "Fix the thing.",
    });
  });

  it.each([
    ["a non-numeric name", ".changes/topic.yaml", "type: fix\ndescription: x\n", /pr-number/],
    ["an unknown type", ".changes/1.yaml", "type: misc\ndescription: x\n", /type must be/],
    ["a missing description", ".changes/1.yaml", "type: feat\n", /description must be/],
  ])("rejects %s", (_case, file, text, message) => {
    expect(() => parseNote(file, text)).toThrow(message);
  });
});

it("bumps the patch component of a version tag", () => {
  expect(nextPatch("v0.0.9")).toBe("0.0.10");
  expect(() => nextPatch("release-1")).toThrow(/vX\.Y\.Z/);
});

it("groups notes by type and orders them by PR number", () => {
  const rendered = renderNotes([
    { pr: 9, type: "fix", description: "Second fix" },
    { pr: 3, type: "feat", description: "New thing" },
    { pr: 4, type: "fix", description: "First fix" },
  ]);
  expect(rendered).toBe(
    "### Features\n\n- New thing (#3)\n\n### Fixes\n\n- First fix (#4)\n- Second fix (#9)\n",
  );
});

it("prepends the new release under the changelog header", () => {
  const first = prependChangelog("", "0.0.2", "2026-01-02", "### Fixes\n\n- A (#1)\n");
  expect(first).toBe("# Changelog\n\n## 0.0.2 - 2026-01-02\n\n### Fixes\n\n- A (#1)\n");
  expect(prependChangelog(first, "0.0.3", "2026-01-03", "### Features\n\n- B (#2)\n")).toBe(
    "# Changelog\n\n## 0.0.3 - 2026-01-03\n\n### Features\n\n- B (#2)\n\n" +
      "## 0.0.2 - 2026-01-02\n\n### Fixes\n\n- A (#1)\n",
  );
});

describe("changes.ts in a git repository", () => {
  let repo = "";

  afterEach(() => {
    if (repo !== "") rmSync(repo, { recursive: true, force: true });
  });

  const git = (...args: string[]): string =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "tag.gpgsign=false",
        ...args,
      ],
      { cwd: repo, encoding: "utf8" },
    );

  const commit = (file: string, text: string): void => {
    writeFileSync(path.join(repo, file), text);
    git("add", ".");
    git("commit", "-qm", `add ${file}`);
  };

  const run = (...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: "utf8" });

  const setup = (): void => {
    repo = mkdtempSync(path.join(tmpdir(), "changes-test-"));
    git("init", "-q", "-b", "main");
    mkdirSync(path.join(repo, ".changes"));
    commit(".changes/README.md", "How to write notes.\n");
  };

  const release = () => run("release", "--notes", "notes.md", "--changelog", "CHANGELOG.md");

  it("skips the release when there is no version tag yet", () => {
    setup();
    commit(".changes/1.yaml", "type: feat\ndescription: Something new\n");
    const result = release();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("version=\n");
    expect(result.stderr).toMatch(/no vX\.Y\.Z tag/);
  });

  it("skips the release when no note was added since the latest tag", () => {
    setup();
    git("tag", "v0.0.1");
    commit("other.txt", "x\n");
    const result = release();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("version=\n");
  });

  it("releases the next patch with only the notes added since the latest tag", () => {
    setup();
    commit(".changes/1.yaml", "type: fix\ndescription: Shipped in 0.0.1\n");
    git("tag", "v0.0.1");
    commit("CHANGELOG.md", "# Changelog\n\n## 0.0.1 - 2026-01-01\n\n- Initial release\n");
    commit(".changes/2.yaml", "type: feat\ndescription: Feature for 0.0.2\n");
    const result = release();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("version=0.0.2\n");
    expect(readFileSync(path.join(repo, "notes.md"), "utf8")).toBe(
      "### Features\n\n- Feature for 0.0.2 (#2)\n",
    );
    const changelog = readFileSync(path.join(repo, "CHANGELOG.md"), "utf8");
    expect(changelog).toMatch(/^# Changelog\n\n## 0\.0\.2 - \d{4}-\d{2}-\d{2}\n\n### Features\n/);
    expect(changelog).toContain("- Feature for 0.0.2 (#2)\n\n## 0.0.1 - 2026-01-01");
  });

  it("fails on a malformed note", () => {
    setup();
    git("tag", "v0.0.1");
    commit(".changes/5.yaml", "type: misc\ndescription: Wrong type\n");
    const result = release();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/\.changes\/5\.yaml: type must be/);
  });

  it("checks that the PR's own note exists", () => {
    setup();
    const missing = run("check", "--pr", "7");
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/missing \.changes\/7\.yaml/);

    commit(".changes/7.yaml", "type: docs\ndescription: Document the topic\n");
    const present = run("check", "--pr", "7");
    expect(present.status).toBe(0);
    expect(present.stdout).toBe("ok .changes/7.yaml (docs)\n");
  });
});
