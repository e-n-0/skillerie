import { createHash } from "node:crypto";
import { readFile, readdir, readlink } from "node:fs/promises";
import { join } from "node:path";
import { ignored } from "../../model/files.js";

/** How one selected external skill differs between two upstream commits. */
export interface SkillChange {
  readonly name: string;
  readonly status: "changed" | "unchanged" | "added" | "removed";
  /** Skill-relative paths that were added, removed, or modified. */
  readonly files: readonly string[];
}

function hasCode(error: unknown, ...codes: readonly string[]): boolean {
  return error instanceof Error && "code" in error && codes.includes(String(error.code));
}

/** Mirrors external discovery: a SKILL.md at the root is one skill, else immediate skill folders. */
async function skillDirectories(
  root: string,
  include: readonly string[] | undefined,
  label: string,
): Promise<ReadonlyMap<string, string>> {
  let children;
  try {
    children = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (hasCode(error, "ENOENT", "ENOTDIR")) return new Map();
    throw error;
  }
  if (children.some((child) => child.name === "SKILL.md" && !child.isDirectory()))
    return new Map([[label, root]]);
  const skills = new Map<string, string>();
  for (const child of children) {
    if (!child.isDirectory() || ignored(child.name)) continue;
    if (include !== undefined && !include.includes(child.name)) continue;
    const directory = join(root, child.name);
    if ((await readdir(directory)).includes("SKILL.md")) skills.set(child.name, directory);
  }
  return skills;
}

async function fingerprints(root: string, prefix = ""): Promise<ReadonlyMap<string, string>> {
  const files = new Map<string, string>();
  for (const child of await readdir(join(root, prefix), { withFileTypes: true })) {
    if (ignored(child.name)) continue;
    const path = prefix ? `${prefix}/${child.name}` : child.name;
    if (child.isDirectory())
      for (const [file, hash] of await fingerprints(root, path)) files.set(file, hash);
    else if (child.isSymbolicLink()) files.set(path, `link:${await readlink(join(root, path))}`);
    else if (child.isFile())
      files.set(
        path,
        createHash("sha256")
          .update(await readFile(join(root, path)))
          .digest("hex"),
      );
  }
  return files;
}

/** Compare the selected skills under two checkouts of the same external entry. */
export async function compareSkills(input: {
  readonly before: string;
  readonly after: string;
  readonly include?: readonly string[];
  readonly label: string;
}): Promise<readonly SkillChange[]> {
  const before = await skillDirectories(input.before, input.include, input.label);
  const after = await skillDirectories(input.after, input.include, input.label);
  const names = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changes: SkillChange[] = [];
  for (const name of names) {
    const old = before.get(name);
    const current = after.get(name);
    const oldFiles = old === undefined ? new Map<string, string>() : await fingerprints(old);
    const newFiles =
      current === undefined ? new Map<string, string>() : await fingerprints(current);
    const files = [...new Set([...oldFiles.keys(), ...newFiles.keys()])]
      .filter((file) => oldFiles.get(file) !== newFiles.get(file))
      .sort();
    changes.push({
      name,
      status:
        old === undefined
          ? "added"
          : current === undefined
            ? "removed"
            : files.length
              ? "changed"
              : "unchanged",
      files,
    });
  }
  return changes;
}

const SHOWN_FILES = 3;

/** Human summary of the skills that changed, for example `review (SKILL.md, +2 more)`. */
export function describeChanges(changes: readonly SkillChange[]): string {
  return changes
    .filter((change) => change.status !== "unchanged")
    .map((change) => {
      if (change.status !== "changed") return `${change.name} (${change.status})`;
      const shown = change.files.slice(0, SHOWN_FILES).join(", ");
      const more = change.files.length - SHOWN_FILES;
      return `${change.name} (${shown}${more > 0 ? `, +${more} more` : ""})`;
    })
    .join(", ");
}
