import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isMap, isScalar, type Scalar } from "yaml";
import { configDocument } from "../config/document.js";
import type { Diagnostic } from "../core/types.js";
import type { SkillChange } from "./external/changes.js";
import { outdatedRepo, type OutdatedEntry, type OutdatedOptions } from "./outdated.js";

export interface UpdateOptions extends OutdatedOptions {
  /** Only update entries where one of these skills changed; all changed entries when empty. */
  readonly skills?: readonly string[];
}

export interface UpdatedEntry {
  readonly index: number;
  readonly url: string;
  readonly from: string;
  readonly to: string;
  readonly skills: readonly SkillChange[];
}

export interface FollowedEntry {
  readonly index: number;
  readonly url: string;
  readonly message: string;
}

export interface UpdateResult {
  readonly updated: readonly UpdatedEntry[];
  /** Branch and default-branch entries already move with upstream; install picks them up. */
  readonly followed: readonly FollowedEntry[];
  readonly diagnostics: readonly Diagnostic[];
  readonly exitCode: 0 | 2;
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function scalarEdit(node: Scalar, value: string): Edit {
  const [start, end] = node.range ?? [0, 0];
  return { start, end, text: node.type === "PLAIN" ? value : JSON.stringify(value) };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The new pin: the default branch head for SHA pins, the newest semver tag for tag pins. */
function target(entry: OutdatedEntry): string | undefined {
  if (entry.kind === "sha") return entry.latestSha;
  if (entry.kind === "tag") return entry.newerTags.at(-1);
  return undefined;
}

/** Bump pinned external skills whose selected skills changed upstream, editing only their ref or URL text. */
export async function updateRepo(
  repoDir: string,
  options: UpdateOptions = {},
): Promise<UpdateResult> {
  const outdated = await outdatedRepo(repoDir, options);
  const diagnostics = [...outdated.diagnostics];
  if (outdated.exitCode === 2) return { updated: [], followed: [], diagnostics, exitCode: 2 };
  const wanted = options.skills ?? [];
  const selected = outdated.entries.filter(
    (entry) =>
      entry.outdated &&
      (wanted.length === 0 ||
        (entry.skills ?? []).some(
          (skill) => skill.status !== "unchanged" && wanted.includes(skill.name),
        )),
  );
  const file = join(repoDir, "skillerie.yaml");
  const source = await readFile(file, "utf8");
  const parsed = configDocument(source, file);
  const edits: Edit[] = [];
  const updated: UpdatedEntry[] = [];
  const followed: FollowedEntry[] = [];
  for (const entry of selected) {
    const to = target(entry);
    if (to === undefined) {
      followed.push({
        index: entry.index,
        url: entry.url,
        message: `follows ${entry.ref ?? "the default branch"}; run install to apply`,
      });
      continue;
    }
    const node = parsed.document.getIn(["skills", "external", entry.index], true);
    const ref = isMap(node) ? node.get("ref", true) : undefined;
    const url = isMap(node) ? node.get("url", true) : undefined;
    if (isScalar(ref)) edits.push(scalarEdit(ref, to));
    else if (isScalar(url) && typeof url.value === "string" && entry.ref !== undefined) {
      const pattern = new RegExp(`/tree/${escapeRegExp(entry.ref)}(?=/|$)`);
      if (!pattern.test(url.value)) {
        diagnostics.push({
          severity: "error",
          code: "update.ref",
          message: `${entry.url}: Cannot find the pinned ref in the URL.`,
          ...parsed.location(`/skills/external/${entry.index}/url`),
        });
        continue;
      }
      edits.push(scalarEdit(url, url.value.replace(pattern, `/tree/${to}`)));
    } else continue;
    updated.push({
      index: entry.index,
      url: entry.url,
      from: entry.ref ?? entry.sha,
      to,
      skills: entry.skills ?? [],
    });
  }
  if (diagnostics.some((item) => item.severity === "error"))
    return { updated: [], followed, diagnostics, exitCode: 2 };
  if (edits.length) {
    let text = source;
    for (const edit of [...edits].sort((left, right) => right.start - left.start))
      text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
    await writeFile(file, text);
  }
  return { updated, followed, diagnostics, exitCode: 0 };
}
