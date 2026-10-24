import type { JsonObject, JsonValue, McpServer } from "../core/types.js";

/** Env, header and flag names that carry credentials. Broad on purpose: a false positive is only reported. */
const SECRET_KEY =
  /token|secret|passw(or)?d|api[-_]?key|apikey|auth|credential|private[-_]?key|cookie|session/i;
/** Settings keys are words like apiKey or client_secret; words such as "keyring" or "authority" are not secrets. */
const SETTINGS_SECRET_KEY =
  /(^|_)(api_?key|token|access_token|refresh_token|id_token|secret|client_secret|password|passwd|credential|private_key|bearer|authorization|cookie)(_|$)|(^|_)credentials$/;
/** Credentials whatever their key: auth schemes, header lines, and well-known token formats. */
const SECRET_VALUE =
  /^(bearer|basic|token|digest)\s+\S+|^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token|private-token)\s*:\s*\S+|^(sk|pk|rk)-[\w-]{12,}|^gh[pousr]_\w{20,}|^github_pat_\w{20,}|^xox[abprs]-[\w-]{10,}|^glpat-[\w-]{12,}|^AKIA[A-Z0-9]{16}$/i;
/** Only a value that is entirely a reference is safe: "{env:KEY}" is kept, "sk-1{env:KEY}" is not. */
const REFERENCE = /^(\{(env|file):[^{}]+\}|\$\{[\w.]+\}|\$[A-Za-z_]\w*|\$\([^()]*\))$/;
/**
 * Query parameters kept on imported URLs. Every other parameter is dropped and reported: a token can hide
 * under any name, so a short list of known-safe names is the only rule that cannot miss one.
 */
const SAFE_QUERY: ReadonlySet<string> = new Set([
  "region",
  "location",
  "version",
  "api-version",
  "apiversion",
  "format",
  "lang",
  "locale",
  "mode",
  "transport",
  "project",
  "workspace",
  "team",
  "org",
  "env",
  "environment",
  "readonly",
  "read_only",
  "tools",
  "toolsets",
  "features",
]);
const HEADER_FLAGS = new Set(["-H", "--header"]);

/** A URL without user info, fragment, parameters outside SAFE_QUERY, or credential values; undefined when unchanged. */
function cleanUrl(value: string): string | undefined {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
  let changed = false;
  if (url.username || url.password) {
    url.username = "";
    url.password = "";
    changed = true;
  }
  if (url.hash) {
    url.hash = "";
    changed = true;
  }
  for (const [name, entry] of [...url.searchParams]) {
    const verdict = SAFE_QUERY.has(name.toLowerCase()) ? judge(entry, false) : undefined;
    if (verdict?.changed === false) continue;
    url.searchParams.delete(name, entry);
    if (verdict && !verdict.drop) url.searchParams.append(name, verdict.value);
    changed = true;
  }
  return changed ? url.toString() : undefined;
}

type Verdict = { readonly drop: true } | { readonly drop: false; readonly value: string };

/** Drop a credential, strip credentials out of a URL, or keep the value as it is. */
function judge(value: string, secretKey: boolean): Verdict & { readonly changed: boolean } {
  const trimmed = value.trim();
  if (!trimmed || REFERENCE.test(trimmed)) return { drop: false, value, changed: false };
  if (secretKey || SECRET_VALUE.test(trimmed)) return { drop: true, changed: true };
  const cleaned = cleanUrl(trimmed);
  return cleaned === undefined
    ? { drop: false, value, changed: false }
    : { drop: false, value: cleaned, changed: true };
}

function words(key: string): string {
  return key
    .replace(/OAuth/g, "Oauth")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase();
}

function settingsKey(key: string): boolean {
  // Fields like bearer_token_env_var hold the name of an environment variable, not a credential.
  if (/env_?var$/i.test(key)) return false;
  return SETTINGS_SECRET_KEY.test(words(key));
}

/** Everything under a sensitive key stays sensitive, so {apiKey: [[{value: "..."}]]} is caught. */
function walk(
  node: JsonValue,
  path: string,
  key: string,
  secrets: string[],
  inherited = false,
): JsonValue | undefined {
  const sensitive = inherited || settingsKey(key);
  if (typeof node === "string") {
    const verdict = judge(node, sensitive);
    if (verdict.changed) secrets.push(path);
    return verdict.drop ? undefined : verdict.value;
  }
  if (Array.isArray(node))
    return node.flatMap((item, index) => {
      const kept = walk(item, `${path}.${index}`, key, secrets, sensitive);
      return kept === undefined ? [] : [kept];
    });
  if (node !== null && typeof node === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [name, child] of Object.entries(node)) {
      const kept = walk(child, path ? `${path}.${name}` : name, name, secrets, sensitive);
      if (kept !== undefined) result[name] = kept;
    }
    return result;
  }
  return node;
}

/** Remove or strip secret-looking values anywhere in a settings object; only their paths are reported. */
export function scrubSettings(value: JsonObject): {
  readonly value: JsonObject;
  readonly secrets: readonly string[];
} {
  const secrets: string[] = [];
  return { value: walk(value, "", "", secrets) as JsonObject, secrets };
}

function scrubArgs(args: readonly string[], secrets: string[]): string[] {
  const kept: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    const inline = /^(--?[\w-]+)=(.*)$/s.exec(arg);
    if (inline?.[1] && inline[2] !== undefined) {
      const name = HEADER_FLAGS.has(inline[1])
        ? (/^([\w-]+)\s*:/.exec(inline[2])?.[1] ?? "")
        : inline[1];
      const verdict = judge(inline[2], SECRET_KEY.test(name));
      if (verdict.changed) secrets.push(`args.${index}`);
      if (!verdict.drop) kept.push(verdict.changed ? `${inline[1]}=${verdict.value}` : arg);
      continue;
    }
    const next = args[index + 1];
    if (/^--?[\w-]+$/.test(arg) && next !== undefined) {
      const header = HEADER_FLAGS.has(arg);
      const name = header ? (/^([\w-]+)\s*:/.exec(next)?.[1] ?? "") : arg;
      if (header || SECRET_KEY.test(arg)) {
        const verdict = judge(next, SECRET_KEY.test(name));
        if (verdict.drop) {
          secrets.push(`args.${index + 1}`);
          index += 1;
          continue;
        }
      }
    }
    const verdict = judge(arg, false);
    if (verdict.changed) secrets.push(`args.${index}`);
    if (!verdict.drop) kept.push(verdict.value);
  }
  return kept;
}

/** Remove or strip secret-looking values in an MCP server; only their field paths are reported. */
export function scrubServer(server: McpServer): {
  readonly server: McpServer;
  readonly secrets: readonly string[];
} {
  const secrets: string[] = [];
  const { command, args, url, env, headers, ...rest } = server;
  const result: Record<string, JsonValue> = {
    ...(walk(rest, "", "", secrets) as JsonObject),
  };
  if (command !== undefined) result["command"] = command;
  if (args !== undefined) {
    const kept = scrubArgs(args, secrets);
    result["args"] = kept;
  }
  if (url !== undefined) {
    const verdict = judge(url, false);
    if (verdict.changed) secrets.push("url");
    if (!verdict.drop) result["url"] = verdict.value;
  }
  for (const [field, values] of [
    ["env", env],
    ["headers", headers],
  ] as const) {
    if (values === undefined) continue;
    const kept: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
      const verdict = judge(value, SECRET_KEY.test(key));
      if (verdict.changed) secrets.push(`${field}.${key}`);
      if (!verdict.drop) kept[key] = verdict.value;
    }
    if (Object.keys(kept).length) result[field] = kept;
  }
  return { server: result as McpServer, secrets: secrets.sort() };
}
