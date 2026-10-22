import { isAbsolute, join, resolve } from "node:path";
import { fileImage, safeAncestors, text, within } from "./images.js";
import { releaseEntry } from "./lifecycle.js";
import { restoreMerge } from "./merges.js";
import { Planner } from "./planner.js";
import { readManifest, statePath } from "./storage.js";
import { InstallError } from "./types.js";
import type { InstallOptions, InstallPlan } from "./types.js";

export function validateOptions(options: InstallOptions): void {
  for (const path of [
    options.repo.path,
    options.harnessHome,
    options.backupRoot,
    options.home ?? options.harnessHome,
  ]) {
    if (!isAbsolute(path) || resolve(path) !== path)
      throw new InstallError("path.absolute", "Installer paths must be normalized absolute paths.");
  }
  if (within(join(options.harnessHome, ".skillerie"), options.backupRoot)) {
    throw new InstallError("path.backup", "Backup storage must be outside installer metadata.");
  }
  const targets = new Map<string, string>();
  for (const action of options.actions) {
    if (
      !isAbsolute(action.target) ||
      resolve(action.target) !== action.target ||
      within(join(options.harnessHome, ".skillerie"), action.target) ||
      within(action.target, options.harnessHome) ||
      within(action.target, options.backupRoot)
    ) {
      throw new InstallError("path.target", `Unsafe install target: ${action.target}`);
    }
    if (
      "source" in action &&
      (!isAbsolute(action.source) || within(action.target, action.source))
    ) {
      throw new InstallError(
        "path.source",
        "Install sources must be absolute and outside their target.",
      );
    }
    const previous = targets.get(action.target);
    const merge = action.kind === "mergeBlock" || action.kind === "jsonArrayMerge";
    if (previous && (previous !== "merge" || !merge)) {
      throw new InstallError("path.duplicate", `Overlapping install targets: ${action.target}`);
    }
    targets.set(action.target, merge ? "merge" : "owned");
  }
}

export async function prepare(options: InstallOptions): Promise<Planner> {
  validateOptions(options);
  await safeAncestors(
    statePath(options.harnessHome, "manifest.json"),
    options.home ?? options.harnessHome,
  );
  const manifest = await readManifest(options.harnessHome);
  if (
    manifest &&
    (manifest.repo.path !== options.repo.path || manifest.harness !== options.harness) &&
    !options.takeover
  ) {
    throw new InstallError(
      "install.owner",
      "Another repository or harness owns this installation; use takeover to replace it.",
    );
  }
  return new Planner(options, manifest);
}

export async function buildPlanner(options: InstallOptions): Promise<Planner> {
  const planner = await prepare(options);
  for (const entry of planner.previous.values()) {
    if (entry.kind !== "merge") continue;
    const selected = options.actions.flatMap((action) =>
      action.target === entry.target && "blockId" in action ? [action.blockId] : [],
    );
    if (!selected.length) continue;
    const removed = entry.merges.filter((record) => !selected.includes(record.blockId));
    if (!removed.length) continue;
    const current = await planner.read(entry.target);
    if (current.kind === "absent" || planner.skip(entry, current)) continue;
    let content = text(current);
    for (const record of [...removed].reverse()) content = restoreMerge(content, record);
    await planner.set(
      entry.target,
      fileImage(content, current.kind === "file" ? current.mode : 0o644),
    );
    planner.entries.set(entry.target, {
      ...entry,
      merges: entry.merges.filter((record) => selected.includes(record.blockId)),
    });
  }
  for (const action of options.actions) {
    await safeAncestors(action.target, options.home ?? options.harnessHome);
    await planner.action(action);
  }
  for (const entry of [...planner.previous.values()].reverse()) {
    if (!planner.entries.has(entry.target)) await releaseEntry(planner, entry);
  }
  return planner;
}

export async function planInstall(options: InstallOptions): Promise<InstallPlan> {
  const planner = await buildPlanner(options);
  return planner.result();
}
