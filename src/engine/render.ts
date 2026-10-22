import { isAbsolute, join, relative, resolve } from "node:path";
import type {
  Adapter,
  Agent,
  Diagnostic,
  Environment,
  HarnessId,
  HarnessPaths,
  InputSnapshot,
  RenderedFile,
  ResolvedContext,
  SourceModel,
} from "../core/types.js";
import { externalDiagnostics, skillDiagnosticSources } from "./diagnostics.js";

/** Relocate adapter defaults while honoring the configured runtime root. */
function pathsFor(adapter: Adapter, snapshot: InputSnapshot, env: Environment): HarnessPaths {
  const defaults = adapter.defaultPaths(env);
  const config = snapshot.config.harnesses[adapter.id];
  const home = config?.path ?? defaults.home;
  const relocate = (path: string) => resolve(home, relative(defaults.home, path));
  const agentDir = config?.options["agentDir"];
  const agentsDir =
    adapter.id === "omo" && typeof agentDir === "string" ? agentDir : relocate(defaults.agentsDir);
  return {
    home,
    configDir: relocate(defaults.configDir),
    skillsDir: relocate(defaults.skillsDir),
    agentsDir,
    rulesDir: relocate(defaults.rulesDir),
    assetsDir: relocate(defaults.assetsDir),
    ...(defaults.commandsDir ? { commandsDir: relocate(defaults.commandsDir) } : {}),
  };
}

interface RenderInput {
  readonly snapshot: InputSnapshot;
  readonly model: SourceModel;
  readonly env: Environment;
}

export function contextFor(adapter: Adapter, input: RenderInput): ResolvedContext {
  return {
    ...input,
    harness: adapter.id,
    paths: pathsFor(adapter, input.snapshot, input.env),
    harnessVersion: { supportedRange: adapter.supportedRange },
  };
}

export async function renderHarness(adapter: Adapter, input: RenderInput) {
  const result = await adapter.render(contextFor(adapter, input));
  const files: RenderedFile[] = [];
  const diagnostics: Diagnostic[] = result.diagnostics.map((item) => ({
    ...item,
    file: item.file ?? join(input.model.repoDir, "skillerie.yaml"),
    ...(item.line === undefined && item.jsonPath === undefined
      ? { jsonPath: `/harnesses/${adapter.id}` }
      : {}),
  }));
  const seen = new Set<string>();
  for (const file of result.files) {
    const parts = file.relPath.split("/");
    if (
      !file.relPath ||
      isAbsolute(file.relPath) ||
      file.relPath.includes("\\") ||
      file.relPath.includes("\0") ||
      parts.some((part) => part === "" || part === "." || part === "..") ||
      seen.has(file.relPath)
    ) {
      diagnostics.push({
        severity: "error",
        code: "engine.renderPath",
        message: `Adapter ${adapter.id} returned an invalid or duplicate relative path.`,
        file: join(input.model.repoDir, "skillerie.yaml"),
        jsonPath: `/harnesses/${adapter.id}`,
      });
      continue;
    }
    seen.add(file.relPath);
    files.push({ ...file, relPath: `${adapter.id}/${file.relPath}` });
  }
  return {
    files,
    diagnostics: externalDiagnostics(diagnostics, skillDiagnosticSources(input.model)),
  };
}

export function restrictionDiagnostics(
  adapters: readonly Adapter[],
  model: SourceModel,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const guidance = new Map<string, { readonly agent: Agent; readonly harnesses: HarnessId[] }>();
  for (const adapter of adapters) {
    const sources = model.harnesses[adapter.id];
    for (const agent of sources?.agents ?? []) {
      if (
        agent.frontmatter.allowed_tools !== undefined &&
        !adapter.capabilities.permissionEnforcement.toolAllowlist
      ) {
        const entry = guidance.get(agent.name) ?? { agent, harnesses: [] };
        entry.harnesses.push(adapter.id);
        guidance.set(agent.name, entry);
      }
      const restrictions = [
        ["readOnly", agent.frontmatter.readOnly === true, "readOnly"],
        ["noShell", agent.frontmatter.noShell === true, "noShell"],
      ] as const;
      for (const [capability, requested, field] of restrictions)
        if (requested && !adapter.capabilities.permissionEnforcement[capability])
          diagnostics.push({
            severity: "error",
            code: "engine.permission",
            message: `Harness ${adapter.id} cannot enforce ${field} for agent ${agent.name}.`,
            file: agent.file,
            jsonPath: `/frontmatter/${field}`,
          });
    }
  }
  for (const { agent, harnesses } of guidance.values())
    diagnostics.push({
      severity: "warn",
      code: "engine.permission.unenforced",
      message: `allowed_tools for agent "${agent.name}" is guidance only on ${harnesses.join(", ")}; those harnesses cannot enforce it.`,
      file: agent.file,
      jsonPath: "/frontmatter/allowed_tools",
    });
  return diagnostics;
}

export function isHarness(value: string): value is HarnessId {
  return value === "opencode" || value === "codex" || value === "omo" || value === "pi";
}
