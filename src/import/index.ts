import { homedir } from "node:os";
import { realpathSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse, type ParseError } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import { registry } from "../adapters/index.js";
import { configDocument } from "../config/document.js";
import { loadConfig } from "../config/index.js";
import type { ResolvedSourcePaths } from "../config/sources.js";
import type { Diagnostic, HarnessId, JsonObject } from "../core/types.js";
import { HARNESS_IDS, hasErrors } from "../engine/types.js";
import type { EngineOptions, ValidationResult } from "../engine/types.js";
import { validateRepo } from "../engine/validation.js";
import { scaffoldFiles } from "../init/templates.js";
import { readManifest } from "../install/storage.js";
import { isJsonObject } from "../model/json.js";
import { scanClaude } from "./claude.js";
import { scanCodex } from "./codex.js";
import { scanOmo } from "./omo.js";
import { scanOpencode } from "./opencode.js";
import { scanPi } from "./pi.js";
import { failureReason, hashFiles, hashJson, hashText } from "./shared.js";
import { scanSkillDirectories } from "./skills.js";
import type { FoundItem, ImportSource, ImportWrite, InventoryEntry, ScanContext } from "./types.js";
import { writeImport } from "./write.js";

const kindOrder = { skill: 0, agent: 1, mcp: 2, instructions: 3, settings: 4 } as const;
const sourceOrder = { opencode: 0, codex: 1, omo: 2, pi: 3, agents: 4, claude: 5 } as const;

function missing(error: Error): boolean {
  return "code" in error && error.code === "ENOENT";
}

function readDiagnostic(file: string, error: Error, code = "import.read"): Diagnostic {
  return { severity: "warn", code, message: failureReason(error), file };
}

function realPath(path: string, diagnostics: Diagnostic[]): string | undefined {
  try {
    return realpathSync(path);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (!missing(error)) diagnostics.push(readDiagnostic(path, error));
    return undefined;
  }
}

async function skillHash(root: string): Promise<string> {
  const files: { readonly relPath: string; readonly content: Buffer }[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else
        files.push({
          relPath: relative(root, path).split(sep).join("/"),
          content: await readFile(path),
        });
    }
  }
  await visit(root);
  return hashFiles(files);
}

async function repositoryStates(
  groups: readonly (readonly FoundItem[])[],
  sources: ResolvedSourcePaths,
  diagnostics: Diagnostic[],
): Promise<readonly InventoryEntry[]> {
  let servers: JsonObject = {};
  let settings: unknown;
  let invalidMcp = false;
  const hasMcpSettings = groups.some(
    (copies) => copies[0]?.kind === "settings" && copies[0].name === "mcp-settings",
  );
  if (hasMcpSettings || groups.some((copies) => copies[0]?.kind === "mcp")) {
    try {
      const errors: ParseError[] = [];
      const value: unknown = parse(await readFile(sources.mcp, "utf8"), errors, {
        allowTrailingComma: true,
      });
      if (
        errors.length ||
        !isJsonObject(value) ||
        (value["mcpServers"] !== undefined && !isJsonObject(value["mcpServers"]))
      )
        throw new TypeError("Expected an MCP JSON object with a mcpServers mapping.");
      servers = value["mcpServers"] ?? {};
      settings = value["settings"];
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (!missing(error)) {
        diagnostics.push(
          readDiagnostic(sources.mcp, error, hasMcpSettings ? "import.settings" : "import.read"),
        );
        invalidMcp = true;
      }
    }
  }
  const entries: InventoryEntry[] = [];
  for (const copies of groups) {
    const item = copies[0];
    if (!item) continue;
    let hash: string | undefined;
    let file = sources.instructions;
    let invalid = false;
    try {
      switch (item.kind) {
        case "skill":
          file = join(sources.skills, item.name);
          hash = await skillHash(file);
          break;
        case "agent":
          file = join(sources.agents, `${item.name}.md`);
          hash = hashText(await readFile(file, "utf8"));
          break;
        case "mcp":
          invalid = invalidMcp;
          if (Object.hasOwn(servers, item.name)) hash = hashJson(servers[item.name]);
          break;
        case "instructions": {
          const content = (await readFile(file, "utf8")).trim();
          const template = scaffoldFiles(
            { opencode: false, codex: false, omo: false, pi: false },
            "0.0.0",
            "",
          )["instructions.md"];
          if (content && content !== template?.trim()) hash = hashText(content);
          break;
        }
        case "settings": {
          if (item.name === "mcp-settings") {
            file = sources.mcp;
            invalid = invalidMcp;
            if (settings !== undefined) {
              if (!isJsonObject(settings)) throw new TypeError("Expected an MCP settings object.");
              if (Object.keys(settings).length) hash = hashJson(settings);
            }
            break;
          }
          const slash = item.name.indexOf("/");
          file = join(
            sources.harnesses,
            item.name.slice(0, slash),
            "templates",
            item.name.slice(slash + 1),
          );
          const content = await readFile(file, "utf8");
          const errors: ParseError[] = [];
          const value: unknown =
            item.format === "toml"
              ? parseToml(content)
              : parse(content, errors, { allowTrailingComma: true });
          if (errors.length || (item.format === "json" && !isJsonObject(value)))
            throw new TypeError("Expected a settings object.");
          hash = hashJson(value);
          break;
        }
        default: {
          const exhaustive: never = item;
          return exhaustive;
        }
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (!missing(error)) {
        diagnostics.push(
          readDiagnostic(file, error, item.kind === "settings" ? "import.settings" : "import.read"),
        );
        invalid = true;
      }
    }
    entries.push({
      kind: item.kind,
      name: item.name,
      copies,
      identical: copies.every((copy) => copy.hash === item.hash),
      inRepo: invalid
        ? "different"
        : hash === undefined
          ? "absent"
          : copies.some(
                (copy) =>
                  hash ===
                  (copy.kind === "instructions" ? hashText(copy.content.trim()) : copy.hash),
              )
            ? "same"
            : "different",
    });
  }
  return entries.sort(
    (left, right) =>
      kindOrder[left.kind] - kindOrder[right.kind] ||
      (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
  );
}

/** Read every harness home, including disabled harnesses, without modifying it. */
export async function inventoryRepo(
  repoDir: string,
  options: EngineOptions & { readonly harness?: HarnessId } = {},
): Promise<{
  readonly entries: readonly InventoryEntry[];
  readonly diagnostics: readonly Diagnostic[];
  readonly homes: readonly { readonly source: ImportSource; readonly path: string }[];
}> {
  const env = { ...(options.env ?? process.env) };
  const loaded = await loadConfig(repoDir, env, options);
  const diagnostics = [...loaded.diagnostics];
  const config = loaded.config;
  if (!config || hasErrors(diagnostics)) return { entries: [], diagnostics, homes: [] };
  // Normalization fills in paths even when none were authored. Adapter defaults
  // must still honor harness-specific environment variables in that case.
  const file = resolve(repoDir, "skillerie.yaml");
  let configuredPaths: ReadonlySet<HarnessId>;
  try {
    const parsed = configDocument(await readFile(file, "utf8"), file);
    if (parsed.diagnostics.length)
      return { entries: [], diagnostics: [...diagnostics, ...parsed.diagnostics], homes: [] };
    configuredPaths = new Set(
      HARNESS_IDS.filter((source) => parsed.document.hasIn(["harnesses", source, "path"])),
    );
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { entries: [], diagnostics: [...diagnostics, readDiagnostic(file, error)], homes: [] };
  }
  const homes: { readonly source: ImportSource; readonly path: string }[] = [];
  const skillDirs: { readonly source: ImportSource; readonly dir: string }[] = [];
  const harnessHomes: {
    readonly source: HarnessId;
    readonly path: string;
    readonly agentDir: string;
  }[] = [];
  for (const source of HARNESS_IDS) {
    if (options.harness !== undefined && source !== options.harness) continue;
    const load = options.adapters?.get(source) ?? registry.get(source);
    if (!load) continue;
    const { adapter } = await load();
    const defaults = adapter.defaultPaths(env);
    const harness = config.harnesses[source];
    const path = configuredPaths.has(source) ? (harness?.path ?? defaults.home) : defaults.home;
    const configured = harness?.options["agentDir"];
    const agentDir =
      source === "omo"
        ? typeof configured === "string"
          ? configured
          : resolve(path, relative(defaults.home, defaults.agentsDir))
        : path;
    harnessHomes.push({ source, path, agentDir });
    homes.push({ source, path });
    skillDirs.push({ source, dir: join(agentDir, "skills") });
  }
  if (options.harness === undefined) {
    for (const source of ["agents", "claude"] as const) {
      const path = join(config.paths.home, `.${source}`);
      homes.push({ source, path });
      skillDirs.push({ source, dir: join(path, "skills") });
    }
  }
  const targets = new Set<string>();
  for (const home of harnessHomes) {
    try {
      const manifest = await readManifest(home.path);
      // A merged file stays the user's; scanners already strip skillerie's marked blocks from it.
      for (const entry of manifest?.entries ?? [])
        if (entry.kind !== "merge") targets.add(resolve(entry.target));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      diagnostics.push(readDiagnostic(join(home.path, ".skillerie/manifest.json"), error));
    }
  }
  // Generations of any skillerie repository live under the shared cache root, not only this repo's.
  const cacheRoot = join(
    env["XDG_CACHE_HOME"] || join(env["HOME"] ?? homedir(), ".cache"),
    "skillerie",
  );
  const caches = [config.paths.cache, cacheRoot]
    .map((path) => realPath(path, diagnostics))
    .filter((path): path is string => path !== undefined);
  const ctx: ScanContext = {
    env,
    managed(path) {
      const target = realPath(path, diagnostics);
      if (target === undefined) return false;
      if (targets.has(resolve(path))) return true;
      return caches.some((cache) => {
        const rel = relative(cache, target);
        return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
      });
    },
  };
  const results = [await scanSkillDirectories(skillDirs, ctx)];
  for (const home of harnessHomes) {
    switch (home.source) {
      case "opencode":
        results.push(await scanOpencode(home.path, ctx));
        break;
      case "codex":
        results.push(await scanCodex(home.path, ctx));
        break;
      case "omo":
        results.push(await scanOmo(home.path, home.agentDir, ctx));
        break;
      case "pi":
        results.push(await scanPi(home.path, ctx));
        break;
      default: {
        const exhaustive: never = home.source;
        return exhaustive;
      }
    }
  }
  if (options.harness === undefined)
    results.push(await scanClaude(join(config.paths.home, ".claude"), ctx));
  const groups = new Map<string, FoundItem[]>();
  for (const result of results) {
    diagnostics.push(...result.diagnostics);
    for (const item of result.items) {
      const key = `${item.kind}:${item.name}`;
      const copies = groups.get(key) ?? [];
      copies.push(item);
      groups.set(key, copies);
    }
  }
  const copies = [...groups.values()].map((group) =>
    group.sort((left, right) => sourceOrder[left.source] - sourceOrder[right.source]),
  );
  const entries = await repositoryStates(copies, config.sources, diagnostics);
  return { entries, diagnostics, homes };
}

/** Resolve names across kinds; differing copies always require an explicit source. */
export function selectItems(
  entries: readonly InventoryEntry[],
  request: { readonly names?: readonly string[]; readonly all?: boolean },
): {
  readonly items: readonly FoundItem[];
  readonly unknown: readonly string[];
  readonly ambiguous: readonly InventoryEntry[];
  readonly skipped: readonly InventoryEntry[];
} {
  const names = new Set(request.names ?? []);
  const unknown = new Set(names);
  const items: FoundItem[] = [];
  const ambiguous: InventoryEntry[] = [];
  const skipped: InventoryEntry[] = [];
  for (const entry of entries) {
    const explicit = entry.copies.filter((copy) => names.has(`${entry.name}@${copy.source}`));
    if (names.has(entry.name)) unknown.delete(entry.name);
    for (const copy of explicit) unknown.delete(`${entry.name}@${copy.source}`);
    if (!request.all && !names.has(entry.name) && !explicit.length) continue;
    if (entry.inRepo === "same") skipped.push(entry);
    else if (explicit.length) items.push(...explicit);
    else if (!entry.identical) ambiguous.push(entry);
    else {
      const first = entry.copies[0];
      if (first) items.push(first);
    }
  }
  return { items, unknown: [...unknown], ambiguous, skipped };
}

/** Write selected content to configured sources, then validate any actual additions. */
export async function importRepo(
  repoDir: string,
  options: EngineOptions & { readonly items: readonly FoundItem[] },
): Promise<{
  readonly writes: readonly ImportWrite[];
  readonly diagnostics: readonly Diagnostic[];
  readonly validation?: ValidationResult;
}> {
  const env = { ...(options.env ?? process.env) };
  const loaded = await loadConfig(repoDir, env, options);
  if (!loaded.config || hasErrors(loaded.diagnostics))
    return { writes: [], diagnostics: loaded.diagnostics };
  const result = await writeImport({
    repo: loaded.config.paths.repo,
    sources: loaded.config.sources,
    items: options.items,
  });
  const validation = result.writes.some((write) => write.status === "written")
    ? await validateRepo(repoDir, { ...options, env })
    : undefined;
  return {
    writes: result.writes,
    diagnostics: [...loaded.diagnostics, ...result.diagnostics],
    ...(validation === undefined ? {} : { validation }),
  };
}
