import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CHANGES_DIR = ".changes";

const SECTIONS = {
  feat: "Features",
  fix: "Fixes",
  perf: "Performance",
  docs: "Documentation",
  chore: "Maintenance",
} as const;

export type NoteType = keyof typeof SECTIONS;

export interface Note {
  readonly file: string;
  readonly type: NoteType;
  readonly body: string;
}

export interface Release {
  readonly version: string;
  readonly date: string;
  readonly notes: readonly Note[];
}

function isNoteType(value: string): value is NoteType {
  return Object.hasOwn(SECTIONS, value);
}

export function isNoteFile(file: string): boolean {
  return (
    path.posix.dirname(file) === CHANGES_DIR &&
    file.endsWith(".md") &&
    path.posix.basename(file) !== "README.md"
  );
}

export function parseNote(file: string, text: string): Note {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!match) {
    throw new Error(`${file}: expected front matter with a "type" field`);
  }
  const [, header = "", rest = ""] = match;
  const type = /^type:\s*(\S+)\s*$/m.exec(header)?.[1] ?? "";
  if (!isNoteType(type)) {
    throw new Error(
      `${file}: type must be one of ${Object.keys(SECTIONS).join(", ")}, got "${type}"`,
    );
  }
  const body = rest.trim();
  if (body === "") throw new Error(`${file}: the note body is empty`);
  return { file, type, body };
}

export function nextPatch(tag: string): string {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (!match) throw new Error(`tag "${tag}" is not of the form vX.Y.Z`);
  const [, major, minor, patch] = match;
  return `${major}.${minor}.${Number(patch) + 1}`;
}

export function renderNotes(notes: readonly Note[]): string {
  const sections: string[] = [];
  for (const [type, title] of Object.entries(SECTIONS)) {
    const items = notes
      .filter((note) => note.type === type)
      .sort((a, b) => a.file.localeCompare(b.file))
      .map((note) => `- ${note.body.split("\n").join("\n  ")}`);
    if (items.length > 0) sections.push(`### ${title}\n\n${items.join("\n")}`);
  }
  return `${sections.join("\n\n")}\n`;
}

export function renderChangelog(releases: readonly Release[]): string {
  const parts = releases
    .filter((release) => release.notes.length > 0)
    .map((release) => `## ${release.version} - ${release.date}\n\n${renderNotes(release.notes)}`);
  return `# Changelog\n\n${parts.join("\n")}`;
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function lines(output: string): string[] {
  return output === "" ? [] : output.split("\n");
}

function readNotes(ref: string, files: readonly string[]): Note[] {
  return files.filter(isNoteFile).map((file) => parseNote(file, git("show", `${ref}:${file}`)));
}

function addedBetween(from: string | undefined, to: string): string[] {
  if (from === undefined) {
    return lines(git("ls-tree", "-r", "--name-only", to, "--", CHANGES_DIR));
  }
  return lines(git("diff", "--name-only", "--diff-filter=A", from, to, "--", CHANGES_DIR));
}

function versionTags(): string[] {
  return lines(git("tag", "--list", "v*.*.*", "--sort=v:refname")).filter((tag) =>
    /^v\d+\.\d+\.\d+$/.test(tag),
  );
}

function check(base: string): void {
  const notes = readNotes("HEAD", addedBetween(git("merge-base", base, "HEAD"), "HEAD"));
  if (notes.length === 0) {
    throw new Error(
      `no release note added under ${CHANGES_DIR}/ (see ${CHANGES_DIR}/README.md, or label the PR no-release-note)`,
    );
  }
  for (const note of notes) console.log(`ok ${note.file} (${note.type})`);
}

function release(notesFile: string, changelogFile: string): void {
  const tags = versionTags();
  const latest = tags.at(-1);
  if (latest === undefined) {
    console.error("no vX.Y.Z tag yet; publish the first release manually");
    console.log("version=");
    return;
  }
  const pending = readNotes("HEAD", addedBetween(latest, "HEAD"));
  if (pending.length === 0) {
    console.error(`no new release notes since ${latest}; nothing to release`);
    console.log("version=");
    return;
  }
  const version = nextPatch(latest);
  const published = tags.map((tag, index) => ({
    version: tag.slice(1),
    date: git("log", "-1", "--format=%cs", tag),
    notes: readNotes(tag, addedBetween(tags[index - 1], tag)),
  }));
  const releases: Release[] = [
    { version, date: new Date().toISOString().slice(0, 10), notes: pending },
    ...published.reverse(),
  ];
  writeFileSync(notesFile, renderNotes(pending));
  writeFileSync(changelogFile, renderChangelog(releases));
  console.log(`version=${version}`);
}

function option(args: readonly string[], name: string): string {
  const value = args[args.indexOf(name) + 1];
  if (!args.includes(name) || value === undefined) throw new Error(`missing ${name} <value>`);
  return value;
}

function main(args: readonly string[]): void {
  const [command, ...rest] = args;
  if (command === "check") return check(option(rest, "--base"));
  if (command === "release") {
    return release(option(rest, "--notes"), option(rest, "--changelog"));
  }
  throw new Error(
    "usage: changes.ts check --base <ref> | release --notes <file> --changelog <file>",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
