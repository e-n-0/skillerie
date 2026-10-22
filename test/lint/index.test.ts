import { expect, it } from "vitest";
import { lintModel } from "../../src/lint/index.js";
import {
  DEFAULT_CONFIG,
  agentFixture,
  configWithLint,
  diagnosticFacts,
  modelFixture,
  skillFixture,
} from "./fixtures.js";

it("reports a skill reference gated off for the source harness", () => {
  // Given: a source skill and referenced skill applicable to different harnesses.
  const source = skillFixture({ name: "source", body: "See `/target`." });
  const target = skillFixture({ name: "target", appliesTo: ["codex"] });

  // When: semantic lint resolves the source skill for each enabled harness.
  const findings = lintModel(modelFixture([source, target]), DEFAULT_CONFIG);

  // Then: the gated reference is an error at the source body.
  expect(diagnosticFacts(findings)).toEqual([
    {
      code: "lint.reference.not-applicable",
      severity: "error",
      file: source.file,
      jsonPath: "/body",
    },
  ]);
});

it("reports missing agent body and frontmatter skill references", () => {
  // Given: an agent referring to an absent skill in both supported forms.
  const agent = agentFixture({
    name: "helper",
    body: "Read `/missing` before proceeding.",
    skills: ["missing"],
  });

  // When: semantic lint checks the agent against its applicable harness.
  const findings = lintModel(modelFixture([], [agent]), DEFAULT_CONFIG);

  // Then: both references report the correct source locations.
  expect(diagnosticFacts(findings)).toEqual([
    {
      code: "lint.reference.missing",
      severity: "error",
      file: agent.file,
      jsonPath: "/body",
    },
    {
      code: "lint.reference.missing",
      severity: "error",
      file: agent.file,
      jsonPath: "/frontmatter/skills/0",
    },
  ]);
});

it("ignores wrapped and fenced question tool calls", () => {
  // Given: one call outside wrappers and lookalikes inside wrappers and a fence.
  const skill = skillFixture({
    name: "questions",
    body: [
      "<interaction>AskUserQuestion({ questions: [] })</interaction>",
      "```ts",
      "AskUserQuestion({ questions: [] })",
      "```",
      "AskUserQuestion({ questions: [] })",
    ].join("\n"),
  });

  // When: question lint scans the skill body.
  const findings = lintModel(modelFixture([skill]), DEFAULT_CONFIG);

  // Then: only the unwrapped, unfenced call is reported.
  expect(diagnosticFacts(findings)).toEqual([
    {
      code: "lint.question.unwrapped-tool",
      severity: "error",
      file: skill.file,
      jsonPath: "/body",
    },
  ]);
});

it("matches prose allowlist entries without case sensitivity", () => {
  // Given: one allowed phrase and one unapproved ask-the-user line.
  const skill = skillFixture({
    name: "prose",
    body: "ASK THE USER to run the example command.\nAsk the User for a password.",
  });
  const config = configWithLint({
    questions: {
      severity: "warn",
      allowProse: ["ask the user to run"],
    },
  });

  // When: question lint checks each prose line.
  const findings = lintModel(modelFixture([skill]), config);

  // Then: only the unapproved line produces a warning.
  expect(diagnosticFacts(findings)).toEqual([
    {
      code: "lint.question.prose",
      severity: "warn",
      file: skill.file,
      jsonPath: "/body",
    },
  ]);
});

it("uses the configured description prefix and severity", () => {
  // Given: a skill description that misses a custom prefix configured as an error.
  const skill = skillFixture({
    name: "description",
    description: "Use when this differs.",
  });
  const config = configWithLint({
    descriptionPrefix: { value: "Start by", severity: "error" },
  });

  // When: semantic lint checks the description.
  const findings = lintModel(modelFixture([skill]), config);

  // Then: the finding uses the configured severity and frontmatter path.
  expect(diagnosticFacts(findings)).toEqual([
    {
      code: "lint.description.prefix",
      severity: "error",
      file: skill.file,
      jsonPath: "/frontmatter/description",
    },
  ]);
});

it("omits disabled description and question rules", () => {
  // Given: content that violates both rules while their severities are off.
  const skill = skillFixture({
    name: "disabled",
    description: "A description without the configured prefix.",
    body: "AskUserQuestion({ questions: [] })\nAsk the user for a secret.",
  });
  const config = configWithLint({
    descriptionPrefix: { value: "Use when", severity: "off" },
    questions: { severity: "off", allowProse: [] },
  });

  // When: semantic lint applies the disabled settings.
  const findings = lintModel(modelFixture([skill]), config);

  // Then: neither disabled rule emits a diagnostic.
  expect(findings).toEqual([]);
});

it("checks each configured skill structure requirement", () => {
  // Given: a skill body with no required structure and warning severity enabled.
  const skill = skillFixture({ name: "structure" });
  const config = configWithLint({ structure: { severity: "warn" } });

  // When: semantic lint checks the skill structure.
  const findings = lintModel(modelFixture([skill]), config);

  // Then: each missing section is reported as a warning.
  expect(diagnosticFacts(findings)).toEqual([
    {
      code: "lint.structure.announce",
      severity: "warn",
      file: skill.file,
      jsonPath: "/body",
    },
    {
      code: "lint.structure.step",
      severity: "warn",
      file: skill.file,
      jsonPath: "/body",
    },
    {
      code: "lint.structure.error-handling",
      severity: "warn",
      file: skill.file,
      jsonPath: "/body",
    },
  ]);
});

it("omits disabled reference and structure rules", () => {
  // Given: unresolved references and missing structure with both rules disabled.
  const skill = skillFixture({ name: "disabled", body: "See `/missing`." });
  const config = configWithLint({
    references: { severity: "off" },
    structure: { severity: "off" },
  });

  // When: semantic lint applies the disabled settings.
  const findings = lintModel(modelFixture([skill]), config);

  // Then: neither disabled rule emits a diagnostic.
  expect(findings).toEqual([]);
});
