import { resolve } from "node:path";
import type { ResolvedConfig } from "../core/types.js";

export const DEFAULT_SOURCE_PATHS = {
  skills: "skills",
  agents: "agents",
  rules: "rules",
  instructions: "instructions.md",
  mcp: "mcp.json",
  bin: "bin",
  harnesses: "harnesses",
} as const;

export type SourcePathName = keyof typeof DEFAULT_SOURCE_PATHS;
export type SourcePathInput = Partial<Record<SourcePathName, string>>;
export type ResolvedSourcePaths = { readonly [Name in SourcePathName]: string };
export type LoadedConfig = ResolvedConfig & { readonly sources: ResolvedSourcePaths };

export function defaultSourcePaths(repoDir: string): ResolvedSourcePaths {
  const root = resolve(repoDir);
  return {
    skills: resolve(root, DEFAULT_SOURCE_PATHS.skills),
    agents: resolve(root, DEFAULT_SOURCE_PATHS.agents),
    rules: resolve(root, DEFAULT_SOURCE_PATHS.rules),
    instructions: resolve(root, DEFAULT_SOURCE_PATHS.instructions),
    mcp: resolve(root, DEFAULT_SOURCE_PATHS.mcp),
    bin: resolve(root, DEFAULT_SOURCE_PATHS.bin),
    harnesses: resolve(root, DEFAULT_SOURCE_PATHS.harnesses),
  };
}
