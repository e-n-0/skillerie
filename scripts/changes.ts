import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

const SECTIONS = {
  feat: "Features",
  fix: "Fixes",
  perf: "Performance",
  docs: "Documentation",
  chore: "Maintenance",
} as const;

export type NoteType = keyof typeof SECTIONS;

export interface Note {
  readonly pr: number;
  readonly type: NoteType;
  readonly description: string;
}

const NOTE_PATH = /^\.changes\/(\d+)\.yaml$/;

export function parseNote(file: string, text: string): Note {
  const pr = Number(NOTE_PATH.exec(file)?.[1]);
  if (!Number.isInteger(pr)) throw new Error(`${file}: name must be .changes/<pr-number>.yaml`);
  const data: unknown = parse(text);
  const { type, description } = (data ?? {}) as Record<string, unknown>;
  if (typeof type !== "string" || !Object.hasOwn(SECTIONS, type)) {
    throw new Error(`${file}: type must be one of ${Object.keys(SECTIONS).join(", ")}`);
  }
  if (typeof description !== "string" || description.trim() === "") {
    throw new Error(`${file}: description must be a non-empty string`);
  }
  return { pr, type: type as NoteType, description: description.trim() };
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
      .sort((a, b) => a.pr - b.pr)
      .map((note) => `- ${note.description.split("\n").join("\n  ")} (#${note.pr})`);
    if (items.length > 0) sections.push(`### ${title}\n\n${items.join("\n")}`);
  }
  return `${sections.join("\n\n")}\n`;
}

export function prependChangelog(
  existing: string,
  version: string,
  date: string,
  notes: string,
): string {
  const header = "# Changelog\n";
  const rest = existing.startsWith(header) ? existing.slice(header.length).trimStart() : existing;
  const section = `## ${version} - ${date}\n\n${notes}`;
  return `${header}\n${section}${rest === "" ? "" : `\n${rest}`}`;
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function readNote(file: string): Note {
  return parseNote(file, git("show", `HEAD:${file}`));
}

function check(pr: string): void {
  const file = `.changes/${pr}.yaml`;
  if (git("ls-tree", "--name-only", "HEAD", "--", file) === "") {
    throw new Error(`missing ${file} (see .changes/README.md, or label the PR no-release-note)`);
  }
  const note = readNote(file);
  console.log(`ok .changes/${note.pr}.yaml (${note.type})`);
}

function release(notesFile: string, changelogFile: string): void {
  const latest = git("tag", "--list", "v*.*.*", "--sort=-v:refname").split("\n")[0] ?? "";
  if (latest === "") {
    console.error("no vX.Y.Z tag yet; publish the first release manually");
    console.log("version=");
    return;
  }
  const added = git("diff", "--name-only", "--diff-filter=A", latest, "HEAD", "--", ".changes");
  const notes = added
    .split("\n")
    .filter((file) => NOTE_PATH.test(file))
    .map(readNote);
  if (notes.length === 0) {
    console.error(`no new release notes since ${latest}; nothing to release`);
    console.log("version=");
    return;
  }
  const version = nextPatch(latest);
  const rendered = renderNotes(notes);
  const existing = existsSync(changelogFile) ? readFileSync(changelogFile, "utf8") : "";
  const date = new Date().toISOString().slice(0, 10);
  writeFileSync(notesFile, rendered);
  writeFileSync(changelogFile, prependChangelog(existing, version, date, rendered));
  console.log(`version=${version}`);
}

function main([command, ...args]: readonly string[]): void {
  const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const pr = option("--pr");
  const notes = option("--notes");
  const changelog = option("--changelog");
  if (command === "check" && pr) return check(pr);
  if (command === "release" && notes && changelog) return release(notes, changelog);
  throw new Error(
    "usage: changes.ts check --pr <number> | release --notes <file> --changelog <file>",
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
