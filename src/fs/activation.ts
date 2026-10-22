import { randomUUID } from "node:crypto";
import { lstat, open, readlink, readdir, rename, rm, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { hasErrorCode, snapshotDirectoryName } from "./internal.js";
import type { Generation } from "./types.js";

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");

  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function previousGenerationName(
  currentPath: string,
  generationsDir: string,
): Promise<string | undefined> {
  let target: string;

  try {
    target = await readlink(currentPath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }

  const targetPath = resolve(dirname(currentPath), target);
  const name = relative(generationsDir, targetPath);

  if (
    name.length === 0 ||
    name === ".." ||
    name.startsWith(`..${sep}`) ||
    name.includes(sep) ||
    isAbsolute(name)
  ) {
    return undefined;
  }

  try {
    const info = await lstat(targetPath);
    return info.isDirectory() && !info.isSymbolicLink() ? name : undefined;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

async function pruneGenerations(
  generationsDir: string,
  currentName: string,
  previousName: string | undefined,
): Promise<void> {
  const retained = new Set([currentName]);
  if (previousName !== undefined) retained.add(previousName);

  const entries = await readdir(generationsDir, { withFileTypes: true });
  let removed = false;

  for (const entry of entries) {
    if (entry.isDirectory() && !retained.has(entry.name)) {
      await rm(join(generationsDir, entry.name), { recursive: true, force: true });
      removed = true;
    }
  }

  if (removed) await syncDirectory(generationsDir);
}

export async function swapCurrent(cacheDir: string, generation: Generation): Promise<void> {
  const currentName = snapshotDirectoryName(generation.hash);
  const generationsDir = join(cacheDir, "generations");
  const generationDir = join(generationsDir, currentName);

  if (resolve(generation.dir) !== resolve(generationDir)) {
    throw new TypeError("generation directory does not match its snapshot hash");
  }

  const generationInfo = await lstat(generationDir);
  if (!generationInfo.isDirectory() || generationInfo.isSymbolicLink()) {
    throw new TypeError("current target must be a generation directory");
  }

  const currentPath = join(cacheDir, "current");
  const previousName = await previousGenerationName(currentPath, generationsDir);
  const temporaryLink = join(cacheDir, `.current-${randomUUID()}`);
  let temporaryLinkCreated = false;

  try {
    await symlink(relative(cacheDir, generationDir), temporaryLink, "dir");
    temporaryLinkCreated = true;
    await rename(temporaryLink, currentPath);
    temporaryLinkCreated = false;
    await syncDirectory(cacheDir);
  } catch (error) {
    if (temporaryLinkCreated) {
      try {
        await rm(temporaryLink, { force: true });
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "current activation failed and its temporary link could not be removed",
        );
      }
    }

    throw error;
  }

  await pruneGenerations(generationsDir, currentName, previousName);
}
