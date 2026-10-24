import { lstat, readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import type { Diagnostic, JsonValue, McpServer } from "../core/types.js";
import { parseFrontmatter } from "../model/frontmatter.js";
import { isJsonObject } from "../model/json.js";
import { scrubServer, scrubSettings } from "./secrets.js";
import { agentMarkdown, failureReason, hashJson, hashText, safeDiagnostics } from "./shared.js";
import type { FoundItem, ScanContext, ScanResult } from "./types.js";

function warning(code: string, message: string, file: string, line?: number): Diagnostic {
  return { severity: "warn", code, message, file, ...(line === undefined ? {} : { line }) };
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

function errorMessage(error: unknown): string {
  return failureReason(error);
}

function readWarning(code: string, file: string, error: unknown): Diagnostic {
  return warning(code, `Could not read ${file}: ${errorMessage(error)}`, file);
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
    const description = parsed.frontmatter?.["description"];
    if (typeof description !== "string" || !description.trim()) {
      diagnostics.push(
        warning("import.agent", "Agent frontmatter must include a nonempty description.", file),
      );
      continue;
    }

    const name = entry.name.slice(0, -extname(entry.name).length);
    const markdown = agentMarkdown({ name, description, body: parsed.body });
    const dropped = Object.keys(parsed.frontmatter ?? {})
      .filter((key) => key !== "name" && key !== "description")
      .sort();
    items.push({
      kind: "agent",
      name,
      source: "opencode",
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
  const file = join(home, "AGENTS.md");
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
      source: "opencode",
      path: file,
      content,
      hash: hashText(content),
    });
  } catch (error) {
    diagnostics.push(readWarning("import.instructions", file, error));
  }
}

async function readMcpConfig(
  home: string,
  ctx: ScanContext,
  diagnostics: Diagnostic[],
): Promise<{ readonly file: string; readonly content: string } | undefined> {
  for (const name of ["opencode.jsonc", "opencode.json"]) {
    const file = join(home, name);
    try {
      await lstat(file);
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      diagnostics.push(readWarning("import.mcp", file, error));
      return undefined;
    }
    if (ctx.managed(file)) continue;

    try {
      return { file, content: await readFile(file, "utf8") };
    } catch (error) {
      diagnostics.push(readWarning("import.mcp", file, error));
      return undefined;
    }
  }
  return undefined;
}

async function readSettingsConfig(
  home: string,
  ctx: ScanContext,
  diagnostics: Diagnostic[],
): Promise<{ readonly file: string; readonly name: string; readonly content: string } | undefined> {
  for (const name of ["opencode.jsonc", "opencode.json"]) {
    const file = join(home, name);
    try {
      await lstat(file);
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      diagnostics.push(readWarning("import.settings", file, error));
      return undefined;
    }
    if (ctx.managed(file)) continue;

    try {
      return { file, name: `opencode/${name}`, content: await readFile(file, "utf8") };
    } catch (error) {
      diagnostics.push(readWarning("import.settings", file, error));
      return undefined;
    }
  }
  return undefined;
}

function stringMap(value: unknown): Readonly<Record<string, string>> | undefined | null {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) return null;
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") return null;
    result[key] = entry;
  }
  return result;
}

function mapMcpServer(
  name: string,
  value: unknown,
  file: string,
  diagnostics: Diagnostic[],
): McpServer | undefined {
  if (!isJsonObject(value)) {
    diagnostics.push(warning("import.mcp", `MCP server ${name} must be an object.`, file));
    return undefined;
  }

  if (value["type"] === "remote") {
    const url = value["url"];
    const headers = stringMap(value["headers"]);
    if (typeof url !== "string" || headers === null) {
      diagnostics.push(
        warning("import.mcp", `MCP server ${name} has an invalid remote configuration.`, file),
      );
      return undefined;
    }
    const oauth = value["oauth"];
    const clientId =
      isJsonObject(oauth) && typeof oauth["clientId"] === "string" ? oauth["clientId"] : undefined;
    return {
      url,
      ...(headers && Object.keys(headers).length ? { headers } : {}),
      ...(clientId === undefined ? {} : { oauth: { clientId } }),
    };
  }

  if (value["type"] === "local") {
    const command = value["command"];
    const environment = stringMap(value["environment"]);
    if (
      !Array.isArray(command) ||
      command.length === 0 ||
      !command.every((entry): entry is string => typeof entry === "string") ||
      !command[0] ||
      environment === null
    ) {
      diagnostics.push(
        warning("import.mcp", `MCP server ${name} has an invalid local configuration.`, file),
      );
      return undefined;
    }
    return {
      command: command[0],
      ...(command.length > 1 ? { args: command.slice(1) } : {}),
      ...(environment && Object.keys(environment).length ? { env: environment } : {}),
    };
  }

  const type = typeof value["type"] === "string" ? value["type"] : "missing";
  diagnostics.push(warning("import.mcp", `MCP server ${name} has unknown type ${type}.`, file));
  return undefined;
}

async function scanMcp(
  home: string,
  ctx: ScanContext,
  items: FoundItem[],
  diagnostics: Diagnostic[],
): Promise<void> {
  const config = await readMcpConfig(home, ctx, diagnostics);
  if (!config) return;

  const errors: ParseError[] = [];
  const parsed: unknown = parse(config.content, errors, { allowTrailingComma: true });
  if (errors.length) {
    diagnostics.push(
      ...errors.map((error) =>
        warning(
          "import.mcp",
          printParseErrorCode(error.error),
          config.file,
          config.content.slice(0, error.offset).split("\n").length,
        ),
      ),
    );
    return;
  }
  if (!isJsonObject(parsed)) {
    diagnostics.push(
      warning("import.mcp", "OpenCode configuration must be an object.", config.file),
    );
    return;
  }

  const mcp = parsed["mcp"];
  if (mcp === undefined) return;
  if (!isJsonObject(mcp)) {
    diagnostics.push(warning("import.mcp", "OpenCode mcp setting must be an object.", config.file));
    return;
  }

  for (const [name, value] of Object.entries(mcp)) {
    const server = mapMcpServer(name, value, config.file, diagnostics);
    if (!server) continue;
    const scrubbed = scrubServer(server);
    items.push({
      kind: "mcp",
      name,
      source: "opencode",
      path: config.file,
      server: scrubbed.server,
      secrets: scrubbed.secrets,
      hash: hashJson(scrubbed.server),
    });
  }
}

async function scanSettings(
  home: string,
  ctx: ScanContext,
  items: FoundItem[],
  diagnostics: Diagnostic[],
): Promise<void> {
  const sources: { readonly file: string; readonly name: string; readonly content: string }[] = [];
  const config = await readSettingsConfig(home, ctx, diagnostics);
  if (config) sources.push(config);

  const tuiFile = join(home, "tui.json");
  if (!ctx.managed(tuiFile)) {
    try {
      sources.push({
        file: tuiFile,
        name: "opencode/tui.json",
        content: await readFile(tuiFile, "utf8"),
      });
    } catch (error) {
      if (errorCode(error) !== "ENOENT")
        diagnostics.push(readWarning("import.settings", tuiFile, error));
    }
  }

  for (const source of sources) {
    const errors: ParseError[] = [];
    const parsed: unknown = parse(source.content, errors, { allowTrailingComma: true });
    if (errors.length) {
      diagnostics.push(
        ...errors.map((error) =>
          warning(
            "import.settings",
            printParseErrorCode(error.error),
            source.file,
            source.content.slice(0, error.offset).split("\n").length,
          ),
        ),
      );
      continue;
    }
    if (!isJsonObject(parsed)) {
      diagnostics.push(
        warning("import.settings", "OpenCode settings must be an object.", source.file),
      );
      continue;
    }

    const settings: Record<string, JsonValue> = { ...parsed };
    const excluded: string[] = [];
    if (source.name !== "opencode/tui.json" && Object.hasOwn(settings, "mcp")) {
      delete settings["mcp"];
      excluded.push("mcp");
    }
    if (source.name !== "opencode/tui.json" && Array.isArray(settings["instructions"])) {
      const instructions = settings["instructions"];
      const kept = instructions.filter((entry) => entry !== "rules/*.md");
      if (kept.length !== instructions.length) {
        if (kept.length) settings["instructions"] = kept;
        else {
          delete settings["instructions"];
          excluded.push("instructions");
        }
      }
    }

    const scrubbed = scrubSettings(settings);
    items.push({
      kind: "settings",
      name: source.name,
      source: "opencode",
      path: source.file,
      format: "json",
      value: scrubbed.value,
      excluded,
      secrets: scrubbed.secrets,
      hash: hashJson(scrubbed.value),
    });
  }
}

export async function scanOpencode(home: string, ctx: ScanContext): Promise<ScanResult> {
  const items: FoundItem[] = [];
  const diagnostics: Diagnostic[] = [];
  await scanAgents(home, ctx, items, diagnostics);
  await scanInstructions(home, ctx, items, diagnostics);
  await scanMcp(home, ctx, items, diagnostics);
  await scanSettings(home, ctx, items, diagnostics);
  return { items, diagnostics };
}
