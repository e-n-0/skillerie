import { join } from "node:path";
import type { Action, ResolvedContext } from "../../core/types.js";
import { assetFiles } from "./assets.js";
import { configBlocks } from "./config.js";

export function targets(ctx: ResolvedContext, generationDir: string): readonly Action[] {
  const root = join(generationDir, "codex");
  const config = configBlocks(ctx);
  const actions: Action[] = [
    { kind: "link", source: join(root, "AGENTS.md"), target: join(ctx.paths.home, "AGENTS.md") },
    {
      kind: "exclusiveTree",
      source: join(root, "skills"),
      target: ctx.paths.skillsDir,
      preserve: [".system"],
    },
    {
      kind: "exclusiveTree",
      source: join(root, "agents"),
      target: ctx.paths.agentsDir,
      preserve: [],
    },
    {
      kind: "mergeBlock",
      format: "toml",
      target: join(ctx.paths.configDir, "config.toml"),
      blockId: "codex.settings",
      content: config.settings,
    },
    {
      kind: "mergeBlock",
      format: "toml",
      target: join(ctx.paths.configDir, "config.toml"),
      blockId: "codex.mcp",
      content: config.mcp,
    },
  ];
  for (const asset of assetFiles(ctx))
    actions.push({
      kind: "link",
      source: join(root, asset.relPath),
      target: asset.relPath.startsWith("rules/")
        ? join(ctx.paths.rulesDir, asset.relPath.slice("rules/".length))
        : join(ctx.paths.home, asset.relPath),
    });
  for (const template of ctx.model.templates.codex?.files ?? [])
    if (template.relPath !== "config.toml")
      actions.push({
        kind: "link",
        source: join(root, template.relPath),
        target: join(ctx.paths.configDir, template.relPath),
      });
  for (const seed of ctx.model.seeds.filter((item) => item.harness === "codex"))
    actions.push({
      kind: "seed",
      source: join(root, "seeds", seed.relPath),
      target: join(ctx.paths.home, seed.relPath),
    });
  return actions;
}
