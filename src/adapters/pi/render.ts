import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import type {
  Diagnostic,
  JsonObject,
  RenderedFile,
  RenderResult,
  ResolvedContext,
} from "../../core/types.js";
import { readTree } from "../../model/files.js";
import { isJsonObject } from "../../model/json.js";
import { resolveMcpServers } from "../../model/index.js";
import { generalAgent, renderAgent } from "./agents.js";
import { rewriteMarkdown } from "./markdown.js";

export async function render(ctx: ResolvedContext): Promise<RenderResult> {
  const files: RenderedFile[] = [];
  const diagnostics: Diagnostic[] = [];
  const sources = ctx.model.harnesses.pi;
  const skillNames = (sources?.skills ?? []).map((skill) => skill.name);
  for (const skill of sources?.skills ?? []) {
    const rewrite = (text: string, file: string): string => {
      const result = rewriteMarkdown(text, {
        file,
        skillDir: relative(ctx.model.repoDir, skill.dir).replaceAll("\\", "/"),
        skillNames,
      });
      diagnostics.push(...result.diagnostics);
      return result.text;
    };
    const frontmatter = [
      `name: ${JSON.stringify(skill.frontmatter.name)}`,
      `description: ${JSON.stringify(skill.frontmatter.description)}`,
      ...(skill.frontmatter["disable-model-invocation"] ? ["disable-model-invocation: true"] : []),
    ].join("\n");
    files.push({
      kind: "file",
      relPath: `skills/${skill.name}/SKILL.md`,
      content: `---\n${frontmatter}\n---\n${rewrite(skill.body, skill.file)}`,
      mode: 0o644,
    });
    for (const support of skill.supportFiles) {
      const content = await readFile(support.sourcePath);
      files.push({
        kind: "file",
        relPath: `skills/${skill.name}/${support.relPath}`,
        content: /\.md$/i.test(support.relPath)
          ? rewrite(content.toString("utf8"), support.sourcePath)
          : content,
        mode: support.mode,
      });
    }
  }
  for (const agent of sources?.agents ?? []) {
    const result = renderAgent(agent, skillNames);
    diagnostics.push(...result.diagnostics);
    if (agent.name !== "general-purpose") files.push(result.file);
    else if (agent.frontmatter.allowed_tools !== undefined || agent.frontmatter.noShell)
      diagnostics.push({
        severity: "error",
        code: "pi.permission",
        message: "The generated general-purpose agent cannot replace a restricted source agent.",
        file: agent.file,
        jsonPath: "/frontmatter",
      });
  }
  files.push(generalAgent());
  const instructionParts: string[] = [];
  const instructions = ctx.model.instructions;
  if (instructions) {
    const result = rewriteMarkdown(instructions.body, {
      file: instructions.file,
      skillNames,
    });
    diagnostics.push(...result.diagnostics);
    instructionParts.push(result.text.trim());
  }
  for (const rule of sources?.rules ?? []) {
    const result = rewriteMarkdown(rule.body, { file: rule.file, skillNames });
    diagnostics.push(...result.diagnostics);
    const scope = rule.paths.length
      ? `Applies to paths: ${rule.paths.map((path) => JSON.stringify(path)).join(", ")}.\n\n`
      : "";
    instructionParts.push(`<!-- rule: ${rule.name} -->\n${scope}${result.text.trim()}`);
  }
  files.push({
    kind: "file",
    relPath: "AGENTS.md",
    content: `${instructionParts.filter(Boolean).join("\n\n")}\n`,
    mode: 0o644,
  });
  const mcpTemplate = ctx.model.templates.pi?.files.find((file) => file.relPath === "mcp.json");
  let templateSettings: JsonObject | undefined;
  let serverDefaults: JsonObject = {};
  if (mcpTemplate) {
    try {
      const parsed: unknown = JSON.parse(mcpTemplate.content);
      if (!isJsonObject(parsed)) {
        diagnostics.push({
          severity: "error",
          code: "pi.mcpTemplate",
          message: "Pi MCP template must be a JSON object.",
          file: mcpTemplate.file,
          jsonPath: "",
        });
      } else {
        const settings = parsed["settings"];
        const defaults = parsed["serverDefaults"];
        if (settings !== undefined) {
          if (isJsonObject(settings)) templateSettings = settings;
          else
            diagnostics.push({
              severity: "error",
              code: "pi.mcpTemplate",
              message: "Pi MCP template settings must be a JSON object.",
              file: mcpTemplate.file,
              jsonPath: "/settings",
            });
        }
        if (defaults !== undefined) {
          if (isJsonObject(defaults)) serverDefaults = defaults;
          else
            diagnostics.push({
              severity: "error",
              code: "pi.mcpTemplate",
              message: "Pi MCP template serverDefaults must be a JSON object.",
              file: mcpTemplate.file,
              jsonPath: "/serverDefaults",
            });
        }
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      const position = /position (\d+)/.exec(error.message)?.[1];
      diagnostics.push({
        severity: "error",
        code: "pi.mcpTemplate",
        message: error.message,
        file: mcpTemplate.file,
        line:
          position === undefined
            ? 1
            : mcpTemplate.content.slice(0, Number(position)).split("\n").length,
      });
    }
  }
  const sourceSettings = ctx.model.mcp?.settings ?? {};
  const mcpSettings = { ...templateSettings, ...sourceSettings };
  const servers = ctx.model.mcp ? resolveMcpServers(ctx.model.mcp, "pi") : {};
  files.push({
    kind: "file",
    relPath: "mcp.json",
    content: `${JSON.stringify(
      {
        mcpServers: Object.fromEntries(
          Object.entries(servers).map(([name, server]) => [name, { ...serverDefaults, ...server }]),
        ),
        ...(templateSettings !== undefined || Object.keys(sourceSettings).length > 0
          ? { settings: mcpSettings }
          : {}),
      },
      null,
      2,
    )}\n`,
    mode: 0o644,
  });
  const settings = ctx.model.templates.pi?.files.find((file) => file.relPath === "settings.json");
  files.push({
    kind: "file",
    relPath: "settings.json",
    content: settings?.content ?? '{\n  "enableSkillCommands": true\n}\n',
    mode: 0o644,
  });
  for (const asset of sources?.assets ?? []) {
    if (asset.relPath !== "extensions" && !asset.relPath.startsWith("extensions/")) continue;
    for (const file of await readTree(asset.sourcePath, diagnostics)) {
      files.push({
        kind: "file",
        relPath: file.relPath ? `${asset.relPath}/${file.relPath}` : asset.relPath,
        content: file.content,
        mode: file.mode,
      });
    }
  }
  return {
    files: files.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0)),
    diagnostics,
    metadata: { harness: "pi" },
  };
}
