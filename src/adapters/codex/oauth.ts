import type { Diagnostic, JsonObject, McpServer } from "../../core/types.js";

export interface CallbackSettings {
  readonly port?: number;
  readonly url?: string;
}

export function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Alias conflicts must fail rather than silently choosing a server's callback. */
export function callbacks(
  servers: Readonly<Record<string, McpServer>>,
  file: string,
): { readonly settings: CallbackSettings; readonly diagnostics: readonly Diagnostic[] } {
  const ports = new Set<number>();
  const urls = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  const fail = (name: string, message: string): void => {
    diagnostics.push({
      severity: "error",
      code: "codex.oauth",
      message,
      file,
      jsonPath: `/mcpServers/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`,
    });
  };
  for (const [name, server] of Object.entries(servers)) {
    const oauth = object(server["oauth"]) ? server["oauth"] : {};
    for (const source of [server, oauth]) {
      for (const field of [
        "callbackPort",
        "callback_port",
        "oauthCallbackPort",
        "oauth_callback_port",
      ]) {
        const value = source[field];
        if (value === undefined) continue;
        if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535)
          fail(name, "OAuth callback port must be an integer from 1 to 65535.");
        else ports.add(value);
      }
      for (const field of [
        "callbackUrl",
        "callback_url",
        "oauthCallbackUrl",
        "oauth_callback_url",
      ]) {
        const value = source[field];
        if (value === undefined) continue;
        if (typeof value !== "string") {
          fail(name, "OAuth callback URL must be an absolute HTTP or HTTPS URL.");
          continue;
        }
        try {
          const parsed = new URL(value);
          if (!["http:", "https:"].includes(parsed.protocol)) {
            fail(name, "OAuth callback URL must use HTTP or HTTPS.");
            continue;
          }
          urls.add(value);
          ports.add(Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80)));
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
          fail(name, "OAuth callback URL must be an absolute HTTP or HTTPS URL.");
        }
      }
    }
  }
  if (ports.size > 1 || urls.size > 1)
    fail("", "Codex requires one consistent OAuth callback port and URL across all servers.");
  const port = ports.values().next().value;
  const url =
    urls.values().next().value ?? (port ? `http://localhost:${port}/callback` : undefined);
  return {
    settings: { ...(port === undefined ? {} : { port }), ...(url === undefined ? {} : { url }) },
    diagnostics,
  };
}
