import type { InputSnapshot, RenderedFile } from "../core/types.js";
import { join } from "node:path";

export function snapshotDirectoryName(hash: InputSnapshot["hash"]): string {
  const match = /^sha256:([0-9a-f]{64})$/.exec(hash);
  const directoryName = match?.[1];

  if (directoryName === undefined) {
    throw new TypeError("snapshot hash must be a lowercase SHA-256 digest");
  }

  return directoryName;
}

export function resolveRenderedPath(root: string, relPath: string): string {
  const parts = relPath.split("/");

  if (
    relPath.length === 0 ||
    relPath.startsWith("/") ||
    relPath.includes("\\") ||
    relPath.includes("\0") ||
    parts.some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    throw new TypeError(`rendered path must be a normalized relative path: ${relPath}`);
  }

  return join(root, ...parts);
}

export function validateRenderedFiles(files: readonly RenderedFile[]): void {
  const paths = new Set<string>();

  for (const file of files) {
    resolveRenderedPath(".", file.relPath);

    if (!Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777) {
      throw new RangeError(`rendered mode must contain POSIX permission bits: ${file.relPath}`);
    }

    if (paths.has(file.relPath)) {
      throw new TypeError(`duplicate rendered path: ${file.relPath}`);
    }

    paths.add(file.relPath);
  }

  for (const relPath of paths) {
    const parts = relPath.split("/");

    for (let index = 1; index < parts.length; index += 1) {
      const parentPath = parts.slice(0, index).join("/");

      if (paths.has(parentPath)) {
        throw new TypeError(`rendered entry cannot contain another entry: ${parentPath}`);
      }
    }
  }
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
