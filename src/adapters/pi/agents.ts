import type { Agent, Diagnostic, JsonObject, RenderedFile } from "../../core/types.js";
import { capabilities, generalTools, parentRelay } from "./capabilities.js";
import { rewriteMarkdown } from "./markdown.js";

const droppedTools = new Set([
  "task",
  "agent",
  "askuserquestion",
  "ask_user_question",
  "skill",
  "subagent",
]);
const builtins: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(capabilities.toolMap).map(([name, native]) => [name.toLowerCase(), native]),
);

export function normalizeTools(tools: string | readonly string[]): readonly string[] {
  const entries = typeof tools === "string" ? tools.split(",") : tools;
  return [
    ...new Set(
      entries.flatMap((entry) => {
        const name = entry.trim();
        if (!name || droppedTools.has(name.toLowerCase())) return [];
        if (name.startsWith("mcp__")) return ["mcp"];
        return [builtins[name.toLowerCase()] ?? name];
      }),
    ),
  ];
}

export function renderAgent(
  agent: Agent,
  skillNames: readonly string[] = [],
): {
  readonly file: RenderedFile;
  readonly diagnostics: readonly Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const requested = agent.frontmatter.allowed_tools;
  const fields = agent.frontmatter;
  if (fields.readOnly)
    diagnostics.push({
      severity: "error",
      code: "pi.permission",
      message: `Pi cannot enforce a filesystem read-only restriction for ${agent.name}.`,
      file: agent.file,
      jsonPath: "/frontmatter/readOnly",
    });
  const authored = typeof requested === "string" ? requested.split(",") : (requested ?? []);
  if (authored.some((tool) => /[()*]/.test(tool) || tool.trim().startsWith("mcp__")))
    // Scoped entries widen to the whole tool on Pi; warn instead of blocking (allowed_tools is a hint).
    diagnostics.push({
      severity: "warn",
      code: "pi.permission.unenforced",
      message: `Pi cannot enforce scoped tool restrictions for ${agent.name}; scoped entries grant the whole tool.`,
      file: agent.file,
      jsonPath: "/frontmatter/allowed_tools",
    });
  const selected =
    requested === undefined
      ? fields.noShell
        ? generalTools
        : undefined
      : normalizeTools(requested);
  const tools = fields.noShell ? selected?.filter((tool) => tool !== "bash") : selected;
  const metadata: JsonObject = {
    name: fields.name,
    description: fields.description,
    ...(tools === undefined ? {} : { tools: tools.join(", ") }),
    ...(fields.skills === undefined ? {} : { skills: fields.skills }),
    ...(fields.maxTurns === undefined ? {} : { maxTurns: fields.maxTurns }),
  };
  const rewritten = rewriteMarkdown(agent.body, {
    file: agent.file,
    childAgent: true,
    skillNames,
  });
  diagnostics.push(...rewritten.diagnostics);
  const header = Object.entries(metadata)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n");
  return {
    file: {
      kind: "file",
      relPath: `agents/${agent.name}.md`,
      content: `---\n${header}\n---\n\n${rewritten.text.trim()}\n\n${parentRelay}\n`,
      mode: 0o644,
    },
    diagnostics,
  };
}

export function generalAgent(): RenderedFile {
  return {
    kind: "file",
    relPath: "agents/general-purpose.md",
    content: [
      "---",
      'name: "general-purpose"',
      'description: "Handles a delegated implementation or investigation task."',
      `tools: ${JSON.stringify(generalTools.join(", "))}`,
      "---",
      "",
      "Complete the delegated task, verify the result, and report concrete outcomes.",
      "Keep user edits outside the task untouched. Put deliverables at the output paths " +
        "specified in the task. Investigate the available sources before asking for missing " +
        "information. Explain any blocker and which work remains unfinished.",
      "",
      parentRelay,
      "",
    ].join("\n"),
    mode: 0o644,
  };
}
