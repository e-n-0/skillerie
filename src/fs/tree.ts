import { Buffer } from "node:buffer";
import { constants } from "node:fs";
import { lstat, open, readlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { RenderedFile } from "../core/types.js";
import { validateRenderedFiles } from "./internal.js";
import type { TreeDifference } from "./types.js";

function assertNever(value: never): never {
  throw new TypeError(`unexpected rendered file kind: ${JSON.stringify(value)}`);
}

function comparePaths(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export async function readGeneration(generationDir: string): Promise<readonly RenderedFile[]> {
  const files: RenderedFile[] = [];

  async function visit(directory: string, parentRelPath: string): Promise<void> {
    const names = await readdir(directory);
    names.sort(comparePaths);

    for (const name of names) {
      const absolutePath = join(directory, name);
      const relPath = parentRelPath.length === 0 ? name : `${parentRelPath}/${name}`;
      const info = await lstat(absolutePath);

      if (info.isSymbolicLink()) {
        files.push({
          kind: "symlink",
          relPath,
          content: await readlink(absolutePath),
          mode: info.mode & 0o777,
        });
      } else if (info.isDirectory()) {
        await visit(absolutePath, relPath);
      } else if (info.isFile()) {
        const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);

        try {
          const openedInfo = await handle.stat();

          if (!openedInfo.isFile()) {
            throw new TypeError(`generation entry is not a regular file: ${relPath}`);
          }

          files.push({
            kind: "file",
            relPath,
            content: await handle.readFile(),
            mode: openedInfo.mode & 0o777,
          });
        } finally {
          await handle.close();
        }
      } else {
        throw new TypeError(`unsupported generation entry: ${relPath}`);
      }
    }
  }

  await visit(generationDir, "");
  return files;
}

export async function diffTree(
  expected: readonly RenderedFile[],
  actualDir: string,
): Promise<readonly TreeDifference[]> {
  validateRenderedFiles(expected);
  const actual = await readGeneration(actualDir);
  const actualByPath = new Map(actual.map((file) => [file.relPath, file]));
  const expectedPaths = new Set(expected.map((file) => file.relPath));
  const differences: TreeDifference[] = [];

  for (const expectedFile of expected) {
    const actualFile = actualByPath.get(expectedFile.relPath);

    if (actualFile === undefined) {
      differences.push({ relPath: expectedFile.relPath, reason: "missing" });
      continue;
    }

    if (expectedFile.kind !== actualFile.kind) {
      differences.push({ relPath: expectedFile.relPath, reason: "kind" });
      continue;
    }

    switch (expectedFile.kind) {
      case "file": {
        switch (actualFile.kind) {
          case "file": {
            const expectedContent =
              typeof expectedFile.content === "string"
                ? Buffer.from(expectedFile.content)
                : expectedFile.content;
            const actualContent =
              typeof actualFile.content === "string"
                ? Buffer.from(actualFile.content)
                : actualFile.content;

            if (!expectedContent.equals(actualContent)) {
              differences.push({ relPath: expectedFile.relPath, reason: "content" });
            }

            if ((expectedFile.mode & 0o111) !== (actualFile.mode & 0o111)) {
              differences.push({ relPath: expectedFile.relPath, reason: "mode" });
            }
            break;
          }
          case "symlink":
            differences.push({ relPath: expectedFile.relPath, reason: "kind" });
            break;
          default:
            assertNever(actualFile);
        }
        break;
      }
      case "symlink":
        switch (actualFile.kind) {
          case "file":
            differences.push({ relPath: expectedFile.relPath, reason: "kind" });
            break;
          case "symlink":
            if (expectedFile.content !== actualFile.content) {
              differences.push({ relPath: expectedFile.relPath, reason: "symlink" });
            }
            break;
          default:
            assertNever(actualFile);
        }
        break;
      default:
        assertNever(expectedFile);
    }
  }

  for (const actualFile of actual) {
    if (!expectedPaths.has(actualFile.relPath)) {
      differences.push({ relPath: actualFile.relPath, reason: "extra" });
    }
  }

  return differences.sort((left, right) => {
    const pathOrder = comparePaths(left.relPath, right.relPath);
    return pathOrder === 0 ? comparePaths(left.reason, right.reason) : pathOrder;
  });
}
