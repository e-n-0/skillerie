import type { McpServer } from "../core/types.js";

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
