import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import type { Action } from "../../src/core/types.js";
import type { InstallOptions } from "../../src/install/index.js";

const roots = new Set<string>();
afterEach(async () => {
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
  roots.clear();
});

export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "skillerie-install-"));
  roots.add(root);
  const home = join(root, "home"),
    harnessHome = join(home, ".harness");
  const source = join(root, "generation", "config");
  await mkdir(join(root, "generation"), { recursive: true });
  await writeFile(source, "generated\n");
  await mkdir(harnessHome, { recursive: true });
  const target = join(harnessHome, "config");
  const actions: readonly Action[] = [{ kind: "link", source, target }];
  const options: InstallOptions = {
    repo: { path: join(root, "repo"), configHash: "sha256:config" },
    harness: "codex",
    harnessHome,
    home,
    backupRoot: join(home, "backups"),
    engineVersion: "1.0.0",
    actions,
  };
  return { root, home, harnessHome, source, target, options };
}

/** Byte, mode, directory, and link snapshot; deliberately excludes no metadata. */
export async function snapshot(root: string): Promise<Readonly<Record<string, string>>> {
  const entries: Record<string, string> = {};
  async function visit(path: string, rel: string): Promise<void> {
    const info = await lstat(path);
    if (info.isSymbolicLink()) entries[rel] = `link:${await readlink(path)}`;
    else if (info.isDirectory()) {
      entries[rel] = `directory:${info.mode & 0o777}`;
      for (const name of (await readdir(path)).sort())
        await visit(join(path, name), rel ? `${rel}/${name}` : name);
    } else entries[rel] = `file:${info.mode & 0o777}:${(await readFile(path)).toString("base64")}`;
  }
  await visit(root, "");
  return entries;
}

export async function backups(options: InstallOptions): Promise<readonly string[]> {
  return Object.values(await snapshot(options.backupRoot));
}

export function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
