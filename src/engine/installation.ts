import { createHash } from "node:crypto";
import type { Action, HarnessId, ResolvedConfig } from "../core/types.js";
import { InstallError } from "../install/index.js";
import type { InstallOptions, InstallPlan, Manifest } from "../install/index.js";
import { installLines } from "./install-output.js";
import type { InstallationResult, LifecycleOptions } from "./lifecycle-types.js";

export function installOptions(input: {
  readonly config: ResolvedConfig;
  readonly harness: HarnessId;
  readonly actions: readonly Action[];
  readonly engineVersion: string;
  readonly options: LifecycleOptions;
}): InstallOptions {
  const harness = input.config.harnesses[input.harness];
  if (!harness)
    throw new InstallError("engine.harness", `Harness ${input.harness} is not configured.`);
  return {
    repo: {
      path: input.config.paths.repo,
      configHash: `sha256:${createHash("sha256").update(JSON.stringify(input.config)).digest("hex")}`,
    },
    harness: input.harness,
    harnessHome: harness.path,
    home: input.config.paths.home,
    actions: input.actions,
    backupRoot: input.config.paths.backup,
    engineVersion: input.engineVersion,
    ...(input.options.force === undefined ? {} : { force: input.options.force }),
    ...(input.options.takeover === undefined ? {} : { takeover: input.options.takeover }),
  };
}

export function installationResult(input: {
  readonly options: InstallOptions;
  readonly plan: InstallPlan;
  readonly manifest: Manifest | undefined;
}): InstallationResult {
  return {
    harness: input.options.harness,
    home: input.options.harnessHome,
    installed: input.manifest !== undefined && input.manifest.entries.length > 0,
    ...(input.manifest ? { owner: input.manifest.repo } : {}),
    managedPaths: input.manifest?.entries.map((entry) => entry.target) ?? [],
    actions: installLines(input.plan, input.options.actions),
    userEdits: input.plan.findings.flatMap((finding) =>
      finding.code === "install.user-edit" && finding.file ? [finding.file] : [],
    ),
  };
}
