import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Diagnostic, ResolvedContext } from "../../core/types.js";
import { renderConfig } from "./config.js";

const execute = promisify(execFile);

/** Validate configuration headlessly, without sending prompts or printing resolved secrets. */
export async function check(ctx: ResolvedContext): Promise<readonly Diagnostic[]> {
  const result = renderConfig(ctx);
  if (!result.config || result.diagnostics.some((item) => item.severity === "error"))
    return result.diagnostics;
  try {
    await execute(ctx.harnessVersion.executable ?? "opencode", ["debug", "config"], {
      cwd: ctx.model.repoDir,
      env: {
        ...ctx.env,
        OPENCODE_CONFIG_DIR: ctx.paths.configDir,
        OPENCODE_CONFIG_CONTENT: JSON.stringify(result.config),
        OPENCODE_DISABLE_AUTOUPDATE: "true",
        OPENCODE_DISABLE_MODELS_FETCH: "true",
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
      },
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    return result.diagnostics;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if ("code" in error && error.code === "ENOENT")
      return [
        ...result.diagnostics,
        {
          severity: "info",
          code: "opencode.checkSkipped",
          message: "OpenCode CLI is absent; headless configuration validation was skipped.",
        },
      ];
    return [
      ...result.diagnostics,
      {
        severity: "error",
        code: "opencode.check",
        message:
          "OpenCode headless configuration validation failed. Run opencode debug config locally for details.",
      },
    ];
  }
}
