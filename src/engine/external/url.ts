import { posix } from "node:path";
import type { ExternalSkillInput } from "../../core/types.js";

export class ExternalError extends Error {
  override readonly name = "ExternalError";

  constructor(
    message: string,
    readonly field: "url" | "ref" | "path" = "url",
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface ExternalUrl {
  readonly cloneUrl: string;
  readonly cacheKey: string;
  readonly ref?: string;
  readonly path: string;
}

export function parseExternalUrl(input: ExternalSkillInput): ExternalUrl {
  let cloneUrl = input.url;
  let host: string;
  let repository: string;
  let embeddedRef: string | undefined;
  let embeddedPath = "";
  const scp = /^git@([^/:]+):(.+)$/.exec(input.url);
  if (scp?.[1] && scp[2]) {
    host = scp[1];
    repository = scp[2];
  } else {
    let url: URL;
    try {
      url = new URL(input.url);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      throw new ExternalError("Expected an https, ssh, or file:// git repository URL.");
    }
    if (!["https:", "ssh:", "file:"].includes(url.protocol) || url.search || url.hash)
      throw new ExternalError("Expected an https, ssh, or file:// git repository URL.");
    host = url.host || "local";
    try {
      repository = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, "");
    } catch (error) {
      if (!(error instanceof URIError)) throw error;
      throw new ExternalError("Repository URL contains invalid percent encoding.");
    }
    if (url.hostname === "github.com" && url.protocol === "https:") {
      const [owner, repo, kind, ref, ...path] = repository.split("/");
      if (!owner || !repo || (kind !== undefined && (kind !== "tree" || !ref)))
        throw new ExternalError("Expected a GitHub repository or /tree/<ref>/<path> URL.");
      cloneUrl = `https://github.com/${owner}/${repo.replace(/\.git$/, "")}.git`;
      repository = `${owner}/${repo}`;
      embeddedRef = ref;
      embeddedPath = path.join("/");
    }
  }
  const path = input.path ?? embeddedPath;
  if (
    posix.isAbsolute(path) ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").includes("..")
  )
    throw new ExternalError("Skill path must stay inside the external repository.", "path");
  const ref = input.ref ?? embeddedRef;
  if (ref !== undefined && (!ref || ref.startsWith("-") || /[\0\r\n]/.test(ref)))
    throw new ExternalError("Expected a tag, branch, or full 40-character commit SHA.", "ref");
  const cacheKey = [host, ...repository.replace(/\.git$/, "").split("/")]
    .filter(Boolean)
    .map((part) => part.replace(/[^a-zA-Z0-9_-]/g, "_") || "_")
    .join("/");
  if (!repository) throw new ExternalError("Repository URL must include a repository path.");
  return {
    cloneUrl,
    cacheKey,
    path: posix.normalize(path || ".").replace(/^\.$/, ""),
    ...(ref === undefined ? {} : { ref }),
  };
}
