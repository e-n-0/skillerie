import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Diagnostic } from "../core/types.js";
import { parseFrontmatter } from "../model/frontmatter.js";
import { agentMarkdown, failureReason, hashText, safeDiagnostics } from "./shared.js";
import type { FoundItem, ScanContext, ScanResult } from "./types.js";

function warning(code: string, message: string, file: string): Diagnostic {
  return { severity: "warn", code, message, file };
}

function errorCode(error: unknown): string | undefined {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  )
    return error.code;
  return undefined;
}

function readWarning(code: string, file: string, error: unknown): Diagnostic {
  const message = failureReason(error);
  return warning(code, `Could not read ${file}: ${message}`, file);
}

async function scanAgents(
  home: string,
  ctx: ScanContext,
  items: FoundItem[],
  diagnostics: Diagnostic[],
): Promise<void> {
  const agentsDir = join(home, "agents");
  let entries;
  try {
    entries = await readdir(agentsDir, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) !== "ENOENT")
      diagnostics.push(readWarning("import.agent", agentsDir, error));
    return;
  }

  for (const entry of entries
    .filter(
      (candidate) =>
        candidate.name.endsWith(".md") && (candidate.isFile() || candidate.isSymbolicLink()),
    )
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))) {
    const file = join(agentsDir, entry.name);
    if (ctx.managed(file)) continue;

    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch (error) {
      diagnostics.push(readWarning("import.agent", file, error));
      continue;
    }

    const parsed = parseFrontmatter(content, file);
    if (parsed.diagnostics.length) {
      diagnostics.push(...safeDiagnostics(parsed.diagnostics));
      continue;
    }

    const frontmatter = parsed.frontmatter ?? {};
    const description = frontmatter["description"];
    if (typeof description !== "string" || !description.trim()) {
      diagnostics.push(
        warning("import.agent", "Agent frontmatter must include a nonempty description.", file),
      );
      continue;
    }

    const frontmatterName = frontmatter["name"];
    const name =
      typeof frontmatterName === "string" && frontmatterName.trim()
        ? frontmatterName
        : entry.name.slice(0, -".md".length);
    const markdown = agentMarkdown({ name, description, body: parsed.body });
    const dropped = Object.keys(frontmatter)
      .filter((key) => key !== "name" && key !== "description")
      .sort();
    items.push({
      kind: "agent",
      name,
      source: "claude",
      path: file,
      markdown,
      hash: hashText(markdown),
      dropped,
    });
  }
}

async function scanInstructions(
  home: string,
  ctx: ScanContext,
  items: FoundItem[],
  diagnostics: Diagnostic[],
): Promise<void> {
  const file = join(home, "CLAUDE.md");
  try {
    await lstat(file);
  } catch (error) {
    if (errorCode(error) !== "ENOENT")
      diagnostics.push(readWarning("import.instructions", file, error));
    return;
  }
  if (ctx.managed(file)) return;

  try {
    const content = await readFile(file, "utf8");
    items.push({
      kind: "instructions",
      name: "instructions",
      source: "claude",
      path: file,
      content,
      hash: hashText(content),
    });
  } catch (error) {
    diagnostics.push(readWarning("import.instructions", file, error));
  }
}

export async function scanClaude(home: string, ctx: ScanContext): Promise<ScanResult> {
  const items: FoundItem[] = [];
  const diagnostics: Diagnostic[] = [];
  await scanAgents(home, ctx, items, diagnostics);
  await scanInstructions(home, ctx, items, diagnostics);
  return { items, diagnostics };
}
