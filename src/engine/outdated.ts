import { join } from "node:path";
import { loadConfig } from "../config/index.js";
import type { Diagnostic, ExternalRevision } from "../core/types.js";
import { ENGINE_VERSION } from "../version.js";
import { checkEngineVersion, compareSemverTags } from "./compatibility.js";
import { listRemoteTags, queryRemote } from "./external/git.js";
import { installedExternals } from "./external/state.js";
import { ExternalError, parseExternalUrl, type ExternalUrl } from "./external/url.js";
import { hasErrors, type EngineOptions } from "./types.js";

export interface OutdatedEntry extends ExternalRevision {
  readonly kind: "tag" | "branch" | "sha" | "default";
  readonly latestSha: string;
  readonly newerTags: readonly string[];
  readonly outdated: boolean;
  readonly status: "current" | "behind";
  readonly message: string;
}

export interface OutdatedResult {
  readonly entries: readonly OutdatedEntry[];
  readonly diagnostics: readonly Diagnostic[];
  readonly exitCode: 0 | 1 | 2;
}

/** Query remotes without refreshing the installed generation or cache index. */
export async function outdatedRepo(
  repoDir: string,
  options: EngineOptions = {},
): Promise<OutdatedResult> {
  const env = { ...(options.env ?? process.env) };
  const loaded = await loadConfig(repoDir, env, {
    ...(options.profile === undefined ? {} : { profile: options.profile }),
  });
  const config = loaded.config;
  const diagnostics = [...loaded.diagnostics];
  const entries: OutdatedEntry[] = [];
  if (!config || hasErrors(diagnostics)) return { entries, diagnostics, exitCode: 2 };
  diagnostics.push(
    ...checkEngineVersion(
      config.engine,
      options.engineVersion ?? ENGINE_VERSION,
      join(repoDir, "skillerie.yaml"),
    ),
  );
  if (hasErrors(diagnostics)) return { entries, diagnostics, exitCode: 2 };
  let installed: readonly ExternalRevision[];
  try {
    installed = await installedExternals(config);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    diagnostics.push({
      severity: "error",
      code: "external.state",
      message: error.message,
      file: join(config.paths.cache, "current"),
      jsonPath: "",
    });
    return { entries, diagnostics, exitCode: 2 };
  }
  for (const [index, input] of (config.skills.external ?? []).entries()) {
    try {
      const url = parseExternalUrl(input);
      const remote = await queryRemote(url, env);
      const prior = installed.find(
        (entry) => entry.url === input.url && entry.ref === url.ref && entry.path === url.path,
      );
      const sha = prior?.sha ?? remote.sha;
      let latestSha = remote.sha;
      let newerTags: readonly string[] = [];
      let message: string;
      switch (remote.kind) {
        case "tag": {
          const tags = await listRemoteTags(url, env);
          newerTags = tags
            .map((tag) => tag.name)
            .filter(
              (name) =>
                (compareSemverTags(name, url.ref?.replace(/^refs\/tags\//, "") ?? "") ?? 0) > 0,
            )
            .sort((a, b) => compareSemverTags(a, b) ?? 0);
          const latest = newerTags.at(-1);
          latestSha = tags.find((tag) => tag.name === latest)?.sha ?? remote.sha;
          message = latest ? `${url.ref ?? ""} -> ${latest} available` : "up to date";
          break;
        }
        case "sha": {
          const defaultUrl: ExternalUrl = {
            cloneUrl: url.cloneUrl,
            cacheKey: url.cacheKey,
            path: url.path,
          };
          latestSha = (await queryRemote(defaultUrl, env)).sha;
          message =
            sha === latestSha
              ? "up to date"
              : `default branch head ${latestSha.slice(0, 8)} differs from pinned ${sha.slice(0, 8)}`;
          break;
        }
        case "branch":
        case "default":
          message =
            sha === latestSha
              ? "up to date"
              : `upstream moved ${sha.slice(0, 8)}..${latestSha.slice(0, 8)}; run install`;
          break;
        default:
          assertNever(remote.kind);
      }
      const outdated = newerTags.length > 0 || sha !== latestSha;
      entries.push({
        url: input.url,
        ...(url.ref === undefined ? {} : { ref: url.ref }),
        path: url.path,
        sha,
        latestSha,
        kind: remote.kind,
        newerTags,
        outdated,
        status: outdated ? "behind" : "current",
        message,
      });
    } catch (error) {
      if (!(error instanceof ExternalError)) throw error;
      diagnostics.push({
        severity: "error",
        code: "external.outdated",
        message: `${input.url}: ${error.message}`,
        file: join(config.paths.repo, "skillerie.yaml"),
        jsonPath: `/skills/external/${index}/${error.field}`,
      });
    }
  }
  return {
    entries,
    diagnostics,
    exitCode: hasErrors(diagnostics) ? 2 : entries.some((entry) => entry.outdated) ? 1 : 0,
  };
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected external ref kind: ${String(value)}`);
}
