import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Adapter } from "../../core/types.js";
import { capabilities } from "./capabilities.js";
import { check } from "./check.js";
import { render } from "./render.js";
import { targets } from "./targets.js";

export const adapter: Adapter = {
  id: "codex",
  supportedRange: ">=0.160.0 <1.0.0",
  capabilities,
  defaultPaths(env) {
    const home = resolve(env["CODEX_HOME"] || join(env["HOME"] ?? homedir(), ".codex"));
    return {
      home,
      configDir: home,
      skillsDir: join(home, "skills"),
      agentsDir: join(home, "agents"),
      rulesDir: join(home, "rules"),
      assetsDir: home,
    };
  },
  render,
  targets,
  check,
};
