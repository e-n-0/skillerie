import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { adapter } from "../../../src/adapters/omo/index.js";
import { parseFrontmatter } from "../../../src/model/index.js";
import { rendered, setup } from "./helpers.js";

let sample: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  sample = await setup();
});
afterEach(async () => {
  await sample.cleanup();
});

it("reduces skill frontmatter when canonical metadata has extra fields", async () => {
  // Given: license, compatibility, and an explicit manual invocation restriction.
  const ctx = sample.ctx;
  const skills =
    ctx.model.harnesses.omo?.skills.map((skill) => ({
      ...skill,
      frontmatter: {
        ...skill.frontmatter,
        license: "Apache-2.0",
        compatibility: "Node 22",
        "disable-model-invocation": true,
        metadata: { category: "example" },
      },
    })) ?? [];
  const input = {
    ...ctx,
    model: {
      ...ctx.model,
      harnesses: {
        ...ctx.model.harnesses,
        omo: { skills, agents: [], rules: [], assets: [] },
      },
    },
  };
  // When: the adapter renders the skills.
  const result = await adapter.render(input);
  const parsed = parseFrontmatter(rendered(result, "skills/implement/SKILL.md"), "SKILL.md");
  // Then: only OMO-supported frontmatter fields remain.
  expect(parsed.frontmatter).toEqual({
    name: "implement",
    description: "Use when an approved plan is ready to implement.",
    license: "Apache-2.0",
    compatibility: "Node 22",
    "disable-model-invocation": true,
  });
  expect(result.diagnostics).toEqual([]);
});

it("omits explicit-only metadata when a skill does not request it", async () => {
  // Given: canonical fixture skills with no manual-only restriction.
  // When: OMO renders them.
  const result = await adapter.render(sample.ctx);
  // Then: an absent flag is not fabricated.
  const parsed = parseFrontmatter(rendered(result, "skills/outline/SKILL.md"), "SKILL.md");
  expect(parsed.frontmatter).not.toHaveProperty("disable-model-invocation");
});

it("rewrites support Markdown and preserves bytes and modes when rendering support files", async () => {
  // Given: executable support Markdown and a binary payload.
  const ctx = sample.ctx;
  const markdown = join(sample.root, "support.md");
  const binary = join(sample.root, "payload.bin");
  await writeFile(markdown, "`Read` mcp__docs__lookup ${CLAUDE_PLUGIN_ROOT}/references/a.md\n");
  await writeFile(binary, Buffer.from([0, 255, 42]));
  const skills =
    ctx.model.harnesses.omo?.skills.map((skill) => ({
      ...skill,
      supportFiles: [
        { relPath: "references/support.md", sourcePath: markdown, mode: 0o755 },
        { relPath: "payload.bin", sourcePath: binary, mode: 0o600 },
      ],
    })) ?? [];
  // When: support files pass through the real renderer.
  const result = await adapter.render({
    ...ctx,
    model: {
      ...ctx.model,
      harnesses: {
        ...ctx.model.harnesses,
        omo: { skills, agents: [], rules: [], assets: [] },
      },
    },
  });
  // Then: Markdown uses native tokens while binary content and permissions survive.
  expect(rendered(result, "skills/outline/references/support.md")).toBe(
    "`read` mcp_docs_lookup ./references/a.md\n",
  );
  expect(result.files).toContainEqual(
    expect.objectContaining({
      relPath: "skills/outline/payload.bin",
      content: Buffer.from([0, 255, 42]),
      mode: 0o600,
    }),
  );
  expect(result.files).toContainEqual(
    expect.objectContaining({
      relPath: "skills/outline/references/support.md",
      mode: 0o755,
    }),
  );
});
