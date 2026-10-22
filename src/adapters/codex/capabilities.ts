import type { Capabilities } from "../../core/types.js";

export const capabilities: Capabilities = {
  toolMap: {
    Read: "exec_command",
    Write: "apply_patch",
    Edit: "apply_patch",
    MultiEdit: "apply_patch",
    Bash: "exec_command",
    Grep: "exec_command",
    Glob: "exec_command",
    LS: "exec_command",
    WebSearch: "web.run",
    WebFetch: "web.run",
    Task: "spawn_agent",
    Agent: "spawn_agent",
    AskUserQuestion: "request_user_input",
    TodoWrite: "update_plan",
  },
  questionLimits: {
    maxHeaderLength: 12,
    maxOptions: 3,
    maxQuestions: 3,
    multiSelect: false,
  },
  permissionEnforcement: { toolAllowlist: false, readOnly: false, noShell: false },
  nativeAgentReplacements: { Explore: "explorer", Plan: "default" },
  supportsCommands: false,
  supportsRules: true,
};
