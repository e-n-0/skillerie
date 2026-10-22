import { spawn } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, expect } from "vitest";
import type { Environment } from "../../src/core/types.js";

const project = fileURLToPath(new URL("../../", import.meta.url));

export function execute(args: readonly string[], env: Environment = process.env) {
  return new Promise<{
    readonly code: number | null;
    readonly stdout: string;
    readonly stderr: string;
  }>((resolve, reject) => {
    const child = spawn(process.execPath, [...args], {
      cwd: project,
      env: { ...env },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20_000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

export async function tree(directory: string, ignored: readonly string[] = []): Promise<string[]> {
  const entries: string[] = [];
  async function visit(path: string, relPath: string): Promise<void> {
    if (ignored.includes(relPath)) return;
    const info = await lstat(path);
    const mode = info.mode & 0o777;
    if (info.isSymbolicLink()) {
      entries.push(`link ${mode} ${relPath} ${await readlink(path)}`);
    } else if (info.isDirectory()) {
      entries.push(`directory ${mode} ${relPath}`);
      for (const name of (await readdir(path)).sort())
        await visit(join(path, name), relPath ? `${relPath}/${name}` : name);
    } else {
      entries.push(`file ${mode} ${relPath} ${(await readFile(path)).toString("base64")}`);
    }
  }
  await visit(directory, "");
  return entries;
}

interface Sandbox {
  readonly root: string;
  readonly repo: string;
  readonly home: string;
  readonly backup: string;
  readonly env: Environment;
}

/** Each suite compiles to its own temporary package; concurrent runs never share dist. */
export function lifecycleSuite() {
  let compiled: string;
  let sandbox: Sandbox;
  beforeAll(async () => {
    compiled = await mkdtemp(join(tmpdir(), "skillerie-cli-build-"));
    await cp(join(project, "package.json"), join(compiled, "package.json"));
    await symlink(join(project, "schema"), join(compiled, "schema"), "dir");
    await symlink(join(project, "node_modules"), join(compiled, "node_modules"), "dir");
    const result = await execute([
      join(project, "node_modules/typescript/bin/tsc"),
      "-p",
      join(project, "tsconfig.build.json"),
      "--outDir",
      join(compiled, "dist"),
      "--declaration",
      "false",
      "--declarationMap",
      "false",
      "--sourceMap",
      "false",
    ]);
    expect(result, result.stderr + result.stdout).toMatchObject({ code: 0 });
  }, 30_000);
  afterAll(async () => {
    if (compiled) await rm(compiled, { recursive: true, force: true });
  });
  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), "skillerie-lifecycle-"));
    const home = join(root, "home");
    const repo = join(root, "repo");
    const backup = join(root, "backups");
    await mkdir(home);
    await cp(join(project, "test/fixtures/sample-repo"), repo, { recursive: true });
    sandbox = {
      root,
      home,
      repo,
      backup,
      env: {
        HOME: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        XDG_CACHE_HOME: join(root, "cache"),
        CODEX_HOME: join(home, ".codex"),
        OMO_CODING_AGENT_DIR: join(home, ".omo", "content"),
        PI_CODING_AGENT_DIR: join(home, ".pi", "agent"),
        SKILLERIE_BACKUP_DIR: backup,
        PATH: dirname(process.execPath),
      },
    };
  });
  afterEach(async () => {
    if (sandbox) await rm(sandbox.root, { recursive: true, force: true });
  });
  return {
    get sandbox() {
      return sandbox;
    },
    run(args: readonly string[], repo = sandbox.repo) {
      return execute([join(compiled, "dist/cli.js"), ...args, "--repo", repo], sandbox.env);
    },
  };
}
