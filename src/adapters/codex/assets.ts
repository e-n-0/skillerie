import { join } from "node:path";
import type { ResolvedContext } from "../../core/types.js";
import { relativePath } from "../../model/files.js";

export interface AssetFile {
  readonly sourcePath: string;
  readonly relPath: string;
}

/** Snapshot paths let synchronous targets describe directory assets without I/O. */
export function assetFiles(ctx: ResolvedContext): readonly AssetFile[] {
  const result: AssetFile[] = [];
  for (const asset of ctx.model.harnesses.codex?.assets ?? []) {
    const prefix = relativePath(ctx.model.repoDir, asset.sourcePath);
    const files =
      asset.kind === "file"
        ? [{ sourcePath: asset.sourcePath, relPath: asset.relPath }]
        : Object.keys(ctx.snapshot.sourceHashes)
            .filter((key) => key.startsWith(`${prefix}/`))
            .sort()
            .map((key) => ({
              sourcePath: join(asset.sourcePath, key.slice(prefix.length + 1)),
              relPath: `${asset.relPath}/${key.slice(prefix.length + 1)}`,
            }));
    for (const file of files)
      result.push({
        ...file,
        relPath:
          file.relPath.endsWith(".rules") && !file.relPath.startsWith("rules/")
            ? `rules/${file.relPath}`
            : file.relPath,
      });
  }
  return result;
}
