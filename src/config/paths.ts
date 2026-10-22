import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Diagnostic, Environment, ResolvedPaths } from "../core/types.js";
import type { ConfigInput } from "./input.js";
import { DEFAULT_SOURCE_PATHS, type ResolvedSourcePaths, type SourcePathName } from "./sources.js";
import { expandVariables, pointerSegment } from "./variables.js";

export function resolvePaths(repoDir: string, env: Environment, input: ConfigInput) {
  const repo = resolve(repoDir);
  const home = resolve(env["HOME"] || homedir());
  const hash = createHash("sha256").update(repo).digest("hex");
  const defaults: Record<string, string> = {
    docs: "~/docs",
    backup: "~/.Trash/skillerie",
    cache: `${env["XDG_CACHE_HOME"] || "~/.cache"}/skillerie/${hash}`,
    ...input.paths,
  };
  if (env["SKILLERIE_BACKUP_DIR"]) defaults["backup"] = env["SKILLERIE_BACKUP_DIR"];
  if (input.generated?.commit) defaults["cache"] = resolve(repo, "generated");
  const resolved: Record<string, string> = { repo, home };
  const visiting = new Set<string>();
  const diagnostics: Diagnostic[] = [];

  const resolveName = (name: string): string | undefined => {
    if (Object.hasOwn(resolved, name)) return resolved[name];
    const value = Object.hasOwn(defaults, name) ? defaults[name] : undefined;
    if (value === undefined) return undefined;
    const jsonPath = `/paths/${pointerSegment(name)}`;
    if (visiting.has(name)) {
      diagnostics.push({
        severity: "error",
        code: "config.pathCycle",
        message: `Cyclic path variable: \${paths.${name}}.`,
        jsonPath,
      });
      return undefined;
    }
    visiting.add(name);
    const dependencies: Record<string, string> = { ...resolved };
    for (const match of value.matchAll(/\$\$\{[^}]*\}|\$\{paths\.([^}]+)\}/g)) {
      const dependency = match[1];
      if (dependency !== undefined) {
        const result = resolveName(dependency);
        if (result !== undefined) dependencies[dependency] = result;
      }
    }
    const expanded = expandVariables(value, {
      repo,
      home,
      paths: dependencies,
    });
    diagnostics.push(...expanded.diagnostics.map((item) => ({ ...item, jsonPath })));
    const absolute = resolve(repo, expanded.value);
    resolved[name] = absolute;
    visiting.delete(name);
    return absolute;
  };

  for (const name of Object.keys(defaults)) resolveName(name);
  const paths: ResolvedPaths = {
    ...resolved,
    repo,
    home,
    docs: resolved["docs"] ?? resolve(home, "docs"),
    backup: resolved["backup"] ?? resolve(home, ".Trash/skillerie"),
    cache: resolved["cache"] ?? resolve(repo, "generated"),
  };
  const resolveSource = (name: SourcePathName): string => {
    const authored = input.sources?.[name];
    const jsonPath = `/sources/${name}`;
    if (authored !== undefined && isAbsolute(authored)) {
      diagnostics.push({
        severity: "error",
        code: "config.sourcePath",
        message: "Source paths must be relative to the repository root.",
        jsonPath,
      });
      return resolve(repo, DEFAULT_SOURCE_PATHS[name]);
    }
    const expanded = expandVariables(authored ?? DEFAULT_SOURCE_PATHS[name], {
      repo,
      home,
      paths: resolved,
    });
    diagnostics.push(...expanded.diagnostics.map((item) => ({ ...item, jsonPath })));
    const source = isAbsolute(expanded.value)
      ? resolve(expanded.value)
      : resolve(repo, expanded.value);
    const relativeSource = relative(repo, source);
    if (
      relativeSource === ".." ||
      relativeSource.startsWith(`..${sep}`) ||
      isAbsolute(relativeSource)
    ) {
      diagnostics.push({
        severity: "error",
        code: "config.sourcePath",
        message: "Source paths cannot escape the repository root.",
        jsonPath,
      });
      return resolve(repo, DEFAULT_SOURCE_PATHS[name]);
    }
    return source;
  };
  const sources: ResolvedSourcePaths = {
    skills: resolveSource("skills"),
    agents: resolveSource("agents"),
    rules: resolveSource("rules"),
    instructions: resolveSource("instructions"),
    mcp: resolveSource("mcp"),
    bin: resolveSource("bin"),
    harnesses: resolveSource("harnesses"),
  };
  return { paths, sources, diagnostics };
}
