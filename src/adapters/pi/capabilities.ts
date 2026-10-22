import type { Capabilities } from "../../core/types.js";

export const capabilities = {
  toolMap: {
    Read: "read",
    Write: "write",
    Edit: "edit",
    MultiEdit: "edit",
    Grep: "grep",
    Glob: "find",
    LS: "ls",
    Bash: "bash",
    Task: "subagent",
    Agent: "subagent",
    WebSearch: "web_search",
    WebFetch: "web_search",
    AskUserQuestion: "ask_user_question",
  },
  questionLimits: {
    maxHeaderLength: 16,
    maxOptions: 4,
    maxQuestions: 4,
    multiSelect: true,
  },
  // Tool selection can exclude bash, but is not a filesystem sandbox.
  permissionEnforcement: { toolAllowlist: true, readOnly: false, noShell: true },
  nativeAgentReplacements: { Explore: "explorer" },
  supportsCommands: true,
  supportsRules: true,
} as const satisfies Capabilities;

export const generalTools = [
  "read",
  "write",
  "edit",
  "grep",
  "find",
  "bash",
  "mcp",
  "web_search",
] as const;

export const parentRelay =
  "If a decision needs user input, return the question and real choices to the parent agent. " +
  "The parent handles the user interaction; child agents do not have a question tool.";
