import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Diagnostic, ResolvedContext } from "../../core/types.js";

const execute = promisify(execFile);

/** Pi has no configuration-only validator; never start a model or load extensions. */
export async function check(ctx: ResolvedContext): Promise<readonly Diagnostic[]> {
  try {
    await execute(ctx.harnessVersion.executable ?? "pi", ["--version"], {
      env: ctx.env,
      cwd: ctx.model.repoDir,
      timeout: 5000,
      maxBuffer: 65536,
    });
    return [
      {
        severity: "info",
        code: "pi.check.unsupported",
        message:
          "Pi has no config validator, so skillerie only checked that the rendered files parse.",
      },
    ];
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if ("code" in error && error.code === "ENOENT")
      return [
        {
          severity: "info",
          code: "pi.check.skipped",
          message: "Pi CLI not found; skipped its config check.",
        },
      ];
    return [
      {
        severity: "error",
        code: "pi.check.failed",
        message: `Pi CLI probe failed: ${error.message}`,
      },
    ];
  }
}
