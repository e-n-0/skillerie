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

it("skips content findings when they belong to external skills", async () => {
  // Given: strict lints and external content that fails every configurable rule.
  await sample.put(
    join(sample.remote, "skills/review/SKILL.md"),
    skill("review", "Ask the user for details. See `/missing`.\n", "custom-field: true\n").replace(
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
  // Then: external content lint produces no diagnostics.
  expect(result.snapshot).toBeDefined();
  expect(result.diagnostics).toEqual([]);
});

it.each([
  ["missing name", "---\ndescription: Use when reviewing.\n---\n"],
  ["missing description", "---\nname: review\n---\n"],
  ["invalid name", "---\nname: Review\ndescription: Reviews changes.\n---\n"],
  ["invalid description", "---\nname: review\ndescription: 42\n---\n"],
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
  // Then: content lint is still enforced for local files.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "lint.question.prose",
      severity: "error",
      file: join(sample.repo, "skills/local/SKILL.md"),
    }),
  );
});

it("resolves local skill and agent references to external skills", async () => {
  // Given: local sources reference an installed external skill.
  await sample.put(join(sample.repo, "skills/local/SKILL.md"), skill("local", "See `/review`.\n"));
  await sample.put(
    join(sample.repo, "agents/reviewer.md"),
    "---\nname: reviewer\ndescription: Reviews changes.\nskills: [review]\n---\nSee `/review`.\n",
  );
  // When: reference lint checks the local sources.
  const result = await validateRepo(sample.repo, { env: sample.env });
  // Then: external skills remain valid reference targets.
  expect(result.snapshot).toBeDefined();
  expect(result.diagnostics).toEqual([]);
});
