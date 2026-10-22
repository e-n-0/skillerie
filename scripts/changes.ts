import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
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

function release(notesFile: string): void {
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
  writeFileSync(notesFile, renderNotes(notes));
  console.log(`version=${nextPatch(latest)}`);
}

function main([command, flag, value]: readonly string[]): void {
  if (command === "check" && flag === "--pr" && value) return check(value);
  if (command === "release" && flag === "--notes" && value) return release(value);
  throw new Error("usage: changes.ts check --pr <number> | release --notes <file>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
