import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { isNoteFile, nextPatch, parseNote, renderNotes } from "../../scripts/changes.js";

const SCRIPT = path.resolve("scripts/changes.ts");

describe("parseNote", () => {
  it("reads the type and trimmed body", () => {
    expect(parseNote(".changes/a.md", "---\ntype: fix\n---\n\nFix the thing.\n")).toEqual({
      file: ".changes/a.md",
      type: "fix",
      body: "Fix the thing.",
    });
  });

  it.each([
    ["no front matter", "Fix the thing.\n", /front matter/],
    ["unknown type", "---\ntype: misc\n---\nText\n", /type must be one of/],
    ["empty body", "---\ntype: feat\n---\n\n", /body is empty/],
  ])("rejects %s with the file name", (_case, text, message) => {
    expect(() => parseNote(".changes/bad.md", text)).toThrow(message);
    expect(() => parseNote(".changes/bad.md", text)).toThrow(/\.changes\/bad\.md/);
  });
});

describe("helpers", () => {
  it("bumps the patch component of a version tag", () => {
    expect(nextPatch("v0.0.9")).toBe("0.0.10");
    expect(() => nextPatch("release-1")).toThrow(/vX\.Y\.Z/);
  });

  it("only treats markdown files directly under .changes as notes", () => {
    expect(isNoteFile(".changes/x.md")).toBe(true);
    expect(isNoteFile(".changes/README.md")).toBe(false);
    expect(isNoteFile(".changes/nested/x.md")).toBe(false);
    expect(isNoteFile("docs/x.md")).toBe(false);
  });

  it("groups notes by type in a fixed section order", () => {
    const rendered = renderNotes([
      { file: ".changes/b.md", type: "fix", body: "Second fix" },
      { file: ".changes/c.md", type: "feat", body: "Line one\nline two" },
      { file: ".changes/a.md", type: "fix", body: "First fix" },
    ]);
    expect(rendered).toBe(
      "### Features\n\n- Line one\n  line two\n\n### Fixes\n\n- First fix\n- Second fix\n",
    );
  });
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

  const commitNote = (name: string, type: string, body: string): void => {
    writeFileSync(path.join(repo, ".changes", name), `---\ntype: ${type}\n---\n${body}\n`);
    git("add", ".");
    git("commit", "-qm", `add ${name}`);
  };

  const run = (...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: "utf8" });

  const setup = (): void => {
    repo = mkdtempSync(path.join(tmpdir(), "changes-test-"));
    git("init", "-q", "-b", "main");
    mkdirSync(path.join(repo, ".changes"));
    writeFileSync(path.join(repo, ".changes", "README.md"), "How to write notes.\n");
    git("add", ".");
    git("commit", "-qm", "initial");
  };

  const release = () => run("release", "--notes", "notes.md", "--changelog", "CHANGELOG.md");

  it("skips the release when there is no version tag yet", () => {
    setup();
    commitNote("a.md", "feat", "Something new");
    const result = release();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("version=\n");
    expect(result.stderr).toMatch(/no vX\.Y\.Z tag/);
  });

  it("skips the release when no note was added since the latest tag", () => {
    setup();
    git("tag", "v0.0.1");
    writeFileSync(path.join(repo, "other.txt"), "x\n");
    git("add", ".");
    git("commit", "-qm", "unrelated");
    const result = release();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("version=\n");
  });

  it("releases the next patch with notes and a changelog of earlier tags", () => {
    setup();
    commitNote("first.md", "fix", "Fix included in 0.0.1");
    git("tag", "v0.0.1");
    commitNote("second.md", "feat", "Feature for 0.0.2");
    const result = release();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("version=0.0.2\n");
    expect(readFileSync(path.join(repo, "notes.md"), "utf8")).toBe(
      "### Features\n\n- Feature for 0.0.2\n",
    );
    const changelog = readFileSync(path.join(repo, "CHANGELOG.md"), "utf8");
    expect(changelog.indexOf("## 0.0.2")).toBeLessThan(changelog.indexOf("## 0.0.1"));
    expect(changelog).toContain("- Fix included in 0.0.1");
    expect(changelog).toContain("- Feature for 0.0.2");
  });

  it("fails the PR check without a new note and passes with one", () => {
    setup();
    git("checkout", "-qb", "topic");
    writeFileSync(path.join(repo, "other.txt"), "x\n");
    git("add", ".");
    git("commit", "-qm", "no note");
    const missing = run("check", "--base", "main");
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/no release note added/);

    commitNote("topic.md", "docs", "Document the topic");
    const present = run("check", "--base", "main");
    expect(present.status).toBe(0);
    expect(present.stdout).toContain("ok .changes/topic.md (docs)");
  });

  it("fails on a malformed note", () => {
    setup();
    git("tag", "v0.0.1");
    commitNote("bad.md", "misc", "Wrong type");
    const result = release();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/\.changes\/bad\.md: type must be one of/);
  });
});
