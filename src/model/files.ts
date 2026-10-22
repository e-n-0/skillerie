import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { Diagnostic, SourceModel, SupportFile } from "../core/types.js";

export interface SourceFile extends SupportFile {
  readonly content: Buffer;
}

export function relativePath(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}

export function within(root: string, file: string): boolean {
  const path = relativePath(root, file);
  return path !== ".." && !path.startsWith("../");
}

export function ignored(name: string): boolean {
  return [".DS_Store", ".git", "__pycache__"].includes(name) || /\.(?:pyc|pyo)$/.test(name);
}

/** Read regular files without following redirected source roots or support links. */
export async function readTree(
  root: string,
  diagnostics: Diagnostic[],
  directories?: string[],
): Promise<readonly SourceFile[]> {
  const files: SourceFile[] = [];
  async function visit(path: string, optional: boolean): Promise<void> {
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) {
        diagnostics.push({
          severity: "error",
          code: "source.symlink",
          message: "Source links are not supported.",
          file: path,
          line: 1,
        });
      } else if (stat.isDirectory()) {
        directories?.push(path);
        const children = (await readdir(path)).sort();
        for (const child of children) {
          if (!ignored(child)) await visit(join(path, child), false);
        }
      } else if (stat.isFile()) {
        files.push({
          sourcePath: path,
          relPath: relativePath(root, path),
          mode: stat.mode & 0o777,
          content: await readFile(path),
        });
      } else {
        diagnostics.push({
          severity: "error",
          code: "source.kind",
          message: "Expected a regular file or directory.",
          file: path,
          line: 1,
        });
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (optional && "code" in error && error.code === "ENOENT") return;
      diagnostics.push({
        severity: "error",
        code: "source.read",
        message: error.message,
        file: path,
        line: 1,
      });
    }
  }
  await visit(root, true);
  return files;
}

/** Discovery captures bytes once, so snapshots describe the content actually parsed. */
const inventories = new WeakMap<SourceModel, ReadonlyMap<string, SourceFile>>();

export function captureFiles(model: SourceModel, files: ReadonlyMap<string, SourceFile>): void {
  inventories.set(model, files);
}

export function capturedFiles(model: SourceModel): ReadonlyMap<string, SourceFile> | undefined {
  return inventories.get(model);
}
