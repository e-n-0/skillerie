import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Environment, HarnessId } from "../core/types.js";
import { findExecutable } from "../doctor/probes.js";
import { HARNESS_IDS } from "../engine/types.js";
import { ENGINE_VERSION } from "../version.js";
import { scaffoldFiles } from "./templates.js";

export interface InitOptions {
  readonly env?: Environment;
  readonly engineVersion?: string;
  readonly force?: boolean;
  /** Explicit selections replace automatic detection, including for absent CLIs. */
  readonly harnesses?: readonly HarnessId[];
}

export interface InitResult {
  readonly directory: string;
  readonly files: readonly string[];
  readonly conflicts: readonly string[];
}

/** Preflight every destination, then create files exclusively unless force is explicit. */
export async function initRepository(dir: string, options: InitOptions = {}): Promise<InitResult> {
  const directory = resolve(dir);
  const env = options.env ?? process.env;
  const harnesses: Record<HarnessId, boolean> = {
    opencode: false,
    codex: false,
    omo: false,
    pi: false,
  };
  for (const harness of HARNESS_IDS) {
    harnesses[harness] =
      options.harnesses === undefined
        ? (await findExecutable(harness, env["PATH"], process.cwd())) !== undefined
        : options.harnesses.includes(harness);
  }
  const files = scaffoldFiles(harnesses, options.engineVersion ?? ENGINE_VERSION, directory);
  const directories = [".", "skills", "agents", "rules"];
  const conflicts: string[] = [];
  for (const name of [...directories, ...Object.keys(files)]) {
    try {
      const entry = await lstat(join(directory, name));
      const isDirectory = directories.includes(name);
      if (
        (isDirectory && !entry.isDirectory()) ||
        (!isDirectory && (!options.force || entry.isDirectory()))
      ) {
        conflicts.push(name);
      }
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        (error.code !== "ENOENT" && error.code !== "ENOTDIR")
      ) {
        throw error;
      }
    }
  }
  if (conflicts.length > 0) return { directory, files: [], conflicts };

  for (const [name, content] of Object.entries(files)) {
    const file = join(directory, name);
    await mkdir(dirname(file), { recursive: true });
    // Replace symlinks themselves rather than following them into another file.
    if (options.force) await rm(file, { force: true });
    await writeFile(file, content, { flag: "wx" });
  }
  return { directory, files: Object.keys(files), conflicts: [] };
}
