import { join } from "node:path";
import type { Action, ResolvedContext } from "../../core/types.js";
import { agentDirectory } from "./capabilities.js";

export function targets(ctx: ResolvedContext, generationDir: string): readonly Action[] {
  const generation = join(generationDir, "omo");
  const root = agentDirectory(ctx);
  const actions: Action[] = [
    {
      kind: "link",
      source: join(generation, "omo.jsonc"),
      target: join(ctx.paths.configDir, "omo.jsonc"),
    },
    ...["AGENTS.md", "mcp.json"].map((name): Action => ({
      kind: "link",
      source: join(generation, name),
      target: join(root, name),
    })),
    {
      kind: "exclusiveTree",
      source: join(generation, "skills"),
      target: join(root, "skills"),
      preserve: [],
    },
  ];
  if (ctx.model.templates.omo?.files.some((entry) => entry.relPath === "models.json")) {
    actions.push({
      kind: "link",
      source: join(generation, "models.json"),
      target: join(root, "models.json"),
    });
  }
  for (const seed of ctx.model.seeds.filter((entry) => entry.harness === "omo")) {
    actions.push({
      kind: "seed",
      source: join(generation, "seeds", seed.relPath),
      target: join(root, seed.relPath),
    });
  }
  for (const asset of ctx.model.harnesses.omo?.assets ?? []) {
    actions.push({
      kind: "link",
      source: join(generation, "assets", asset.relPath),
      target: join(root, asset.relPath),
    });
  }
  const skills = ctx.model.harnesses.omo?.skills ?? [];
  if (ctx.snapshot.config.shared.agentsSkillsDir === "dedupe" && skills.length) {
    actions.push({
      kind: "jsonArrayMerge",
      target: join(root, "settings.json"),
      jsonPath: "/skills",
      blockId: "skillerie.omo.skills",
      values: skills.map((skill) => `!**/${skill.name}/**`).sort(),
    });
  }
  return actions;
}
