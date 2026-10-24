import { chmod, lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse, type ParseError } from "jsonc-parser";
import type { ResolvedSourcePaths } from "../config/sources.js";
import type { Diagnostic, JsonValue } from "../core/types.js";
import { scaffoldFiles } from "../init/templates.js";
import { isJsonObject } from "../model/json.js";
import { hashFiles, hashJson, hashText } from "./shared.js";
import type { FoundItem, FoundMcp, ImportWrite } from "./types.js";

const conflict = "already in the repository with different content";

async function existing(path: string) {
  try {
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) throw new TypeError("Import targets must not be symbolic links.");
    return entry;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function directory(path: string): Promise<void> {
  const parent = dirname(path);
  if (parent !== path) await directory(parent);
  const entry = await existing(path);
  if (entry) {
    if (!entry.isDirectory()) throw new TypeError("Expected a repository directory.");
    return;
  }
  await mkdir(path);
}

async function textAt(path: string): Promise<string | undefined> {
  const entry = await existing(path);
  if (!entry) return undefined;
  if (!entry.isFile()) throw new TypeError("Expected a regular repository file.");
  return readFile(path, "utf8");
}

async function skillFiles(root: string, paths?: readonly string[]) {
  const names: string[] = [];
  async function visit(relative: string): Promise<void> {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      const name = join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else names.push(name);
    }
  }
  if (paths === undefined) await visit("");
  return Promise.all(
    (paths ?? names).map(async (relPath) => {
      const path = join(root, relPath);
      const entry = await existing(path);
      if (!entry?.isFile()) throw new TypeError("Expected a regular skill file.");
      return { relPath, content: await readFile(path), mode: entry.mode & 0o777 };
    }),
  );
}

function result(
  item: FoundItem,
  target: string,
  status: ImportWrite["status"],
  note?: string,
): ImportWrite {
  return {
    kind: item.kind,
    name: item.name,
    source: item.source,
    target,
    status,
    ...(note ? { note } : {}),
  };
}

async function writeMcp(target: string, items: readonly FoundMcp[]): Promise<ImportWrite[]> {
  const text = await textAt(target);
  const errors: ParseError[] = [];
  const data: unknown =
    text === undefined ? { mcpServers: {} } : parse(text, errors, { allowTrailingComma: true });
  if (
    errors.length ||
    !isJsonObject(data) ||
    (data["mcpServers"] !== undefined && !isJsonObject(data["mcpServers"]))
  )
    throw new TypeError("Expected an MCP JSON object with a mcpServers mapping.");
  const servers: Record<string, JsonValue> = { ...(data["mcpServers"] ?? {}) };
  const writes = items.map((item) => {
    const current = Object.hasOwn(servers, item.name) ? servers[item.name] : undefined;
    const status =
      current === undefined
        ? "written"
        : hashJson(current) === hashJson(item.server)
          ? "unchanged"
          : "conflict";
    if (status === "written")
      Object.defineProperty(servers, item.name, {
        value: item.server,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    const notes = [
      ...(status === "conflict" ? [conflict] : []),
      ...(item.secrets.length ? [`removed secrets: ${item.secrets.join(", ")}`] : []),
    ];
    return result(item, target, status, notes.join("; "));
  });
  if (writes.some((write) => write.status === "written")) {
    await directory(dirname(target));
    await writeFile(
      target,
      `${JSON.stringify(
        {
          ...data,
          mcpServers: Object.fromEntries(
            Object.entries(servers).sort(([a], [b]) => a.localeCompare(b)),
          ),
        },
        null,
        2,
      )}\n`,
    );
  }
  return writes;
}

/** Copy selected inventory into the repository without changing harness homes. */
export async function writeImport(input: {
  readonly sources: ResolvedSourcePaths;
  readonly items: readonly FoundItem[];
}): Promise<{
  readonly writes: readonly ImportWrite[];
  readonly diagnostics: readonly Diagnostic[];
}> {
  const writes: ImportWrite[] = [];
  const diagnostics: Diagnostic[] = [];
  const mcp: FoundMcp[] = [];
  for (const item of input.items) {
    let target = item.path;
    try {
      switch (item.kind) {
        case "skill": {
          target = join(input.sources.skills, item.name);
          if (await existing(target)) {
            const status =
              hashFiles(await skillFiles(target)) === item.hash ? "unchanged" : "conflict";
            writes.push(result(item, target, status, status === "conflict" ? conflict : undefined));
            break;
          }
          const files = await skillFiles(item.path, item.files);
          await directory(target);
          for (const file of files) {
            const path = join(target, file.relPath);
            await directory(dirname(path));
            await writeFile(path, file.content, { mode: file.mode });
            await chmod(path, file.mode);
          }
          writes.push(result(item, target, "written"));
          break;
        }
        case "agent": {
          target = join(input.sources.agents, `${item.name}.md`);
          const current = await textAt(target);
          const status =
            current === undefined
              ? "written"
              : hashText(current) === hashText(item.markdown)
                ? "unchanged"
                : "conflict";
          if (status === "written") {
            await directory(dirname(target));
            await writeFile(target, item.markdown);
          }
          const notes = [
            ...(status === "conflict" ? [conflict] : []),
            ...(item.dropped?.length ? [`dropped: ${item.dropped.join(", ")}`] : []),
          ];
          writes.push(result(item, target, status, notes.join("; ")));
          break;
        }
        case "instructions": {
          target = input.sources.instructions;
          const current = await textAt(target);
          if (current?.trim() === item.content.trim()) {
            writes.push(result(item, target, "unchanged"));
            break;
          }
          const template = scaffoldFiles(
            { opencode: false, codex: false, omo: false, pi: false },
            "0.0.0",
            dirname(target),
          )["instructions.md"];
          const imported = !!current?.trim() && current.trim() !== template?.trim();
          const content = imported
            ? `# Imported from ${item.path}\n\n${item.content}`
            : item.content;
          if (imported) {
            target = join(dirname(target), "instructions.imported.md");
            const previous = await textAt(target);
            if (
              previous !== undefined &&
              [content.trim(), item.content.trim()].includes(previous.trim())
            ) {
              writes.push(result(item, target, "unchanged", "merge it into instructions.md"));
              break;
            }
            if (previous !== undefined) {
              writes.push(result(item, target, "conflict", conflict));
              break;
            }
          }
          await directory(dirname(target));
          await writeFile(target, content);
          writes.push(
            result(item, target, "written", imported ? "merge it into instructions.md" : undefined),
          );
          break;
        }
        case "mcp":
          mcp.push(item);
          if (item.secrets.length)
            diagnostics.push({
              severity: "warn",
              code: "import.secret",
              message: `Server ${item.name}: removed secrets: ${item.secrets.join(", ")}`,
              file: item.path,
            });
          break;
        default: {
          const exhaustive: never = item;
          return exhaustive;
        }
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      diagnostics.push({
        severity: "error",
        code: "import.write",
        message: error.message,
        file: target,
      });
    }
  }
  if (mcp.length) {
    try {
      writes.push(...(await writeMcp(input.sources.mcp, mcp)));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      diagnostics.push({
        severity: "error",
        code: "import.write",
        message: error.message,
        file: input.sources.mcp,
      });
    }
  }
  return {
    writes: writes.sort(
      (a, b) =>
        input.items.findIndex((item) => item.kind === a.kind && item.name === a.name) -
        input.items.findIndex((item) => item.kind === b.kind && item.name === b.name),
    ),
    diagnostics,
  };
}
