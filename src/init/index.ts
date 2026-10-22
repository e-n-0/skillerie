import type { Command } from "commander";
import { join } from "node:path";
import type { Diagnostic, Environment, HarnessId } from "../core/types.js";
import { initRepository } from "./scaffold.js";

interface InitDependencies {
  readonly env?: Environment;
  readonly engineVersion?: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/** Handle init output using the CLI's captured environment and output streams. */
export async function runInit(
  directory: string,
  command: Command,
  dependencies: InitDependencies,
): Promise<number> {
  const options = command.optsWithGlobals<{
    readonly force?: boolean;
    readonly harness?: readonly HarnessId[];
    readonly json?: boolean;
  }>();
  const result = await initRepository(directory, {
    ...dependencies,
    ...(options.force === undefined ? {} : { force: options.force }),
    ...(options.harness === undefined ? {} : { harnesses: options.harness }),
  });
  const diagnostics: readonly Diagnostic[] = result.conflicts.map((name) => ({
    severity: "error",
    code: "init.conflict",
    message: "Destination already exists; use --force to replace scaffold files.",
    file: join(result.directory, name),
  }));
  const valid = diagnostics.length === 0;
  if (options.json) {
    dependencies.stdout(`${JSON.stringify({ valid, diagnostics, ...result })}\n`);
  } else if (!valid) {
    dependencies.stderr(
      `Cannot initialize; conflicting paths:\n${result.conflicts.map((name) => `  ${name}`).join("\n")}\nUse --force to replace existing scaffold files.\n`,
    );
  } else {
    dependencies.stdout(
      [
        `Initialized ${result.directory}`,
        "Next steps:",
        `  cd '${result.directory.replaceAll("'", "'\\''")}'`,
        "  npm install",
        "  npx skillerie validate",
        "  npx skillerie sync",
        "  npx skillerie install --check",
        "",
      ].join("\n"),
    );
  }
  return valid ? 0 : 1;
}
