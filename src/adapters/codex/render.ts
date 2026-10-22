import { readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { stringify } from "smol-toml";
import type { Diagnostic, RenderedFile, RenderResult, ResolvedContext } from "../../core/types.js";
import { assetFiles } from "./assets.js";
import { configBlocks } from "./config.js";
import { convertText } from "./dialect.js";
import { renderSkill } from "./skills.js";

export async function render(ctx: ResolvedContext): Promise<RenderResult> {
  const sources = ctx.model.harnesses.codex;
  const config = configBlocks(ctx);
  const diagnostics: Diagnostic[] = [...config.diagnostics];
  const files: RenderedFile[] = [
    { kind: "file", relPath: "config.toml", content: config.config, mode: 0o644 },
  ];
  for (const skill of sources?.skills ?? []) {
    const result = await renderSkill(skill, ctx.model.repoDir);
    files.push(...result.files);
    diagnostics.push(...result.diagnostics);
  }
  for (const agent of sources?.agents ?? []) {
    const restrictions = [
      ["readOnly", agent.frontmatter.readOnly === true],
      ["noShell", agent.frontmatter.noShell === true],
    ] as const;
    const requested = restrictions.filter(([, enabled]) => enabled);
    for (const [field] of requested) {
      diagnostics.push({
        severity: "error",
        code: "codex.permission",
        message: `Codex cannot enforce ${field} for agent ${agent.name}.`,
        file: agent.file,
        jsonPath: `/frontmatter/${field}`,
      });
    }
    if (requested.length) continue;
    if (agent.name === "general-purpose") continue;
    const body = convertText(agent.body, { file: agent.file });
    diagnostics.push(...body.diagnostics);
    files.push({
      kind: "file",
      relPath: `agents/${agent.name}.toml`,
      content: stringify({
        name: agent.name,
        description: agent.frontmatter.description,
        developer_instructions: body.text,
      }),
      mode: 0o644,
    });
  }
  files.push({
    kind: "file",
    relPath: "agents/general-purpose.toml",
    content: stringify({
      name: "general-purpose",
      description: "Handles a delegated task from investigation through verification.",
      developer_instructions:
        "Complete the delegated task within its scope. Read the relevant sources, make the " +
        "necessary changes, and verify the result. Leave unrelated user edits intact. " +
        "Write deliverables to any output path the task explicitly requests. " +
        "Check the available sources for answers before requesting clarification. " +
        "Report completed work, verification evidence, and anything blocking completion.",
    }),
    mode: 0o644,
  });
  const instructions: string[] = [];
  if (ctx.model.instructions) {
    const result = convertText(ctx.model.instructions.body, { file: ctx.model.instructions.file });
    diagnostics.push(...result.diagnostics);
    instructions.push(result.text.trim());
  }
  for (const rule of sources?.rules ?? []) {
    const result = convertText(rule.body, { file: rule.file });
    diagnostics.push(...result.diagnostics);
    const path = relative(ctx.model.repoDir, rule.file);
    instructions.push(
      `<!-- Rule: ${path} -->\n${rule.paths.length ? `Applies to: ${rule.paths.map((glob) => `\`${glob}\``).join(", ")}.\n\n` : ""}${result.text.trim()}`,
    );
  }
  files.push({
    kind: "file",
    relPath: "AGENTS.md",
    content: `${instructions.join("\n\n")}\n`,
    mode: 0o644,
  });
  for (const asset of assetFiles(ctx)) {
    files.push({
      kind: "file",
      relPath: asset.relPath,
      content: await readFile(asset.sourcePath),
      mode: (await stat(asset.sourcePath)).mode & 0o777,
    });
  }
  for (const seed of ctx.model.seeds.filter((item) => item.harness === "codex"))
    files.push({
      kind: "file",
      relPath: `seeds/${seed.relPath}`,
      content: await readFile(seed.sourcePath),
      mode: seed.mode,
    });
  for (const template of ctx.model.templates.codex?.files ?? []) {
    if (template.relPath !== "config.toml")
      files.push({
        kind: "file",
        relPath: template.relPath,
        content: template.content,
        mode: 0o644,
      });
  }
  return {
    files,
    diagnostics,
    metadata: {
      managedSettingsBlock: "codex.settings",
      managedMcpBlock: "codex.mcp",
      permissionEnforcement: "inherited",
    },
  };
}
