import { image } from "./images.js";
import { locked } from "./lock.js";
import { recover, transact } from "./journal.js";
import { cleanDirectories, manifestStep, releaseEntry } from "./lifecycle.js";
import { buildPlanner, planInstall, prepare, validateOptions } from "./plan.js";
import { statePath } from "./storage.js";
import type { InstallOptions, InstallPlan } from "./types.js";

export { planInstall };
export { InstallError } from "./types.js";
export type {
  InstallOptions,
  InstallPlan,
  Manifest,
  ManagedEntry,
  PlannedAction,
  RepoIdentity,
} from "./types.js";

export async function install(options: InstallOptions): Promise<InstallPlan> {
  validateOptions(options);
  return locked(options.harnessHome, async (created) => {
    await recover(options);
    const planner = await buildPlanner(options);
    for (const directory of created) planner.directories.add(directory);
    const metadata = manifestStep(
      planner,
      await image(statePath(options.harnessHome, "manifest.json")),
    );
    await transact(options, [...planner.changes.values(), ...(metadata ? [metadata] : [])]);
    return planner.result();
  });
}

export async function uninstall(options: InstallOptions): Promise<InstallPlan> {
  validateOptions(options);
  let directories: readonly string[] = [];
  const result = await locked(options.harnessHome, async (created) => {
    await recover(options);
    const planner = await prepare(options);
    for (const directory of created) planner.directories.add(directory);
    for (const entry of [...planner.previous.values()].reverse())
      await releaseEntry(planner, entry, true);
    const metadata = manifestStep(
      planner,
      await image(statePath(options.harnessHome, "manifest.json")),
      true,
    );
    await transact(options, [...planner.changes.values(), ...(metadata ? [metadata] : [])]);
    if (!planner.entries.size)
      directories = [statePath(options.harnessHome, ""), ...planner.directories];
    return planner.result();
  });
  await cleanDirectories(directories);
  return result;
}

/** Status shares the pure planner, and adds drift diagnostics without taking a lock. */
export async function status(options: InstallOptions): Promise<InstallPlan> {
  const plan = await planInstall(options);
  return {
    ...plan,
    findings: [
      ...plan.findings,
      ...plan.actions.map((action) => ({
        severity: "info" as const,
        code: "install.drift",
        file: action.target,
        message: `Installation requires ${action.kind}.`,
      })),
    ],
  };
}
