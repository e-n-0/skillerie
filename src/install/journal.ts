import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  absent,
  atomicJson,
  fingerprint,
  image,
  putImage,
  safeAncestors,
  text,
  within,
} from "./images.js";
import { readJournal, statePath } from "./storage.js";
import { InstallError } from "./types.js";
import type { InstallOptions, Journal, PlannedAction } from "./types.js";
import { assertMergeOwnership } from "./conflicts.js";

async function replay(options: InstallOptions, journal: Journal): Promise<void> {
  const journalPath = statePath(options.harnessHome, "journal.json");
  for (let index = journal.next; index < journal.steps.length; index += 1) {
    const step = journal.steps[index];
    if (!step) throw new InstallError("journal.step", "Missing journal step.");
    await atomicJson(journalPath, { ...journal, next: index });
    await safeAncestors(step.target, options.home ?? options.harnessHome);
    const current = await image(step.target);
    if (fingerprint(current) !== fingerprint(step.after)) {
      if (current.kind !== "absent") {
        const backup = await image(step.backup);
        if (backup.kind !== "absent") {
          throw new InstallError(
            "journal.conflict",
            `Recovery found a new change at ${step.target}; its backup remains at ${step.backup}`,
          );
        }
        await safeAncestors(step.backup, options.home ?? options.harnessHome);
        await mkdir(dirname(step.backup), { recursive: true });
        await rename(step.target, step.backup);
      }
      await putImage(step.target, step.after);
    }
    await options.testHook?.(index + 1);
  }
  await rm(journalPath);
}

export async function recover(options: InstallOptions): Promise<void> {
  const journal = await readJournal(options.harnessHome);
  if (journal) {
    // A recovery belongs to the recorded transaction, not the new caller's test hook.
    const { testHook: _hook, ...recoveryOptions } = options;
    await replay(recoveryOptions, journal);
  }
}

export async function transact(
  options: InstallOptions,
  actions: readonly PlannedAction[],
): Promise<void> {
  if (!actions.length) return;
  for (const action of actions)
    if (
      action.kind === "write" &&
      (action.before.kind === "file" || action.before.kind === "absent")
    )
      assertMergeOwnership(options, action.target, text(action.before));
  const batch = join(
    options.backupRoot,
    `${new Date().toISOString().replace(/[:.]/gu, "-")}-${randomUUID()}`,
  );
  const home = options.home ?? options.harnessHome;
  const steps = actions.map((action, index) => {
    const layout = within(home, action.target)
      ? relative(home, action.target)
      : action.target.slice(1);
    // Replay reads the live preimage and moves it to backup; it never uses step.before.
    return { ...action, before: absent, backup: join(`${batch}-${index}`, layout) };
  });
  const journal: Journal = { version: 1, next: 0, steps };
  await atomicJson(statePath(options.harnessHome, "journal.json"), journal);
  await replay(options, journal);
}
