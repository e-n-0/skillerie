import { execFile } from "node:child_process";
import type { Environment } from "../../core/types.js";
import { ExternalError, type ExternalUrl } from "./url.js";

export const FULL_SHA = /^[a-f0-9]{40}$/i;

export interface RemoteTag {
  readonly name: string;
  readonly sha: string;
}

export interface RemoteRevision {
  readonly sha: string;
  readonly kind: "tag" | "branch" | "sha" | "default";
}

export function git(
  args: readonly string[],
  options: { readonly env: Environment; readonly cwd?: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...args],
      {
        ...options,
        env: { ...process.env, ...options.env },
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new ExternalError(
              `git ${args[0] ?? ""} failed: ${stderr.trim() || error.message}`,
              "url",
              { cause: error },
            ),
          );
        } else resolve(stdout);
      },
    );
  });
}

export async function listRemoteTags(
  url: ExternalUrl,
  env: Environment,
): Promise<readonly RemoteTag[]> {
  const output = await git(["ls-remote", "--tags", "--", url.cloneUrl], { env });
  const tags = new Map<string, string>();
  for (const line of output.trim().split("\n")) {
    const [sha, reference] = line.split(/\s+/);
    if (!sha || !FULL_SHA.test(sha) || !reference?.startsWith("refs/tags/")) continue;
    const name = reference.slice("refs/tags/".length).replace(/\^\{\}$/, "");
    if (reference.endsWith("^{}") || !tags.has(name)) tags.set(name, sha);
  }
  return [...tags].map(([name, sha]) => ({ name, sha }));
}

export async function queryRemote(url: ExternalUrl, env: Environment): Promise<RemoteRevision> {
  if (url.ref !== undefined && FULL_SHA.test(url.ref))
    return { sha: url.ref.toLowerCase(), kind: "sha" };
  if (url.ref === undefined) {
    const output = await git(["ls-remote", "--symref", "--", url.cloneUrl, "HEAD"], { env });
    const sha = output
      .split("\n")
      .map((line) => line.split(/\s+/))
      .find((line) => line[1] === "HEAD")?.[0];
    if (sha && FULL_SHA.test(sha)) return { sha, kind: "default" };
    throw new ExternalError("Remote default branch did not resolve to a commit.", "ref");
  }
  const ref = url.ref;
  const tagName = ref.replace(/^refs\/tags\//, "");
  const tag = (await listRemoteTags(url, env)).find((entry) => entry.name === tagName);
  if (tag) return { sha: tag.sha, kind: "tag" };
  const branch = ref.startsWith("refs/heads/") ? ref : `refs/heads/${ref}`;
  const output = await git(["ls-remote", "--heads", "--", url.cloneUrl, branch], { env });
  const sha = output
    .split("\n")
    .map((line) => line.split(/\s+/))
    .find((line) => line[1] === branch)?.[0];
  if (sha && FULL_SHA.test(sha)) return { sha, kind: "branch" };
  throw new ExternalError(
    /^[a-f0-9]{4,39}$/i.test(ref)
      ? "Short commit SHAs are not supported; use a tag, branch, or full 40-character SHA."
      : `Cannot resolve ref "${ref}"; use a tag, branch, or full 40-character SHA.`,
    "ref",
  );
}
