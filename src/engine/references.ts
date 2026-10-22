import type { Diagnostic, ResolvedConfig, SourceModel } from "../core/types.js";
import { HARNESS_IDS } from "./types.js";

/** Extend semantic references to global instructions and effective rule bodies. */
export function lintInstructionReferences(
  model: SourceModel,
  config: ResolvedConfig,
): readonly Diagnostic[] {
  const severity = config.lint.references.severity;
  if (severity === "off") return [];
  const diagnostics: Diagnostic[] = [];
  const known = new Set(model.skills.map((skill) => skill.name));
  for (const harness of HARNESS_IDS) {
    const sources = model.harnesses[harness];
    if (!config.harnesses[harness]?.enabled || !sources) continue;
    const available = new Set(sources.skills.map((skill) => skill.name));
    for (const source of [...sources.rules, ...(model.instructions ? [model.instructions] : [])]) {
      for (const match of source.body.matchAll(/`\/([a-z][a-z0-9-]*)`/g)) {
        const name = match[1];
        if (name === undefined || available.has(name)) continue;
        diagnostics.push({
          severity,
          code: known.has(name) ? "lint.reference.not-applicable" : "lint.reference.missing",
          message: `Skill "${name}" is not available for harness "${harness}".`,
          file: source.file,
          jsonPath: "/body",
        });
      }
    }
  }
  return diagnostics;
}
