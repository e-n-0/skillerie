import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { Diagnostic } from "../core/types.js";
import { parseFrontmatter } from "../model/frontmatter.js";
import { failureReason, hashFiles, safeDiagnostics } from "./shared.js";
import type { FoundSkill, ImportSource, ScanContext, ScanResult } from "./types.js";

interface SkillFile {
  readonly relPath: string;
  readonly content: Buffer;
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function errorMessage(error: unknown): string {
  return failureReason(error);
}

function diagnostic(file: string, message: string): Diagnostic {
  return { severity: "warn", code: "import.skill", message, file };
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function readSkillFiles(root: string): Promise<readonly SkillFile[]> {
  const files: SkillFile[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
      compareNames(left.name, right.name),
    );
    for (const entry of entries) {
      if (
        entry.name === ".DS_Store" ||
        entry.name === ".git" ||
        entry.name === "__pycache__" ||
        entry.name.endsWith(".pyc")
      )
        continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        files.push({
          relPath: relative(root, path).split(sep).join("/"),
          content: await readFile(path),
        });
      } else if (entry.isSymbolicLink() && entry.name === "SKILL.md" && directory === root) {
        const target = await stat(path);
        if (target.isFile())
          files.push({
            relPath: "SKILL.md",
            content: await readFile(path),
          });
      }
    }
  }

  await visit(root);
  return files.sort((left, right) => compareNames(left.relPath, right.relPath));
}

/** Inventory immediate skill directories from the supplied harness locations. */
export async function scanSkillDirectories(
  dirs: readonly { readonly source: ImportSource; readonly dir: string }[],
  ctx: ScanContext,
): Promise<ScanResult> {
  const items: FoundSkill[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const { source, dir } of dirs) {
    const root = resolve(dir);
    let children;
    try {
      children = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") continue;
      diagnostics.push(
        diagnostic(root, `Could not inspect skill directory: ${errorMessage(error)}`),
      );
      continue;
    }

    children.sort((left, right) => compareNames(left.name, right.name));
    for (const child of children) {
      if (child.name.startsWith(".")) continue;

      const path = join(root, child.name);
      if (ctx.managed(path)) continue;

      let isDirectory = child.isDirectory();
      if (child.isSymbolicLink()) {
        try {
          isDirectory = (await stat(path)).isDirectory();
        } catch (error) {
          if (errorCode(error) !== "ENOENT") {
            diagnostics.push(
              diagnostic(path, `Could not inspect skill directory: ${errorMessage(error)}`),
            );
          }
          continue;
        }
      }
      if (!isDirectory) continue;

      const skillFile = join(path, "SKILL.md");
      try {
        if (!(await stat(skillFile)).isFile()) {
          diagnostics.push(diagnostic(skillFile, "SKILL.md must be a regular file."));
          continue;
        }
      } catch (error) {
        if (errorCode(error) === "ENOENT") continue;
        diagnostics.push(diagnostic(skillFile, `Could not read SKILL.md: ${errorMessage(error)}`));
        continue;
      }

      let files: readonly SkillFile[];
      try {
        files = await readSkillFiles(path);
      } catch (error) {
        diagnostics.push(diagnostic(path, `Could not read skill files: ${errorMessage(error)}`));
        continue;
      }

      const markdown = files.find((file) => file.relPath === "SKILL.md");
      if (!markdown) {
        diagnostics.push(diagnostic(skillFile, "Could not read SKILL.md."));
        continue;
      }
      const parsed = parseFrontmatter(markdown.content.toString("utf8"), skillFile);
      if (parsed.diagnostics.length) {
        diagnostics.push(
          ...safeDiagnostics(parsed.diagnostics).map((entry) => ({
            ...entry,
            severity: "warn" as const,
            code: "import.skill",
          })),
        );
        continue;
      }
      if (!parsed.frontmatter) {
        diagnostics.push(diagnostic(skillFile, "SKILL.md must have valid frontmatter."));
        continue;
      }
      if (
        !isNonemptyString(parsed.frontmatter["name"]) ||
        !isNonemptyString(parsed.frontmatter["description"])
      ) {
        diagnostics.push(
          diagnostic(skillFile, "SKILL.md frontmatter requires a nonempty name and description."),
        );
        continue;
      }

      items.push({
        kind: "skill",
        name: child.name,
        source,
        path,
        files: files.map((file) => file.relPath),
        hash: hashFiles(files),
      });
    }
  }

  return { items, diagnostics };
}
