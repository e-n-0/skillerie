import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";
import type { Action, ExternalRevision, HarnessId, ResolvedConfig } from "../core/types.js";
import type { TreeDifference } from "../fs/index.js";
import { InstallError } from "../install/index.js";
import type { InstallOptions, InstallPlan, Manifest } from "../install/index.js";
import { installLines } from "./install-output.js";
import type { InstallationResult, InstallLine, LifecycleOptions } from "./lifecycle-types.js";

export function installOptions(input: {
  readonly external?: readonly ExternalRevision[];
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
    ...(input.external?.length ? { external: input.external } : {}),
    ...(input.config.profile === undefined ? {} : { profile: input.config.profile }),
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

/**
 * Home paths whose content changes only because the generation behind an existing link changed.
 * The plan has no action for them, so they are reported separately; paths a planned action already
 * covers are left out.
 */
function linkedUpdates(input: {
  readonly actions: readonly Action[];
  readonly lines: readonly InstallLine[];
  readonly drift: readonly TreeDifference[];
  readonly root: string;
}): readonly string[] {
  const updates = new Set<string>();
  for (const difference of input.drift) {
    const path = join(input.root, ...difference.relPath.split("/"));
    for (const action of input.actions) {
      if (action.kind !== "link" && action.kind !== "exclusiveTree") continue;
      if (path !== action.source && !path.startsWith(action.source + sep)) continue;
      const target = join(action.target, relative(action.source, path));
      const planned = input.lines.some(
        (line) =>
          line.kind !== "SKIP" && (line.target === target || target.startsWith(line.target + sep)),
      );
      if (!planned) updates.add(target);
    }
  }
  return [...updates].sort();
}

export function installationResult(input: {
  readonly options: InstallOptions;
  readonly plan: InstallPlan;
  readonly manifest: Manifest | undefined;
  /** Differences between the active generation and what this run publishes. */
  readonly drift?: readonly TreeDifference[];
  readonly root?: string;
}): InstallationResult {
  const lines = installLines(input.plan, input.options.actions);
  return {
    harness: input.options.harness,
    home: input.options.harnessHome,
    installed: input.manifest !== undefined && input.manifest.entries.length > 0,
    ...(input.manifest ? { owner: input.manifest.repo } : {}),
    managedPaths: input.manifest?.entries.map((entry) => entry.target) ?? [],
    actions: lines,
    updates:
      input.drift && input.root !== undefined
        ? linkedUpdates({
            actions: input.options.actions,
            lines,
            drift: input.drift,
            root: input.root,
          })
        : [],
    userEdits: input.plan.findings.flatMap((finding) =>
      finding.code === "install.user-edit" && finding.file ? [finding.file] : [],
    ),
  };
}
