import { isAbsolute } from "node:path";
import type { Diagnostic, ResolvedExternalSkill, SourceModel } from "../core/types.js";
import { relativePath, within } from "../model/files.js";
import { externalRepositoryUrl } from "../model/external.js";

type DiagnosticSource = Pick<ResolvedExternalSkill, "directory" | "revision">;

export function skillDiagnosticSources(model: SourceModel): readonly DiagnosticSource[] {
  return model.skills.flatMap((skill) =>
    skill.external ? [{ directory: skill.dir, revision: skill.external }] : [],
  );
}

/** Present source origins only at diagnostic egress; filesystem paths stay internal. */
export function externalDiagnostics(
  diagnostics: readonly Diagnostic[],
  sources: readonly DiagnosticSource[],
): readonly Diagnostic[] {
  const ordered = sources.toSorted((left, right) => right.directory.length - left.directory.length);
  return diagnostics.map((diagnostic) => {
    const file = diagnostic.file;
    if (!file || !isAbsolute(file)) return diagnostic;
    const source = ordered.find((entry) => within(entry.directory, file));
    if (!source) return diagnostic;
    const path = [source.revision.path, relativePath(source.directory, file)]
      .filter(Boolean)
      .join("/");
    return {
      ...diagnostic,
      file: `${externalRepositoryUrl(source.revision.url)}@${source.revision.sha.slice(0, 7)}${path ? `/${path}` : ""}`,
    };
  });
}
