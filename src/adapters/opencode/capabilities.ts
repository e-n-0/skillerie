import type { Capabilities } from "../../core/types.js";

export const capabilities: Capabilities = {
  toolMap: {
    Read: "read",
    Write: "write",
    Edit: "edit",
    Grep: "grep",
    Glob: "glob",
    Bash: "bash",
    WebSearch: "websearch",
    WebFetch: "webfetch",
    AskUserQuestion: "question",
    Task: "task",
    Agent: "task",
    Skill: "skill",
    TodoWrite: "todowrite",
  },
  questionLimits: {
    maxHeaderLength: 30,
    maxOptions: null,
    maxQuestions: null,
    multiSelect: true,
  },
  // Denying omitted builtins does not constrain arbitrary plugin/MCP tools.
  // Neither an exact allowlist nor read-only access follows from those denies.
  permissionEnforcement: { toolAllowlist: false, readOnly: false, noShell: true },
  nativeAgentReplacements: { Explore: "explore", "general-purpose": "general" },
  supportsCommands: true,
  supportsRules: true,
};

export const permissionNames = [
  "read",
  "edit",
  "glob",
  "grep",
  "list",
  "bash",
  "task",
  "todowrite",
  "webfetch",
  "websearch",
  "lsp",
  "skill",
  "question",
] as const;
