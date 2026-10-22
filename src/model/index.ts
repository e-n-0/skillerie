import type { Diagnostic, ResolvedConfig, SourceModel } from "../core/types.js";
import { defaultSourcePaths, type ResolvedSourcePaths } from "../config/sources.js";
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { captureFiles } from "./files.js";
import { readLayer } from "./layer.js";
import { resolveEntities } from "./merge.js";

export { parseFrontmatter } from "./frontmatter.js";
export { evaluateRequires, type RequiresContext } from "./requires.js";
export { resolveMcpServers } from "./mcp.js";
export { buildSnapshot } from "./snapshot.js";

type DiscoveryConfig = ResolvedConfig & { readonly sources?: ResolvedSourcePaths };

/** Discovery failures omit model and report their source locations. */
export interface DiscoverSourcesResult {
  readonly model?: SourceModel;
  readonly diagnostics: readonly Diagnostic[];
}

/** Discover the user's sources and apply selection and overrides. */
export async function discoverSources(
  repoDir: string,
  config: DiscoveryConfig,
): Promise<DiscoverSourcesResult> {
  const diagnostics: Diagnostic[] = [];
  const root = resolve(repoDir);
  try {
    const stat = await lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      return {
        diagnostics: [
          {
            severity: "error",
            code: "source.root",
            message: "Repository root must be a regular directory.",
            file: root,
            line: 1,
          },
        ],
      };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return {
      diagnostics: [
        {
          severity: "error",
          code: "source.read",
          message: error.message,
          file: root,
          line: 1,
        },
      ],
    };
  }
  const user = await readLayer(
    {
      root,
      sourcePaths: config.sources ?? defaultSourcePaths(root),
    },
    diagnostics,
  );
  const model: SourceModel = {
    repoDir: root,
    ...resolveEntities(user, config),
    templates: user.templates,
    seeds: user.seeds,
    bin: user.bin,
    ...(user.instructions ? { instructions: user.instructions } : {}),
    ...(user.mcp ? { mcp: user.mcp } : {}),
  };
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) return { diagnostics };
  captureFiles(model, user.files);
  return { model, diagnostics };
}
