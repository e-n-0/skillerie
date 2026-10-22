import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { syncRepo } from "../../src/engine/index.js";
import { sampleRepo } from "./helpers.js";

let sample: Awaited<ReturnType<typeof sampleRepo>>;
beforeEach(async () => {
  sample = await sampleRepo();
});
afterEach(async () => {
  await sample.cleanup();
});

it.each([
  [["codex"], "opencode, omo"],
  [["opencode", "codex", "omo"], undefined],
] as const)(
  "omits excluded harnesses %j from the guidance warning",
  async (excluded, harnesses) => {
    // Given: an allowlisted agent excluded from some unenforcing harnesses.
    await writeFile(
      join(sample.repo, "agents/reviewer.md"),
      "---\nname: reviewer\ndescription: Reviews changes.\nallowed_tools: [Read]\n---\nReview changes.\n",
    );
    const config = join(sample.repo, "skillerie.yaml");
    await writeFile(
      config,
      (await readFile(config, "utf8")) +
        "\nagents:\n  harnesses:\n" +
        excluded.map((id) => `    ${id}:\n      disabled: [reviewer]\n`).join(""),
    );
    // When: the engine selects sources and renders the remaining agents.
    const result = await syncRepo(sample.repo, { env: sample.env });
    // Then: only selected harnesses that cannot enforce the list are named.
    expect(result.generation).toBeDefined();
    expect(
      result.diagnostics.filter((item) => item.code === "engine.permission.unenforced"),
    ).toEqual(
      harnesses === undefined
        ? []
        : [
            expect.objectContaining({
              file: join(sample.repo, "agents/reviewer.md"),
              message: `allowed_tools for agent "reviewer" is guidance only on ${harnesses}; those harnesses cannot enforce it.`,
            }),
          ],
    );
  },
);

it("reports guidance-only allowlists once per agent across enabled harnesses", async () => {
  // Given: two agents with tool allowlists rendered by all four real adapters.
  for (const name of ["builder", "reviewer"])
    await writeFile(
      join(sample.repo, `agents/${name}.md`),
      `---\nname: ${name}\ndescription: Reviews changes.\nallowed_tools: [Read]\n---\nReview changes.\n`,
    );
  // When: validation and rendering both run.
  const result = await syncRepo(sample.repo, { env: sample.env });
  // Then: each agent has exactly one warning naming the three unenforcing harnesses.
  expect(result.generation).toBeDefined();
  expect(
    result.diagnostics.filter((item) => item.jsonPath === "/frontmatter/allowed_tools"),
  ).toEqual(
    ["builder", "reviewer"].map((name) => ({
      severity: "warn",
      code: "engine.permission.unenforced",
      file: join(sample.repo, `agents/${name}.md`),
      jsonPath: "/frontmatter/allowed_tools",
      message: `allowed_tools for agent "${name}" is guidance only on opencode, codex, omo; those harnesses cannot enforce it.`,
    })),
  );
});
