import type {
  Agent,
  Diagnostic,
  HarnessId,
  LintSeverity,
  ResolvedConfig,
  Skill,
  SourceModel,
} from "../core/types.js";

const HARNESS_IDS = ["opencode", "codex", "omo", "pi"] as const satisfies readonly HarnessId[];
const SLASH_REFERENCE = /`\/([a-z][a-z0-9-]*)`/g;

type LintFinding = Omit<Diagnostic, "severity"> & { readonly severity: LintSeverity };
type BodySource = Pick<Skill | Agent, "body" | "file">;

interface ReferenceContext {
  readonly allSkillNames: ReadonlySet<string>;
  readonly applicableSkillNames: ReadonlySet<string>;
  readonly harness: HarnessId;
  readonly severity: LintSeverity;
}

interface SkillReference {
  readonly file: string;
  readonly jsonPath: string;
  readonly name: string;
}

function appendFinding(diagnostics: Diagnostic[], finding: LintFinding): void {
  const { severity } = finding;
  if (severity === "off") return;
  diagnostics.push({ ...finding, severity });
}

function appendSkillReference(
  diagnostics: Diagnostic[],
  reference: SkillReference,
  context: ReferenceContext,
): void {
  if (context.applicableSkillNames.has(reference.name)) return;

  const exists = context.allSkillNames.has(reference.name);
  appendFinding(diagnostics, {
    severity: context.severity,
    code: exists ? "lint.reference.not-applicable" : "lint.reference.missing",
    message: exists
      ? `Skill "${reference.name}" is not available for harness "${context.harness}".`
      : `Skill "${reference.name}" does not exist for harness "${context.harness}".`,
    file: reference.file,
    jsonPath: reference.jsonPath,
  });
}

function lintBodyReferences(
  source: BodySource,
  context: ReferenceContext,
  diagnostics: Diagnostic[],
): void {
  for (const match of source.body.matchAll(SLASH_REFERENCE)) {
    const name = match[1];
    if (name === undefined) continue;
    appendSkillReference(diagnostics, { file: source.file, jsonPath: "/body", name }, context);
  }
}

function lintQuestions(
  source: BodySource,
  config: ResolvedConfig,
  diagnostics: Diagnostic[],
): void {
  const { severity, allowProse } = config.lint.questions;
  if (severity === "off") return;

  let inFence = false;
  const visibleLines: string[] = [];
  for (const line of source.body.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) visibleLines.push(line);
  }

  const visibleBody = visibleLines.join("\n");
  const unwrappedBody = visibleBody.replace(/<interaction>[\s\S]*?<\/interaction>/gi, "");
  for (const _match of unwrappedBody.matchAll(/\bAskUserQuestion\s*\(/g)) {
    appendFinding(diagnostics, {
      severity,
      code: "lint.question.unwrapped-tool",
      message: "AskUserQuestion calls must be inside an interaction wrapper.",
      file: source.file,
      jsonPath: "/body",
    });
  }

  const allowedProse = allowProse.map((entry) => entry.toLowerCase());
  for (const line of visibleLines) {
    const normalizedLine = line.toLowerCase();
    if (
      normalizedLine.includes("ask the user") &&
      !allowedProse.some((entry) => normalizedLine.includes(entry))
    ) {
      appendFinding(diagnostics, {
        severity,
        code: "lint.question.prose",
        message: 'Prose containing "ask the user" must match the configured allowlist.',
        file: source.file,
        jsonPath: "/body",
      });
    }
  }
}

/** Validate references, applicability, restrictions, and configured semantic lint rules. */
export function lintModel(model: SourceModel, config: ResolvedConfig): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const skill of model.skills) {
    const { descriptionPrefix, structure } = config.lint;
    if (
      descriptionPrefix.severity !== "off" &&
      !skill.frontmatter.description.startsWith(descriptionPrefix.value)
    ) {
      appendFinding(diagnostics, {
        severity: descriptionPrefix.severity,
        code: "lint.description.prefix",
        message: `Skill description must start with "${descriptionPrefix.value}".`,
        file: skill.file,
        jsonPath: "/frontmatter/description",
      });
    }

    lintQuestions(skill, config, diagnostics);

    if (structure.severity !== "off") {
      if (!/^Announce:/m.test(skill.body)) {
        appendFinding(diagnostics, {
          severity: structure.severity,
          code: "lint.structure.announce",
          message: "Skill body must include an Announce: line.",
          file: skill.file,
          jsonPath: "/body",
        });
      }
      if (!/^## Step \d+(?:\s|$)/m.test(skill.body)) {
        appendFinding(diagnostics, {
          severity: structure.severity,
          code: "lint.structure.step",
          message: "Skill body must include a ## Step N heading.",
          file: skill.file,
          jsonPath: "/body",
        });
      }
      if (!/^## Error Handling\s*$/m.test(skill.body)) {
        appendFinding(diagnostics, {
          severity: structure.severity,
          code: "lint.structure.error-handling",
          message: "Skill body must include a ## Error Handling heading.",
          file: skill.file,
          jsonPath: "/body",
        });
      }
    }
  }

  for (const agent of model.agents) {
    lintQuestions(agent, config, diagnostics);
  }

  if (config.lint.references.severity !== "off") {
    const allSkillNames = new Set(model.skills.map((skill) => skill.name));
    for (const harness of HARNESS_IDS) {
      if (config.harnesses[harness]?.enabled !== true) continue;
      const sources = model.harnesses[harness];
      if (sources === undefined) continue;

      const context: ReferenceContext = {
        allSkillNames,
        applicableSkillNames: new Set(sources.skills.map((skill) => skill.name)),
        harness,
        severity: config.lint.references.severity,
      };
      for (const skill of sources.skills) {
        lintBodyReferences(skill, context, diagnostics);
      }
      for (const agent of sources.agents) {
        lintBodyReferences(agent, context, diagnostics);
        for (const [index, name] of agent.frontmatter.skills?.entries() ?? []) {
          appendSkillReference(
            diagnostics,
            { file: agent.file, jsonPath: `/frontmatter/skills/${index}`, name },
            context,
          );
        }
      }
    }
  }

  return diagnostics;
}
