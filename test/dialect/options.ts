import type { DialectOptions } from "../../src/dialect/index.js";

export const options: DialectOptions = {
  harness: "opencode",
  file: "skills/example/SKILL.md",
  capabilities: {
    toolMap: {
      Read: "read",
      Task: "task",
      Agent: "task",
      Skill: "skill",
      AskUserQuestion: "question",
      WebSearch: "websearch",
    },
    questionLimits: { maxHeaderLength: 12, maxOptions: 3, maxQuestions: 3, multiSelect: false },
    nativeAgentReplacements: {
      Explore: "explore",
      "general-purpose": "general",
      researcher: "librarian",
    },
    permissionEnforcement: { toolAllowlist: true, readOnly: true, noShell: true },
    supportsCommands: true,
    supportsRules: true,
  },
};
