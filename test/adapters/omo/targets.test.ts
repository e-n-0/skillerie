import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { adapter } from "../../../src/adapters/omo/index.js";
import type { ResolvedContext } from "../../../src/core/types.js";
import { setup, withTemplates } from "./helpers.js";

let sample: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  sample = await setup();
});
afterEach(async () => {
  await sample.cleanup();
});

it("honors the agent-directory environment override when resolving default paths", () => {
  // Given: independently located runtime and agent roots.
  // When: defaults resolve the captured environment.
  const paths = adapter.defaultPaths({
    HOME: "/home/alice",
    OMO_CODING_AGENT_DIR: "/home/alice/content",
  });
  // Then: runtime config stays in the harness home and all content uses the override.
  expect(paths).toMatchObject({
    home: "/home/alice/.omo",
    configDir: "/home/alice/.omo",
    agentsDir: "/home/alice/content",
    skillsDir: "/home/alice/content/skills",
  });
});

it("describes every install target when templates and seeds are present", async () => {
  // Given: optional models, a configured content directory, and a seed payload.
  const ctx = withTemplates(sample.ctx, { "models.json": { providers: {} } });
  const sourcePath = join(sample.root, "seed.json");
  await writeFile(sourcePath, '{"completed":[]}\n');
  const harness = ctx.snapshot.config.harnesses.omo;
  if (harness === undefined) throw new TypeError("Missing harness.");
  const root = join(sample.root, "content");
  const input = {
    ...ctx,
    snapshot: {
      ...ctx.snapshot,
      config: {
        ...ctx.snapshot.config,
        harnesses: {
          ...ctx.snapshot.config.harnesses,
          omo: { ...harness, options: { agentDir: root } },
        },
      },
    },
    model: {
      ...ctx.model,
      seeds: [{ harness: "omo" as const, sourcePath, relPath: "state.json", mode: 0o600 }],
    },
  };
  const generation = join(sample.root, "current/omo");
  // When: rendering and target planning run without installing.
  const result = await adapter.render(input);
  const actions = adapter.targets(input, join(sample.root, "current"));
  // Then: files link from a stable generation, skills are exclusive, and seeds remain copy-if-missing.
  expect(actions).toContainEqual({
    kind: "link",
    source: join(generation, "omo.jsonc"),
    target: join(ctx.paths.configDir, "omo.jsonc"),
  });
  for (const name of ["AGENTS.md", "mcp.json", "models.json"])
    expect(actions).toContainEqual({
      kind: "link",
      source: join(generation, name),
      target: join(root, name),
    });
  expect(actions).toContainEqual({
    kind: "exclusiveTree",
    source: join(generation, "skills"),
    target: join(root, "skills"),
    preserve: [],
  });
  expect(actions).toContainEqual({
    kind: "seed",
    source: join(generation, "seeds/state.json"),
    target: join(root, "state.json"),
  });
  expect(actions).toContainEqual({
    kind: "jsonArrayMerge",
    target: join(root, "settings.json"),
    jsonPath: "/skills",
    blockId: "skillerie.omo.skills",
    values: ["implement", "outline", "verify"].map(
      (name) => `!${join(ctx.env["HOME"] ?? "", ".agents/skills", name)}/**`,
    ),
  });
  expect(result.files).toContainEqual({
    kind: "file",
    relPath: "seeds/state.json",
    content: Buffer.from('{"completed":[]}\n'),
    mode: 0o600,
  });
});

it("escapes glob characters in the home directory of shared skill exclusions", () => {
  // Given: a home directory containing glob syntax.
  const ctx = { ...sample.ctx, env: { ...sample.ctx.env, HOME: "/home/a{b,c}*" } };
  // When: target actions are planned.
  const merge = adapter
    .targets(ctx, join(sample.root, "current"))
    .find((action) => action.kind === "jsonArrayMerge");
  // Then: every exclusion matches only that literal shared skills directory.
  expect(merge).toMatchObject({
    values: expect.arrayContaining(["!/home/a\\{b,c\\}\\*/.agents/skills/implement/**"]),
  });
});

it("leaves foreign settings alone when shared skill deduplication is disabled", () => {
  // Given: preserve mode for the shared skills directory.
  const ctx = sample.ctx;
  const input = {
    ...ctx,
    snapshot: {
      ...ctx.snapshot,
      config: { ...ctx.snapshot.config, shared: { agentsSkillsDir: "preserve" as const } },
    },
  };
  // When: target actions are planned.
  const actions = adapter.targets(input, join(sample.root, "current"));
  // Then: no foreign JSON merge or absent models target is requested.
  expect(actions.some((action) => action.kind === "jsonArrayMerge")).toBe(false);
  expect(
    actions.some((action) => "target" in action && action.target.endsWith("/models.json")),
  ).toBe(false);
});

it("retains an installable skills tree when no skill is applicable", async () => {
  // Given: a resolved harness whose selection excludes every skill.
  const ctx = sample.ctx;
  const input: ResolvedContext = {
    ...ctx,
    model: {
      ...ctx.model,
      harnesses: { ...ctx.model.harnesses, omo: { skills: [], agents: [], rules: [], assets: [] } },
    },
  };
  // When: rendering describes an otherwise empty exclusive tree.
  const result = await adapter.render(input);
  // Then: a real generation entry keeps the exclusiveTree source present.
  expect(result.files).toContainEqual({
    kind: "file",
    relPath: "skills/.keep",
    content: "",
    mode: 0o644,
  });
  expect(adapter.targets(input, join(sample.root, "current"))).toContainEqual(
    expect.objectContaining({
      kind: "exclusiveTree",
      source: join(sample.root, "current/omo/skills"),
    }),
  );
});

it("copies opted-in assets into the generation when they are applicable", async () => {
  // Given: an explicitly selected executable asset.
  const sourcePath = join(sample.root, "example.sh");
  await writeFile(sourcePath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const ctx = sample.ctx;
  const input: ResolvedContext = {
    ...ctx,
    model: {
      ...ctx.model,
      harnesses: {
        ...ctx.model.harnesses,
        omo: {
          skills: [],
          agents: [],
          rules: [],
          assets: [
            {
              name: "example.sh",
              file: sourcePath,
              sourcePath,
              source: "user",
              harness: "omo",
              harnesses: ["omo"],
              relPath: "example.sh",
              kind: "file",
            },
          ],
        },
      },
    },
  };
  // When: the adapter renders the opted-in payload.
  const result = await adapter.render(input);
  // Then: generation bytes, executable permissions, and a link action are preserved.
  expect(result.files).toContainEqual({
    kind: "file",
    relPath: "assets/example.sh",
    content: Buffer.from("#!/bin/sh\nexit 0\n"),
    mode: 0o755,
  });
  expect(adapter.targets(input, join(sample.root, "current"))).toContainEqual({
    kind: "link",
    source: join(sample.root, "current/omo/assets/example.sh"),
    target: join(ctx.paths.agentsDir, "example.sh"),
  });
});
