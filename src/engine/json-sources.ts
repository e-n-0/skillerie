import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { parseTree, printParseErrorCode } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";
import type { Diagnostic, SourceModel } from "../core/types.js";

/** Support files and harness assets are syntax-checked without expanding their values. */
export async function lintJsonSources(model: SourceModel): Promise<readonly Diagnostic[]> {
  const files = new Set([
    ...model.skills
      .filter((skill) => skill.source !== "external")
      .flatMap((skill) => skill.supportFiles.map((file) => file.sourcePath)),
    ...model.bin.map((file) => file.sourcePath),
  ]);
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (
        [".git", "__pycache__", ".DS_Store"].includes(entry.name) ||
        /\.(?:pyc|pyo)$/.test(entry.name)
      )
        continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.add(path);
    }
  };
  for (const asset of model.assets) {
    if (asset.kind === "directory") await visit(asset.sourcePath);
    else files.add(asset.sourcePath);
  }
  const diagnostics: Diagnostic[] = [];
  for (const file of [...files].sort()) {
    const extension = extname(file);
    if (extension !== ".json" && extension !== ".jsonc") continue;
    const content = await readFile(file, "utf8");
    const errors: ParseError[] = [];
    parseTree(content, errors, {
      allowTrailingComma: extension === ".jsonc",
      disallowComments: extension === ".json",
    });
    diagnostics.push(
      ...errors.map((error) => ({
        severity: "error" as const,
        code: "source.json",
        message: printParseErrorCode(error.error),
        file,
        line: content.slice(0, error.offset).split("\n").length,
      })),
    );
  }
  return diagnostics;
}
