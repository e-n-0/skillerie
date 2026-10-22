import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Diagnostic, ResolvedContext } from "../../core/types.js";
import { configBlocks } from "./config.js";

function configStatus(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || !("checks" in value)) return undefined;
  const checks = value.checks;
  if (checks === null || typeof checks !== "object" || !("config.load" in checks)) return undefined;
  const config = checks["config.load"];
  if (config === null || typeof config !== "object" || !("status" in config)) return undefined;
  return typeof config.status === "string" ? config.status : undefined;
}

export async function check(ctx: ResolvedContext): Promise<readonly Diagnostic[]> {
  const config = configBlocks(ctx);
  if (config.diagnostics.some((item) => item.severity === "error")) return config.diagnostics;
  const temporary = await mkdtemp(join(tmpdir(), "skillerie-codex-"));
  try {
    await writeFile(join(temporary, "config.toml"), config.config);
    const result = await new Promise<{
      readonly error: Error | null;
      readonly stdout: string;
    }>((resolve) => {
      execFile(
        ctx.harnessVersion.executable ?? "codex",
        ["--strict-config", "doctor", "--json"],
        {
          cwd: temporary,
          env: { ...ctx.env, CODEX_HOME: temporary },
          timeout: 30_000,
          maxBuffer: 4 * 1024 * 1024,
          encoding: "utf8",
        },
        (error, stdout) => resolve({ error, stdout }),
      );
    });
    if (result.error && "code" in result.error && result.error.code === "ENOENT")
      return [
        {
          severity: "info",
          code: "codex.checkSkipped",
          message: "Codex CLI is absent; strict-config validation was skipped.",
        },
      ];
    if (result.error && "killed" in result.error && result.error.killed)
      return [
        {
          severity: "error",
          code: "codex.doctor",
          message: "Codex strict-config doctor did not complete within its resource limits.",
        },
      ];
    let status: string | undefined;
    try {
      const parsed: unknown = JSON.parse(result.stdout);
      status = configStatus(parsed);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    // Other doctor checks may fail independently; config.load is the contract.
    return [
      {
        severity: status === "ok" ? "info" : "error",
        code: "codex.doctor",
        message:
          status === "ok"
            ? "Codex strict-config config.load passed."
            : "Codex strict-config doctor did not report config.load status ok.",
      },
    ];
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
