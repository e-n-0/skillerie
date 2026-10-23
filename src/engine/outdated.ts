import { join } from "node:path";
import { loadConfig } from "../config/index.js";
import type {
  Diagnostic,
  Environment,
  ExternalRevision,
  ExternalSkillInput,
} from "../core/types.js";
import { ENGINE_VERSION } from "../version.js";
import { checkEngineVersion, compareSemverTags } from "./compatibility.js";
import { checkout } from "./external/cache.js";
import { compareSkills, describeChanges, type SkillChange } from "./external/changes.js";
import { listRemoteTags, queryRemote } from "./external/git.js";
import { installedExternals } from "./external/state.js";
import { ExternalError, parseExternalUrl, type ExternalUrl } from "./external/url.js";
import { hasErrors, type EngineOptions } from "./types.js";

export interface OutdatedEntry extends ExternalRevision {
  /** Position of the entry in `skills.external`. */
  readonly index: number;
  readonly kind: "tag" | "branch" | "sha" | "default";
  readonly latestSha: string;
  readonly newerTags: readonly string[];
  readonly outdated: boolean;
  readonly status: "current" | "behind";
  /** Per-skill comparison, present when upstream moved and both commits could be fetched. */
  readonly skills?: readonly SkillChange[];
  readonly message: string;
}

export interface OutdatedResult {
  readonly entries: readonly OutdatedEntry[];
  readonly diagnostics: readonly Diagnostic[];
  readonly exitCode: 0 | 1 | 2;
}

/** Fetch both commits into the external cache and compare the entry's selected skills. */
async function skillChanges(input: {
  readonly url: ExternalUrl;
  readonly input: ExternalSkillInput;
  readonly sha: string;
  readonly latestSha: string;
  readonly env: Environment;
  readonly root: string;
}): Promise<readonly SkillChange[]> {
  const root = join(input.root, "external", input.url.cacheKey);
  for (const sha of [input.sha, input.latestSha])
    await checkout({ root, url: input.url.cloneUrl, sha, env: input.env });
  const label = input.url.path.split("/").at(-1) || input.url.cacheKey.split("/").at(-1) || "skill";
  return compareSkills({
    before: join(root, input.sha, input.url.path),
    after: join(root, input.latestSha, input.url.path),
    ...(input.input.include === undefined ? {} : { include: input.input.include }),
    label,
  });
}

/** Query remotes and compare selected skills without refreshing the installed generation or cache index. */
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
      let head: string | undefined;
      let action: string | undefined;
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
          if (latest) {
            head = `${url.ref ?? ""} -> ${latest} available`;
            action = "run skillerie update";
          }
          break;
        }
        case "sha": {
          const defaultUrl: ExternalUrl = {
            cloneUrl: url.cloneUrl,
            cacheKey: url.cacheKey,
            path: url.path,
          };
          latestSha = (await queryRemote(defaultUrl, env)).sha;
          if (sha !== latestSha) {
            head = `default branch head ${latestSha.slice(0, 8)} differs from pinned ${sha.slice(0, 8)}`;
            action = "run skillerie update";
          }
          break;
        }
        case "branch":
        case "default":
          if (sha !== latestSha) {
            head = `upstream moved ${sha.slice(0, 8)}..${latestSha.slice(0, 8)}`;
            action = "run install";
          }
          break;
        default:
          assertNever(remote.kind);
      }
      const skills =
        head === undefined
          ? undefined
          : sha === latestSha
            ? []
            : await skillChanges({
                url,
                input,
                sha,
                latestSha,
                env,
                root: config.paths.cache,
              }).catch((error: unknown) => {
                if (!(error instanceof ExternalError)) throw error;
                diagnostics.push({
                  severity: "warn",
                  code: "external.changes",
                  message: `${input.url}: ${error.message} Reporting the commit change only.`,
                  file: join(config.paths.repo, "skillerie.yaml"),
                  jsonPath: `/skills/external/${index}`,
                });
                return undefined;
              });
      const changed = describeChanges(skills ?? []);
      const outdated = head !== undefined && (skills === undefined || changed !== "");
      const message =
        head === undefined
          ? "up to date"
          : skills === undefined
            ? [head, action].filter(Boolean).join("; ")
            : outdated
              ? [head, `changed: ${changed}`, action].filter(Boolean).join("; ")
              : `${head}; no changes to ${skills.map((skill) => skill.name).join(", ") || "the selected skills"}`;
      entries.push({
        index,
        url: input.url,
        ...(url.ref === undefined ? {} : { ref: url.ref }),
        path: url.path,
        sha,
        latestSha,
        kind: remote.kind,
        newerTags,
        outdated,
        status: outdated ? "behind" : "current",
        ...(skills === undefined ? {} : { skills }),
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
