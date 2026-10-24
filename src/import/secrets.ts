import type { JsonObject, JsonValue, McpServer } from "../core/types.js";

const SECRET_KEY =
  /token|secret|passw(or)?d|api[-_]?key|apikey|auth|credential|private[-_]?key|cookie/i;
const SECRET_VALUE =
  /^(bearer|basic)\s+\S{8,}|^(sk|pk|rk)-[\w-]{12,}|^gh[pousr]_\w{20,}|^xox[abprs]-[\w-]{10,}|^glpat-[\w-]{12,}|^AKIA[A-Z0-9]{16}$/i;
/** Values that already point at the environment or a file are safe to keep. */
const REFERENCE = /\{env:|\{file:|\$\{|^\$\w+$|^\$\(/;

function secret(key: string, value: string): boolean {
  if (!value || REFERENCE.test(value)) return false;
  return SECRET_KEY.test(key) || SECRET_VALUE.test(value.trim());
}

/** Remove secret-looking env and header values; only their field names are reported. */
export function scrubServer(server: McpServer): {
  readonly server: McpServer;
  readonly secrets: readonly string[];
} {
  const secrets: string[] = [];
  const result: Record<string, unknown> = { ...server };
  for (const field of ["env", "headers"] as const) {
    const values = server[field];
    if (values === undefined) continue;
    const kept = Object.fromEntries(
      Object.entries(values).filter(([key, value]) => {
        const hidden = secret(key, value);
        if (hidden) secrets.push(`${field}.${key}`);
        return !hidden;
      }),
    );
    if (Object.keys(kept).length) result[field] = kept;
    else delete result[field];
  }
  if (server.args) {
    const args: string[] = [];
    for (let index = 0; index < server.args.length; index += 1) {
      const arg = server.args[index] ?? "";
      const inline = /^(--?[\w-]+)=(.*)$/.exec(arg);
      if (inline?.[1] && inline[2] !== undefined && secret(inline[1], inline[2])) {
        secrets.push(`args.${index}`);
        continue;
      }
      const next = server.args[index + 1];
      if (
        /^--?[\w-]+$/.test(arg) &&
        next !== undefined &&
        SECRET_KEY.test(arg) &&
        secret(arg, next)
      ) {
        secrets.push(`args.${index + 1}`);
        index += 1;
        continue;
      }
      if (SECRET_VALUE.test(arg)) {
        secrets.push(`args.${index}`);
        continue;
      }
      args.push(arg);
    }
    if (args.length !== server.args.length) result["args"] = args;
  }
  return { server: result as McpServer, secrets };
}

/** Settings keys are words like apiKey or client_secret; plain words such as "keyring" are not secrets. */
const SETTINGS_SECRET_KEY =
  /(^|_)(api_?key|token|access_token|refresh_token|secret|client_secret|password|passwd|credential|private_key|bearer)(_|$)/;

function secretSetting(key: string, value: string): boolean {
  if (!value || REFERENCE.test(value)) return false;
  if (SECRET_VALUE.test(value.trim())) return true;
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase();
  return SETTINGS_SECRET_KEY.test(words) && value.length >= 12 && !/\s/.test(value);
}

/** Remove secret-looking string values anywhere in a settings object; only their paths are reported. */
export function scrubSettings(value: JsonObject): {
  readonly value: JsonObject;
  readonly secrets: readonly string[];
} {
  const secrets: string[] = [];
  const walk = (node: JsonValue, path: string, key: string): JsonValue | undefined => {
    if (typeof node === "string") {
      if (!secretSetting(key, node)) return node;
      secrets.push(path);
      return undefined;
    }
    if (Array.isArray(node))
      return node.flatMap((item, index) => {
        const kept = walk(item, `${path}.${index}`, key);
        return kept === undefined ? [] : [kept];
      });
    if (node !== null && typeof node === "object") {
      const result: Record<string, JsonValue> = {};
      for (const [name, child] of Object.entries(node)) {
        const kept = walk(child, path ? `${path}.${name}` : name, name);
        if (kept !== undefined) result[name] = kept;
      }
      return result;
    }
    return node;
  };
  return { value: walk(value, "", "") as JsonObject, secrets };
}
