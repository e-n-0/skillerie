import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Capabilities, Environment, HarnessPaths, ResolvedContext } from "../../core/types.js";

export const capabilities: Capabilities = {
  toolMap: {
    Read: "read",
    Write: "write",
    Edit: "edit",
    Bash: "bash",
    Grep: "bash",
    Glob: "bash",
    WebSearch: "web_search",
    WebFetch: "webfetch",
    AskUserQuestion: "ask_user_question",
    Task: "task",
    Agent: "task",
    Skill: "read",
    TodoWrite: "todo",
  },
  questionLimits: {
    maxHeaderLength: 12,
    maxOptions: 4,
    maxQuestions: 4,
    multiSelect: true,
  },
  // Denying write/edit does not prevent writes through bash or extension tools.
  permissionEnforcement: { toolAllowlist: false, readOnly: false, noShell: false },
  nativeAgentReplacements: { Explore: "explore" },
  supportsCommands: false,
  supportsRules: true,
};

export function defaultPaths(env: Environment): HarnessPaths {
  const home = resolve(env["HOME"] || homedir(), ".omo");
  const agentsDir = resolve(env["OMO_CODING_AGENT_DIR"] || join(home, "agent"));
  return {
    home,
    configDir: home,
    agentsDir,
    skillsDir: join(agentsDir, "skills"),
    rulesDir: agentsDir,
    assetsDir: agentsDir,
  };
}

/** Agent content can be relocated independently of the runtime configuration. */
export function agentDirectory(ctx: ResolvedContext): string {
  const configured = ctx.snapshot.config.harnesses.omo?.options["agentDir"];
  return typeof configured === "string" ? configured : ctx.paths.agentsDir;
}
