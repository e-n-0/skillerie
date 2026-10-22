import { sep } from "node:path";
import type { Action } from "../core/types.js";
import type { InstallPlan } from "../install/index.js";
import { assertNever } from "../install/types.js";
import type { InstallLine } from "./lifecycle-types.js";

export function installLines(
  plan: InstallPlan,
  actions: readonly Action[],
): readonly InstallLine[] {
  const lines: InstallLine[] = [];
  for (const change of plan.actions) {
    if (change.kind === "mkdir") continue;
    const action = actions.find(
      (action) =>
        action.target === change.target ||
        (action.kind === "exclusiveTree" && change.target.startsWith(action.target + sep)),
    );
    if (change.before.kind !== "absent") lines.push({ kind: "BACKUP", target: change.target });
    let kind: InstallLine["kind"];
    switch (change.after.kind) {
      case "absent":
        continue;
      case "link":
        kind = change.before.kind === "link" ? "RELINK" : "LINK";
        break;
      case "file":
        kind = action?.kind === "seed" ? "SEED" : "MERGE";
        break;
      case "directory":
        kind = action?.kind === "seed" ? "SEED" : "SKIP";
        break;
      default:
        assertNever(change.after);
    }
    lines.push({ kind, target: change.target });
  }
  for (const finding of plan.findings) {
    if (finding.code === "install.user-edit" && finding.file)
      lines.push({ kind: "SKIP", target: finding.file });
  }
  return lines;
}
