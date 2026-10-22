import { join } from "node:path";
import type {
  Action,
  Adapter,
  Environment,
  HarnessPaths,
  ResolvedContext,
} from "../../core/types.js";
import { capabilities } from "./capabilities.js";
import { check } from "./check.js";
import { render } from "./render.js";

function defaultPaths(env: Environment): HarnessPaths {
  const home = join(env["XDG_CONFIG_HOME"] || join(env["HOME"] ?? "", ".config"), "opencode");
  return {
    home,
    configDir: home,
    skillsDir: join(home, "skills"),
    agentsDir: join(home, "agents"),
    commandsDir: join(home, "commands"),
    rulesDir: join(home, "rules"),
    assetsDir: home,
  };
}

function targets(ctx: ResolvedContext, generationDir: string): readonly Action[] {
  const generation = join(generationDir, "opencode");
  const trees = {
    skills: ctx.paths.skillsDir,
    agents: ctx.paths.agentsDir,
    commands: ctx.paths.commandsDir ?? join(ctx.paths.home, "commands"),
    plugins: join(ctx.paths.home, "plugins"),
    rules: ctx.paths.rulesDir,
  };
  const links = new Set([
    "opencode.jsonc",
    ...(ctx.model.instructions ? ["AGENTS.md"] : []),
    ...(ctx.model.templates.opencode?.files.map((template) => template.relPath) ?? []),
    ...(ctx.model.harnesses.opencode?.assets
      .filter((asset) => asset.kind === "file")
      .map((asset) => asset.relPath) ?? []),
  ]);
  const actions: Action[] = [...links]
    .filter(
      (name) => !Object.keys(trees).some((tree) => name === tree || name.startsWith(`${tree}/`)),
    )
    .sort()
    .map((name) => ({
      kind: "link",
      source: join(generation, name),
      target: join(ctx.paths.configDir, name),
    }));
  for (const [name, target] of Object.entries(trees))
    actions.push({ kind: "exclusiveTree", source: join(generation, name), target, preserve: [] });
  for (const asset of ctx.model.harnesses.opencode?.assets ?? [])
    if (asset.kind === "directory" && !Object.hasOwn(trees, asset.relPath))
      actions.push({
        kind: "exclusiveTree",
        source: join(generation, asset.relPath),
        target: join(ctx.paths.home, asset.relPath),
        preserve: [],
      });
  return actions;
}

export const adapter: Adapter = {
  id: "opencode",
  capabilities,
  supportedRange: ">=1.1.0 <2.0.0",
  defaultPaths,
  render,
  targets,
  check,
};
