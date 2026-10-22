import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { validateRepo } from "../../src/engine/index.js";
import { externalFixture, skill } from "./helpers.js";

let sample: Awaited<ReturnType<typeof externalFixture>>;
beforeEach(async () => {
  sample = await externalFixture();
});
afterEach(async () => {
  await sample.cleanup();
});

it("downgrades semantic and JSON findings when they belong to external skills", async () => {
  // Given: strict lints and external content that fails every configurable rule.
  await sample.put(
    join(sample.remote, "skills/review/SKILL.md"),
    skill("review", "Ask the user for details. See `/missing`.\n").replace(
      "Use when reviewing a project.",
      "Review a project.",
    ),
  );
  await sample.put(join(sample.remote, "skills/review/reference.json"), "{ broken");
  await sample.commit();
  await sample.configure([{ url: sample.url, path: "skills/review" }], {
    lint: {
      descriptionPrefix: { value: "Use when", severity: "error" },
      structure: { severity: "error" },
      questions: { severity: "error", allowProse: [] },
      references: { severity: "error" },
    },
  });
  // When: validation lints the external skill and its support files.
  const result = await validateRepo(sample.repo, { env: sample.env });
  // Then: findings remain visible without blocking snapshot construction.
  expect(result.snapshot).toBeDefined();
  expect(result.diagnostics.length).toBeGreaterThan(0);
  expect(result.diagnostics.every((item) => item.severity === "warn")).toBe(true);
  for (const code of [
    "lint.description.prefix",
    "lint.question.prose",
    "lint.reference.missing",
    "lint.structure.announce",
    "source.json",
  ])
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code, severity: "warn" }));
});

it.each([
  ["missing name", "---\ndescription: Use when reviewing.\n---\n"],
  ["missing description", "---\nname: review\n---\n"],
  ["unparseable frontmatter", "---\nname: [broken\n---\n"],
  ["no frontmatter", "A skill without metadata.\n"],
])("preserves metadata errors when an external skill has %s", async (_name, content) => {
  // Given: malformed external metadata.
  await sample.put(join(sample.remote, "skills/review/SKILL.md"), content);
  await sample.commit();
  await sample.configure([{ url: sample.url, path: "skills/review" }]);
  // When: discovery parses the skill.
  const result = await validateRepo(sample.repo, { env: sample.env });
  // Then: mandatory metadata failures still block the run.
  expect(result.snapshot).toBeUndefined();
  expect(
    result.diagnostics.some((item) => item.severity === "error" && item.file?.endsWith("SKILL.md")),
  ).toBe(true);
});

it("preserves missing SKILL.md errors when the selected directory contains no skill", async () => {
  // Given: an explicit non-skill directory.
  await sample.put(join(sample.remote, "empty/README.md"), "No skill here.");
  await sample.commit();
  await sample.configure([{ url: sample.url, path: "empty" }]);
  // When: discovery inspects that path.
  const result = await validateRepo(sample.repo, { env: sample.env });
  // Then: semantic leniency cannot turn missing content into a valid skill.
  expect(result.snapshot).toBeUndefined();
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "external.skill-missing",
      severity: "error",
      jsonPath: "/skills/external/0/path",
    }),
  );
});

it("keeps local prose failures as errors when external skills are configured", async () => {
  // Given: a local skill violating the same question rule.
  await sample.put(
    join(sample.repo, "skills/local/SKILL.md"),
    skill("local", "Ask the user for details.\n"),
  );
  // When: validation runs alongside the external inventory.
  const result = await validateRepo(sample.repo, { env: sample.env });
  // Then: the downgrade is scoped to external files.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "lint.question.prose",
      severity: "error",
      file: join(sample.repo, "skills/local/SKILL.md"),
    }),
  );
});
