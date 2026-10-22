import { rmdir } from "node:fs/promises";
import { absent, fileImage, fingerprint, hasCode, text } from "./images.js";
import { restoreMerge } from "./merges.js";
import type { Planner } from "./planner.js";
import { statePath } from "./storage.js";
import { assertNever } from "./types.js";
import type { ManagedEntry, PlannedAction } from "./types.js";

export async function releaseEntry(planner: Planner, entry: ManagedEntry): Promise<void> {
  for (const parent of planner.previous.values()) {
    if (
      parent.kind === "directory" &&
      entry.target.startsWith(parent.target + "/") &&
      planner.edited(parent, await planner.read(parent.target))
    ) {
      if (planner.skip(parent, await planner.read(parent.target))) {
        planner.entries.set(entry.target, entry);
      }
      return;
    }
  }
  const current = await planner.read(entry.target);
  if (planner.skip(entry, current)) return;
  switch (entry.kind) {
    case "directory":
      // Real directories are emptied entry by entry, never recursively removed.
      if (
        (current.kind !== "directory" && current.kind !== "absent") ||
        (entry.preimage.kind !== "directory" && entry.preimage.kind !== "absent")
      ) {
        await planner.set(entry.target, entry.preimage);
      }
      return;
    case "owned":
      await planner.set(entry.target, entry.preimage);
      return;
    case "merge": {
      if (current.kind === "absent") return;
      if (planner.options.force && planner.edited(entry, current)) {
        await planner.set(entry.target, entry.preimage);
        return;
      }
      let restored = text(current);
      for (const merge of [...entry.merges].reverse()) restored = restoreMerge(restored, merge);
      const original = entry.preimage;
      const desired =
        original.kind === "absent" && !restored.trim()
          ? absent
          : fileImage(restored, current.kind === "file" ? current.mode : 0o644);
      await planner.set(entry.target, desired);
      return;
    }
    default:
      assertNever(entry.kind);
  }
}

export function manifestStep(
  planner: Planner,
  before: Awaited<ReturnType<Planner["read"]>>,
  removeEmpty = false,
): PlannedAction | undefined {
  const manifest = planner.result().manifest;
  const after =
    removeEmpty && !manifest.entries.length
      ? absent
      : fileImage(JSON.stringify(manifest, null, 2) + "\n", 0o600);
  if (fingerprint(before) === fingerprint(after)) return undefined;
  return {
    kind: after.kind === "absent" ? "remove" : "write",
    target: statePath(planner.options.harnessHome, "manifest.json"),
    before,
    after,
  };
}

export async function cleanDirectories(directories: readonly string[]): Promise<void> {
  for (const directory of [...new Set(directories)].sort((a, b) => b.length - a.length)) {
    try {
      await rmdir(directory);
    } catch (error) {
      if (!hasCode(error, "ENOENT") && !hasCode(error, "ENOTEMPTY") && !hasCode(error, "EEXIST"))
        throw error;
    }
  }
}
