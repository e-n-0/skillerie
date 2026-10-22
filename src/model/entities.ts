import { basename, dirname, extname } from "node:path";
import type {
  Agent,
  Diagnostic,
  Entity,
  EntitySource,
  HarnessId,
  Rule,
  Skill,
} from "../core/types.js";
import { parseFrontmatter } from "./frontmatter.js";
import type { SourceFile } from "./files.js";
import { relativePath, within } from "./files.js";
import {
  agentSchema,
  capDescription,
  externalSkillSchema,
  ruleSchema,
  skillSchema,
  validateFields,
  type RuleFields,
} from "./schema.js";

const authoredRules = new WeakMap<Rule, RuleFields>();
export function authoredRule(rule: Rule): RuleFields {
  return (
    authoredRules.get(rule) ?? {
      paths: rule.paths,
      ...(rule.requires ? { requires: rule.requires } : {}),
    }
  );
}

export interface EntityInventory {
  readonly skills: readonly Skill[];
  readonly agents: readonly Agent[];
  readonly rules: readonly Rule[];
}

export interface EntityInput {
  readonly source: EntitySource;
  readonly harness?: HarnessId;
  /** Restrict external discovery to selected immediate skill roots. */
  readonly skillRoots?: readonly string[];
  /** A single external skill can live at a repository root named by its commit. */
  readonly namedRoot?: string;
  readonly diagnostics: Diagnostic[];
}

function provenance(file: SourceFile, name: string, input: EntityInput): Entity {
  return {
    name,
    file: file.sourcePath,
    source: input.source,
    harnesses: [],
    ...(input.harness ? { harness: input.harness } : {}),
  };
}

function validName(name: string, file: string, diagnostics: Diagnostic[]): boolean {
  if (name.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return true;
  diagnostics.push({
    severity: "error",
    code: "source.name",
    message: "Names must be lowercase hyphenated tokens of at most 64 characters.",
    file,
    jsonPath: "/name",
  });
  return false;
}

function matchesName(
  authored: string | undefined,
  expected: Pick<Entity, "name" | "file">,
  diagnostics: Diagnostic[],
): boolean {
  if (authored === undefined || authored === expected.name) return true;
  diagnostics.push({
    severity: "error",
    code: "source.name-mismatch",
    message: `Name must match ${expected.name}.`,
    file: expected.file,
    jsonPath: "/name",
  });
  return false;
}

export function readSkills(files: readonly SourceFile[], input: EntityInput): readonly Skill[] {
  const skills: Skill[] = [];
  const roots = files
    .filter((file) => basename(file.sourcePath) === "SKILL.md")
    .map((file) => dirname(file.sourcePath));
  for (const file of files.filter((entry) => basename(entry.sourcePath) === "SKILL.md")) {
    const dir = dirname(file.sourcePath);
    if (input.skillRoots && !input.skillRoots.includes(dir)) continue;
    const parsed = parseFrontmatter(file.content.toString("utf8"), file.sourcePath);
    input.diagnostics.push(...parsed.diagnostics);
    if (!parsed.frontmatter) {
      if (!parsed.diagnostics.length)
        input.diagnostics.push({
          severity: "error",
          code: "source.frontmatter",
          message: "Skill frontmatter is required.",
          file: file.sourcePath,
          line: 1,
        });
      continue;
    }
    const result = validateFields(
      input.source === "external" ? externalSkillSchema : skillSchema,
      parsed.frontmatter,
      file.sourcePath,
    );
    input.diagnostics.push(...result.diagnostics);
    const frontmatter = result.value;
    const name = input.namedRoot === dir ? (frontmatter?.name ?? basename(dir)) : basename(dir);
    if (
      !frontmatter ||
      !validName(name, file.sourcePath, input.diagnostics) ||
      !matchesName(frontmatter.name, { name, file: file.sourcePath }, input.diagnostics)
    )
      continue;
    const descendants = roots.filter((root) => root !== dir && within(dir, root));
    const supportFiles = files
      .filter((entry) => {
        const rel = relativePath(dir, entry.sourcePath);
        return (
          rel !== "SKILL.md" &&
          within(dir, entry.sourcePath) &&
          !descendants.some((root) => within(root, entry.sourcePath))
        );
      })
      .map((entry) => ({
        sourcePath: entry.sourcePath,
        relPath: relativePath(dir, entry.sourcePath),
        mode: entry.mode,
      }));
    skills.push({
      ...provenance(file, name, input),
      dir,
      body: parsed.body,
      supportFiles,
      frontmatter: { ...frontmatter, description: capDescription(frontmatter.description) },
      ...(frontmatter.requires ? { requires: frontmatter.requires } : {}),
    });
  }
  return skills;
}

export function readAgents(files: readonly SourceFile[], input: EntityInput): readonly Agent[] {
  const agents: Agent[] = [];
  for (const file of files.filter((entry) => extname(entry.sourcePath) === ".md")) {
    const name = basename(file.sourcePath, ".md");
    const parsed = parseFrontmatter(file.content.toString("utf8"), file.sourcePath);
    input.diagnostics.push(...parsed.diagnostics);
    if (!parsed.frontmatter) {
      if (!parsed.diagnostics.length)
        input.diagnostics.push({
          severity: "error",
          code: "source.frontmatter",
          message: "Agent frontmatter is required.",
          file: file.sourcePath,
          line: 1,
        });
      continue;
    }
    const result = validateFields(agentSchema, parsed.frontmatter, file.sourcePath);
    input.diagnostics.push(...result.diagnostics);
    const frontmatter = result.value;
    if (
      !frontmatter ||
      !validName(name, file.sourcePath, input.diagnostics) ||
      !matchesName(frontmatter.name, { name, file: file.sourcePath }, input.diagnostics)
    )
      continue;
    agents.push({
      ...provenance(file, name, input),
      body: parsed.body,
      frontmatter: { ...frontmatter, description: capDescription(frontmatter.description) },
      ...(frontmatter.requires ? { requires: frontmatter.requires } : {}),
    });
  }
  return agents;
}

export function readRules(files: readonly SourceFile[], input: EntityInput): readonly Rule[] {
  const rules: Rule[] = [];
  for (const file of files.filter(
    (entry) => !entry.relPath.includes("/") && extname(entry.sourcePath) === ".md",
  )) {
    const name = basename(file.sourcePath, ".md");
    const parsed = parseFrontmatter(file.content.toString("utf8"), file.sourcePath);
    input.diagnostics.push(...parsed.diagnostics);
    if (parsed.diagnostics.length) continue;
    const result = validateFields(ruleSchema, parsed.frontmatter ?? {}, file.sourcePath);
    input.diagnostics.push(...result.diagnostics);
    const fields = result.value;
    if (
      !fields ||
      !validName(name, file.sourcePath, input.diagnostics) ||
      !matchesName(fields.name, { name, file: file.sourcePath }, input.diagnostics)
    )
      continue;
    const rule: Rule = {
      ...provenance(file, name, input),
      body: parsed.body,
      paths: fields.paths ?? [],
      ...(fields.requires ? { requires: fields.requires } : {}),
    };
    authoredRules.set(rule, fields);
    rules.push(rule);
  }
  return rules;
}
