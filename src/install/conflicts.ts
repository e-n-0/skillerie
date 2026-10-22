import type { Action, Diagnostic } from "../core/types.js";
import { unmanaged } from "./merges.js";
import { atTomlTarget, tomlOwnership } from "./toml.js";
import type { InstallOptions } from "./types.js";
import { InstallError } from "./types.js";

export function mergeFindings(
  before: string,
  actions: readonly Action[],
  force = false,
): readonly Diagnostic[] {
  const blocks = actions.filter(
    (action): action is Extract<Action, { kind: "mergeBlock" }> =>
      action.kind === "mergeBlock" && action.format === "toml",
  );
  if (!blocks.length) return [];
  const findings: Diagnostic[] = [];
  let base = before;
  for (const block of blocks) base = unmanaged(base, block);
  for (const block of blocks) {
    for (const collision of atTomlTarget(block.target, () => tomlOwnership(base, block.content))
      .conflicts) {
      if (findings.some((finding) => finding.jsonPath === collision.jsonPath)) continue;
      findings.push({
        severity: force ? "warn" : "error",
        code: "merge.conflict",
        file: block.target,
        jsonPath: collision.jsonPath,
        message: `${collision.key} Use --force to back up this file and take ownership of the definition.`,
      });
    }
  }
  return findings;
}

/** All transaction callers share this gate, including rendered-source installations. */
export function assertMergeOwnership(
  options: InstallOptions,
  target: string,
  before: string,
): void {
  if (options.force) return;
  const findings = mergeFindings(
    before,
    options.actions.filter((action) => action.target === target),
  );
  if (findings.length)
    throw new InstallError(
      "merge.conflict",
      findings.map((finding) => `CONFLICT ${target} ${finding.message}`).join("\n"),
      target,
    );
}
