import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  Diagnostic,
  Environment,
  ResolvedConfig,
  ResolvedExternalSkill,
} from "../../core/types.js";
import { FULL_SHA, git, queryRemote } from "./git.js";
import { ExternalError, parseExternalUrl } from "./url.js";

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function cached(directory: string): Promise<boolean> {
  try {
    const info = await lstat(directory);
    return info.isDirectory() && !info.isSymbolicLink();
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

async function indexedSha(file: string): Promise<string | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    if (
      typeof value === "object" &&
      value !== null &&
      "sha" in value &&
      typeof value.sha === "string" &&
      FULL_SHA.test(value.sha)
    )
      return value.sha;
    throw new ExternalError("Invalid external cache index.");
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    if (error instanceof SyntaxError)
      throw new ExternalError("Invalid external cache index.", "url", { cause: error });
    throw error;
  }
}

/** Publish one commit under <root>/<sha>, reusing an existing checkout. */
export async function checkout(input: {
  readonly root: string;
  readonly url: string;
  readonly sha: string;
  readonly env: Environment;
}): Promise<void> {
  const directory = join(input.root, input.sha);
  if (await cached(directory)) return;
  await mkdir(input.root, { recursive: true });
  const temporary = await mkdtemp(join(input.root, ".fetch-"));
  try {
    const options = { cwd: temporary, env: input.env };
    await git(["init", "--quiet"], options);
    await git(["fetch", "--quiet", "--depth", "1", "--", input.url, input.sha], options);
    await git(
      ["-c", "advice.detachedHead=false", "checkout", "--quiet", "--detach", "FETCH_HEAD"],
      options,
    );
    await rm(join(temporary, ".git"), { recursive: true });
    try {
      await rename(temporary, directory);
    } catch (error) {
      if (!hasCode(error, "EEXIST") && !hasCode(error, "ENOTEMPTY")) throw error;
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Only the engine fetches and publishes checkouts; discovery receives immutable paths. */
export async function resolveExternalSkills(
  config: ResolvedConfig,
  env: Environment,
  options: { readonly offline?: boolean } = {},
): Promise<{
  readonly entries: readonly ResolvedExternalSkill[];
  readonly diagnostics: readonly Diagnostic[];
}> {
  const entries: ResolvedExternalSkill[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const [index, input] of (config.skills.external ?? []).entries()) {
    const location = {
      file: join(config.paths.repo, "skillerie.yaml"),
      jsonPath: `/skills/external/${index}`,
    };
    try {
      const parsed = parseExternalUrl(input);
      const root = join(config.paths.cache, "external", parsed.cacheKey);
      const key = createHash("sha256")
        .update(
          JSON.stringify({
            url: input.url,
            ref: parsed.ref,
            path: parsed.path,
            include: input.include,
          }),
        )
        .digest("hex");
      const indexFile = join(root, `index-${key}.json`);
      const pin = parsed.ref && FULL_SHA.test(parsed.ref) ? parsed.ref.toLowerCase() : undefined;
      let sha: string;
      if (pin && (await cached(join(root, pin)))) {
        sha = pin;
      } else {
        try {
          if (options.offline)
            throw new ExternalError("Offline inspection uses cached external skills.");
          sha = (await queryRemote(parsed, env)).sha;
          await checkout({ root, url: parsed.cloneUrl, sha, env });
        } catch (error) {
          if (!(error instanceof ExternalError)) throw error;
          const previous = pin ?? (await indexedSha(indexFile));
          if (!previous || !(await cached(join(root, previous)))) {
            if (!options.offline) throw error;
            diagnostics.push({
              severity: "warn",
              code: "external.offline",
              message: `${input.url}: External content is not cached; run install to fetch it.`,
              ...location,
            });
            continue;
          }
          sha = previous;
          if (!options.offline)
            diagnostics.push({
              severity: "warn",
              code: "external.fallback",
              message: `${input.url}: ${error.message} Using cached ${sha.slice(0, 8)}.`,
              ...location,
            });
        }
      }
      if (!options.offline) {
        const temporary = join(root, `.index-${randomUUID()}`);
        try {
          await writeFile(temporary, JSON.stringify({ sha }) + "\n", { flag: "wx" });
          await rename(temporary, indexFile);
        } finally {
          await rm(temporary, { force: true });
        }
      }
      entries.push({
        index,
        directory: join(root, sha),
        revision: {
          url: input.url,
          sha,
          path: parsed.path,
          ...(parsed.ref === undefined ? {} : { ref: parsed.ref }),
        },
        ...(input.include === undefined ? {} : { include: input.include }),
      });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      diagnostics.push({
        severity: "error",
        code: "external.resolve",
        message: `${input.url}: ${error.message}`,
        ...location,
        jsonPath: `${location.jsonPath}/${error instanceof ExternalError ? error.field : "url"}`,
      });
    }
  }
  return { entries, diagnostics };
}
