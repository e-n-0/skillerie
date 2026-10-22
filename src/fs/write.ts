import { Buffer } from "node:buffer";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { InputSnapshot, RenderedFile } from "../core/types.js";
import { hasErrorCode, snapshotDirectoryName, validateRenderedFiles } from "./internal.js";
import { readGeneration } from "./tree.js";
import type { Generation } from "./types.js";

class GenerationCollisionError extends Error {
  override readonly name = "GenerationCollisionError";

  constructor(
    readonly generationDir: string,
    options?: ErrorOptions,
  ) {
    super(`snapshot hash already names different generation output: ${generationDir}`, options);
  }
}

function assertNever(value: never): never {
  throw new TypeError(`unexpected rendered file kind: ${JSON.stringify(value)}`);
}

function sameRenderedFiles(
  expected: readonly RenderedFile[],
  actual: readonly RenderedFile[],
): boolean {
  if (expected.length !== actual.length) return false;

  const actualByPath = new Map(actual.map((file) => [file.relPath, file]));

  for (const expectedFile of expected) {
    const actualFile = actualByPath.get(expectedFile.relPath);
    if (actualFile === undefined || expectedFile.kind !== actualFile.kind) return false;

    switch (expectedFile.kind) {
      case "file": {
        if (actualFile.kind !== "file" || expectedFile.mode !== actualFile.mode) return false;
        const expectedContent =
          typeof expectedFile.content === "string"
            ? Buffer.from(expectedFile.content)
            : expectedFile.content;
        const actualContent =
          typeof actualFile.content === "string"
            ? Buffer.from(actualFile.content)
            : actualFile.content;
        if (!expectedContent.equals(actualContent)) return false;
        break;
      }
      case "symlink":
        if (actualFile.kind !== "symlink" || expectedFile.content !== actualFile.content) {
          return false;
        }
        break;
      default:
        assertNever(expectedFile);
    }
  }

  return true;
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");

  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncStagedDirectories(
  stagingDir: string,
  directories: ReadonlySet<string>,
): Promise<void> {
  const depth = (directory: string): number => {
    const relPath = relative(stagingDir, directory);
    return relPath.length === 0 ? 0 : relPath.split(sep).length;
  };
  const ordered = [...directories].sort((left, right) => depth(right) - depth(left));

  for (const directory of ordered) {
    await syncDirectory(directory);
  }
}

function recordParentDirectories(
  stagingDir: string,
  filePath: string,
  directories: Set<string>,
): void {
  let directory = dirname(filePath);

  while (directory === stagingDir || directory.startsWith(`${stagingDir}${sep}`)) {
    directories.add(directory);
    if (directory === stagingDir) return;
    directory = dirname(directory);
  }

  throw new RangeError(`rendered path escaped its staging directory: ${filePath}`);
}

async function existingGeneration(
  generationDir: string,
  hash: InputSnapshot["hash"],
  files: readonly RenderedFile[],
): Promise<Generation | undefined> {
  try {
    const info = await lstat(generationDir);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new GenerationCollisionError(generationDir);
    }

    const actual = await readGeneration(generationDir);
    if (!sameRenderedFiles(files, actual)) {
      throw new GenerationCollisionError(generationDir);
    }

    return { hash, dir: generationDir };
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

export async function writeGeneration(
  cacheDir: string,
  snapshot: InputSnapshot,
  files: readonly RenderedFile[],
): Promise<Generation> {
  validateRenderedFiles(files);

  const directoryName = snapshotDirectoryName(snapshot.hash);
  const generationsDir = join(cacheDir, "generations");
  const generationDir = join(generationsDir, directoryName);
  const generation: Generation = { hash: snapshot.hash, dir: generationDir };

  await mkdir(cacheDir, { recursive: true });
  await mkdir(generationsDir, { recursive: true });

  const existing = await existingGeneration(generationDir, snapshot.hash, files);
  if (existing !== undefined) return existing;

  const stagingDir = await mkdtemp(join(cacheDir, ".generation-"));
  const directories = new Set<string>([stagingDir]);
  let stagingInstalled = false;

  try {
    for (const file of files) {
      const filePath = join(stagingDir, ...file.relPath.split("/"));
      await mkdir(dirname(filePath), { recursive: true });
      recordParentDirectories(stagingDir, filePath, directories);

      if (file.kind === "symlink") {
        await symlink(file.content, filePath);
      } else {
        await writeFile(filePath, file.content, { flag: "wx", mode: file.mode });
        await chmod(filePath, file.mode);

        const handle = await open(filePath, "r");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
    }

    await syncStagedDirectories(stagingDir, directories);

    try {
      await rename(stagingDir, generationDir);
      stagingInstalled = true;
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST") && !hasErrorCode(error, "ENOTEMPTY")) {
        throw error;
      }

      const actual = await readGeneration(generationDir);
      if (!sameRenderedFiles(files, actual)) {
        throw new GenerationCollisionError(generationDir, { cause: error });
      }

      await rm(stagingDir, { recursive: true, force: true });
      stagingInstalled = true;
      return generation;
    }

    await syncDirectory(generationsDir);
    await syncDirectory(cacheDir);
    return generation;
  } catch (error) {
    if (!stagingInstalled) {
      try {
        await rm(stagingDir, { recursive: true, force: true });
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "generation staging failed and its temporary directory could not be removed",
        );
      }
    }

    throw error;
  }
}
