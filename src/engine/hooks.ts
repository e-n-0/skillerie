import { spawn } from "node:child_process";
import type { Diagnostic, Environment, HarnessId, ResolvedConfig } from "../core/types.js";

/** Hook output is not inherited, so commands cannot corrupt the CLI's JSON envelope. */
export async function postInstallHooks(input: {
  readonly config: ResolvedConfig;
  readonly harnesses: readonly HarnessId[];
  readonly env: Environment;
}): Promise<readonly Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const [index, hook] of input.config.hooks.postInstall.entries()) {
    const failure = await new Promise<string | undefined>((resolve) => {
      const child = spawn(hook.command, {
        cwd: input.config.paths.repo,
        shell: true,
        env: {
          ...input.env,
          SKILLERIE_REPO: input.config.paths.repo,
          SKILLERIE_HARNESSES: input.harnesses.join(","),
        },
        stdio: "ignore",
      });
      child.once("error", (error) => resolve(error.message));
      child.once("close", (code, signal) =>
        resolve(code === 0 ? undefined : `exit ${code ?? signal ?? "unknown"}`),
      );
    });
    if (failure !== undefined)
      diagnostics.push({
        severity: "warn",
        code: "install.hook",
        message: `Post-install hook ${index + 1} failed (${failure}).`,
        file: input.config.paths.repo,
        jsonPath: `/hooks/postInstall/${index}`,
      });
  }
  return diagnostics;
}
