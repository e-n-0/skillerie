import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type {
  Adapter,
  Action,
  Environment,
  HarnessPaths,
  ResolvedContext,
} from "../../core/types.js";
import { capabilities } from "./capabilities.js";
import { check } from "./check.js";
import { render } from "./render.js";

function defaultPaths(env: Environment): HarnessPaths {
  const home = resolve(
    env["PI_CODING_AGENT_DIR"] ?? join(env["HOME"] ?? homedir(), ".pi", "agent"),
  );
  return {
    home,
    configDir: home,
    skillsDir: join(home, "skills"),
    agentsDir: join(home, "agents"),
    rulesDir: join(home, "rules"),
    assetsDir: join(home, "extensions"),
  };
}

function targets(ctx: ResolvedContext, generationDir: string): readonly Action[] {
  const generation = join(generationDir, "pi");
  return [
    ...["settings.json", "mcp.json", "AGENTS.md"].map((name): Action => ({
      kind: "link",
      source: join(generation, name),
      target: join(ctx.paths.configDir, name),
    })),
    ...(
      [
        ["skills", ctx.paths.skillsDir],
        ["agents", ctx.paths.agentsDir],
        ["extensions", ctx.paths.assetsDir],
      ] as const
    ).map(([name, target]): Action => ({
      kind: "exclusiveTree",
      source: join(generation, name),
      target,
      preserve: [],
    })),
  ];
}

export const adapter: Adapter = {
  id: "pi",
  supportedRange: ">=0.85.0",
  capabilities,
  defaultPaths,
  render,
  targets,
  check,
};
