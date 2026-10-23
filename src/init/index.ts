import type { Command } from "commander";
import { join } from "node:path";
import type { Diagnostic, Environment, HarnessId } from "../core/types.js";
import { initRepository } from "./scaffold.js";

interface InitDependencies {
  readonly env?: Environment;
  readonly engineVersion?: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly color?: boolean;
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
    const bold = (text: string) => (dependencies.color ? `\x1b[1m${text}\x1b[0m` : text);
    // Quote the directory only when the shell needs it.
    const directory = /^[\w./~-]+$/.test(result.directory)
      ? result.directory
      : `'${result.directory.replaceAll("'", "'\\''")}'`;
    dependencies.stdout(
      [
        `${dependencies.color ? "\x1b[32mInitialized\x1b[0m" : "Initialized"} ${result.directory}`,
        "",
        "Next steps:",
        `  ${bold(`cd ${directory}`)}`,
        `  ${bold("npm install")}`,
        `  ${bold("npx skillerie validate")}`,
        `  ${bold("npx skillerie sync")}`,
        `  ${bold("npx skillerie install --check")}`,
        "",
      ].join("\n"),
    );
  }
  return valid ? 0 : 1;
}
