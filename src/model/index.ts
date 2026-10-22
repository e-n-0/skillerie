import type {
  Diagnostic,
  HarnessMap,
  HarnessTemplates,
  ResolvedConfig,
  SourceModel,
} from "../core/types.js";
import { defaultSourcePaths, type ResolvedSourcePaths } from "../config/sources.js";
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { captureFiles } from "./files.js";
import { readLayer } from "./layer.js";
import { mergeMcp } from "./mcp.js";
import { replaceEntities, resolveEntities } from "./merge.js";
import { harnessIds } from "./schema.js";

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

/** Discover sources and apply whole-entity starter/user replacement and overrides. */
export async function discoverSources(
  repoDir: string,
  config: DiscoveryConfig,
  starterDir?: string,
): Promise<DiscoverSourcesResult> {
  const diagnostics: Diagnostic[] = [];
  const root = resolve(repoDir);
  const starterRoot = starterDir && config.starter.enabled ? resolve(starterDir) : undefined;
  for (const directory of [root, ...(starterRoot ? [starterRoot] : [])]) {
    try {
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        return {
          diagnostics: [
            {
              severity: "error",
              code: "source.root",
              message: "Repository root must be a regular directory.",
              file: directory,
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
            file: directory,
            line: 1,
          },
        ],
      };
    }
  }
  const starter = starterRoot
    ? await readLayer(
        {
          root: starterRoot,
          source: "starter",
          excluded: config.starter.exclude,
          sourcePaths: defaultSourcePaths(starterRoot),
        },
        diagnostics,
      )
    : undefined;
  const user = await readLayer(
    {
      root,
      source: "user",
      excluded: [],
      sourcePaths: config.sources ?? defaultSourcePaths(root),
    },
    diagnostics,
  );
  const templates: HarnessMap<HarnessTemplates> = Object.fromEntries(
    harnessIds.flatMap((harness) => {
      const files = new Map(
        [
          ...(starter?.templates[harness]?.files ?? []),
          ...(user.templates[harness]?.files ?? []),
        ].map((file) => [file.relPath, file]),
      );
      return files.size
        ? [
            [
              harness,
              {
                harness,
                files: [...files.values()].sort((a, b) =>
                  a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0,
                ),
              },
            ],
          ]
        : [];
    }),
  );
  const assets = [
    ...new Map(
      [...(starter?.assets ?? []), ...user.assets].map((asset) => [
        `${asset.harness}:${asset.name}`,
        asset,
      ]),
    ).values(),
  ];
  const seeds = [
    ...new Map(
      [...(starter?.seeds ?? []), ...user.seeds].map((seed) => [
        `${seed.harness}:${seed.relPath}`,
        seed,
      ]),
    ).values(),
  ];
  const bin = [
    ...new Map(
      [...(starter?.bin ?? []), ...user.bin].map((file) => [
        file.relPath,
        {
          relPath: file.relPath,
          sourcePath: file.sourcePath,
          mode: file.mode,
        },
      ]),
    ).values(),
  ];
  const instructions = user.instructions ?? starter?.instructions;
  const mcp = mergeMcp(starter?.mcp, user.mcp);
  const model: SourceModel = {
    repoDir: root,
    ...resolveEntities(
      {
        skills: replaceEntities(starter?.skills ?? [], user.skills),
        agents: replaceEntities(starter?.agents ?? [], user.agents),
        rules: replaceEntities(starter?.rules ?? [], user.rules),
        assets,
      },
      config,
    ),
    templates,
    seeds,
    bin,
    ...(instructions ? { instructions } : {}),
    ...(mcp ? { mcp } : {}),
  };
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) return { diagnostics };
  captureFiles(
    model,
    new Map([
      ...[...(starter?.files ?? [])].map(([path, file]) => [`starter/${path}`, file] as const),
      ...user.files,
    ]),
  );
  return { model, diagnostics };
}
