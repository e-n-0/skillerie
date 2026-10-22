import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { stringify } from "yaml";
import type { Diagnostic, RenderedFile, Skill } from "../../core/types.js";
import { convertText } from "./dialect.js";

export function skillInterface(skill: Skill): string {
  const description = skill.frontmatter.description;
  const sentence = description.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? description;
  const action = description
    .replace(
      /^Use when\s+(?:(?:the\s+)?user\s+(?:wants?\s+to|needs?\s+to)\s+|you\s+(?:want|need)\s+to\s+)?/i,
      "",
    )
    .replace(/[.!?]$/, "");
  const prefix = `Use $${skill.name} to `;
  return stringify({
    interface: {
      display_name: skill.name
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
      short_description: sentence.slice(0, 80),
      default_prompt: `${prefix}${action}`.slice(0, 120),
    },
    ...(skill.frontmatter["disable-model-invocation"] === true
      ? { policy: { allow_implicit_invocation: false } }
      : {}),
  });
}

export async function renderSkill(
  skill: Skill,
  repoDir: string,
): Promise<{
  readonly files: readonly RenderedFile[];
  readonly diagnostics: readonly Diagnostic[];
}> {
  const context = { file: skill.file, skillDir: relative(repoDir, skill.dir) };
  const body = convertText(skill.body, context);
  const diagnostics = [...body.diagnostics];
  const root = `skills/${skill.name}`;
  const files: RenderedFile[] = [
    {
      kind: "file",
      relPath: `${root}/SKILL.md`,
      content: `---\nname: ${JSON.stringify(skill.name)}\ndescription: ${JSON.stringify(skill.frontmatter.description)}\n---\n${body.text}`,
      mode: 0o644,
    },
    {
      kind: "file",
      relPath: `${root}/agents/openai.yaml`,
      content: skillInterface(skill),
      mode: 0o644,
    },
  ];
  for (const support of skill.supportFiles) {
    if (support.relPath === "agents/openai.yaml") continue;
    const content = await readFile(support.sourcePath);
    const converted = /\.md$/i.test(support.relPath)
      ? convertText(content.toString("utf8"), { ...context, file: support.sourcePath })
      : undefined;
    diagnostics.push(...(converted?.diagnostics ?? []));
    files.push({
      kind: "file",
      relPath: `${root}/${support.relPath}`,
      content: converted?.text ?? content,
      mode: support.mode,
    });
  }
  return { files, diagnostics };
}
