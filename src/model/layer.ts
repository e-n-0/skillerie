import { extname, join } from "node:path";
import type {
  Asset,
  Diagnostic,
  Entity,
  HarnessMap,
  HarnessTemplates,
  Instructions,
  McpConfig,
  Seed,
  SupportFile,
} from "../core/types.js";
import type { ResolvedSourcePaths, SourcePathName } from "../config/sources.js";
import { readAgents, readRules, readSkills, type EntityInventory } from "./entities.js";
import { readTree, relativePath, type SourceFile } from "./files.js";
import { readMcp } from "./mcp.js";
import { harnessIds } from "./schema.js";

export interface SourceLayer extends EntityInventory {
  readonly instructions?: Instructions;
  readonly mcp?: McpConfig;
  readonly templates: HarnessMap<HarnessTemplates>;
  readonly assets: readonly Asset[];
  readonly seeds: readonly Seed[];
  readonly bin: readonly SupportFile[];
  readonly files: ReadonlyMap<string, SourceFile>;
}

export interface LayerInput {
  readonly root: string;
  readonly sourcePaths: ResolvedSourcePaths;
}

export async function readLayer(
  input: LayerInput,
  diagnostics: Diagnostic[],
): Promise<SourceLayer> {
  const inventory = new Map<string, SourceFile>();
  const directories: string[] = [];
  const read = async (sourcePath: string, directoryExpected: boolean) => {
    const files = await readTree(sourcePath, diagnostics, directories);
    if (
      (directoryExpected && files.some((file) => file.sourcePath === sourcePath)) ||
      (!directoryExpected && directories.includes(sourcePath))
    )
      diagnostics.push({
        severity: "error",
        code: "source.kind",
        message: directoryExpected ? "Expected a source directory." : "Expected a source file.",
        file: sourcePath,
        line: 1,
      });
    for (const file of files) inventory.set(relativePath(input.root, file.sourcePath), file);
    return files;
  };
  const readSource = (name: SourcePathName) =>
    read(input.sourcePaths[name], name !== "instructions" && name !== "mcp");
  const context = { source: "user" as const, diagnostics };
  const skills = [...readSkills(await readSource("skills"), context)];
  const agents = [...readAgents(await readSource("agents"), context)];
  const rules = readRules(await readSource("rules"), context);
  const instructionFiles = await readSource("instructions");
  const instructionFile = instructionFiles.find(
    (file) => file.sourcePath === input.sourcePaths.instructions,
  );
  const instructions = instructionFile
    ? {
        file: instructionFile.sourcePath,
        body: instructionFile.content.toString("utf8"),
        source: context.source,
      }
    : undefined;
  const mcpFiles = await readSource("mcp");
  const mcpFile = mcpFiles.find((file) => file.sourcePath === input.sourcePaths.mcp);
  const mcpResult = mcpFile
    ? readMcp(mcpFile.content.toString("utf8"), mcpFile.sourcePath)
    : undefined;
  diagnostics.push(...(mcpResult?.diagnostics ?? []));
  await read(join(input.root, "skillerie.yaml"), false);
  const bin = (await readSource("bin")).map((file) => ({
    relPath: file.relPath,
    sourcePath: file.sourcePath,
    mode: file.mode,
  }));
  const harnessFiles = await readSource("harnesses");
  const templates: Partial<Record<(typeof harnessIds)[number], HarnessTemplates>> = {};
  const assets: Asset[] = [];
  const seeds: Seed[] = [];
  for (const harness of harnessIds) {
    const scoped = { ...context, source: "harness-scoped" as const, harness };
    const subtree = (kind: string) =>
      harnessFiles
        .filter((file) => file.relPath.startsWith(`${harness}/${kind}/`))
        .map((file) => ({ ...file, relPath: file.relPath.slice(`${harness}/${kind}/`.length) }));
    skills.push(...readSkills(subtree("skills"), scoped));
    agents.push(...readAgents(subtree("agents"), scoped));
    const templateFiles = subtree("templates");
    if (templateFiles.length)
      templates[harness] = {
        harness,
        files: templateFiles
          .toSorted((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0))
          .map((file) => {
            const extension = extname(file.sourcePath).slice(1);
            const format =
              extension === "json" || extension === "jsonc" || extension === "toml"
                ? extension
                : "text";
            return {
              file: file.sourcePath,
              relPath: file.relPath,
              format,
              content: file.content.toString("utf8"),
            };
          }),
      };
    for (const file of subtree("seeds"))
      seeds.push({
        harness,
        sourcePath: file.sourcePath,
        relPath: file.relPath,
        mode: file.mode,
      });
    const assetRoot = join(input.sourcePaths.harnesses, harness, "assets");
    const assetNames = new Set([
      ...subtree("assets").map((file) => file.relPath.split("/")[0]),
      ...directories
        .filter(
          (path) =>
            relativePath(assetRoot, path) !== ".." &&
            !relativePath(assetRoot, path).startsWith("../"),
        )
        .map((path) => relativePath(assetRoot, path).split("/")[0]),
    ]);
    for (const name of assetNames) {
      if (!name) continue;
      const sourcePath = join(input.sourcePaths.harnesses, harness, "assets", name);
      assets.push({
        name,
        file: sourcePath,
        sourcePath,
        relPath: name,
        source: context.source,
        harness,
        harnesses: [],
        kind: subtree("assets").some((file) => file.relPath === name) ? "file" : "directory",
      });
    }
  }
  for (const [kind, entities] of [
    ["skill", skills],
    ["agent", agents],
    ["rule", rules],
  ] as const) {
    const seen = new Set<string>();
    for (const entity of entities) {
      const name = entity.name.toLowerCase();
      if (seen.has(name))
        diagnostics.push({
          severity: "error",
          code: "source.duplicate",
          message: `Duplicate ${kind} name: ${entity.name}.`,
          file: entity.file,
          jsonPath: "/name",
        });
      seen.add(name);
    }
  }
  const byName = (left: Entity, right: Entity) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  return {
    skills: skills.toSorted(byName),
    agents: agents.toSorted(byName),
    rules: rules.toSorted(byName),
    templates,
    assets,
    seeds,
    bin,
    files: inventory,
    ...(instructions ? { instructions } : {}),
    ...(mcpResult?.mcp ? { mcp: mcpResult.mcp } : {}),
  };
}
