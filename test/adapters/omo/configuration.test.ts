import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { afterEach, beforeEach, expect, it } from "vitest";
import { adapter } from "../../../src/adapters/omo/index.js";
import type { Agent, ResolvedContext } from "../../../src/core/types.js";
import { syncRepo } from "../../../src/engine/index.js";
import { rendered, setup, withTemplates } from "./helpers.js";

let sample: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  sample = await setup();
});
afterEach(async () => {
  await sample.cleanup();
});

it("preserves all template sections when custom agents are merged inline", async () => {
  // Given: uninterpreted runtime sections and a custom-agent runtime override.
  const ctx = withTemplates(sample.ctx, {
    "omo.jsonc": {
      "[opencode]": { categories: { review: { model: "example/model" } } },
      "[native]": {
        agents: { builder: { max_turns: 24 }, explore: { temperature: 0.1 } },
        teams: false,
      },
      _migrations: { completed: ["example"] },
      extra: { enabled: true },
    },
    "models.json": { providers: { example: { baseUrl: "https://example.com/api" } } },
  });
  // When: the adapter renders config and optional models.
  const result = await adapter.render(ctx);
  const config: unknown = parse(rendered(result, "omo.jsonc"));
  // Then: generated prompts coexist with template runtime policy.
  expect(config).toMatchObject({
    "[opencode]": { categories: { review: { model: "example/model" } } },
    "[native]": {
      teams: false,
      agents: {
        builder: {
          max_turns: 24,
          description: expect.any(String),
          prompt: expect.any(String),
        },
        auditor: { description: expect.any(String), prompt: expect.any(String) },
        explore: { temperature: 0.1 },
      },
    },
    _migrations: { completed: ["example"] },
    extra: { enabled: true },
  });
  expect(JSON.parse(rendered(result, "models.json"))).toEqual({
    providers: { example: { baseUrl: "https://example.com/api" } },
  });
  expect(result.files.some((entry) => entry.relPath.startsWith("agents/"))).toBe(false);
  expect(result.files.some((entry) => entry.relPath.startsWith("commands/"))).toBe(false);
  expect(result.diagnostics).toEqual([]);
});

it.each(["description", "prompt"])(
  "rejects a template %s clash when an agent is generated",
  async (field) => {
    // Given: a template trying to override generated authoring content.
    const ctx = withTemplates(sample.ctx, {
      "omo.jsonc": {
        "[native]": {
          agents: { builder: { [field]: "template content" } },
        },
      },
    });
    // When: inline agents and overrides are merged.
    const result = await adapter.render(ctx);
    // Then: the clash prevents activation.
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "omo.agentClash",
      }),
    );
  },
);

it("omits custom agents when disabled for OMO", async () => {
  // Given: an agent disabled through normal per-harness selection.
  const configFile = join(sample.repo, "skillerie.yaml");
  await writeFile(
    configFile,
    (await readFile(configFile, "utf8")) +
      "\nagents:\n  harnesses:\n    omo:\n      disabled: [auditor]\n",
  );
  // When: OMO renders its inline agents.
  const result = await syncRepo(sample.repo, {
    env: sample.env,
    harness: "omo",
    adapters: new Map([["omo", async () => ({ adapter })]]),
  });
  // Then: only the selected custom agent is generated.
  expect(result.diagnostics).toEqual([]);
  if (!result.generation) throw new TypeError("No generation produced.");
  const config: unknown = parse(
    await readFile(join(result.generation.dir, "omo/omo.jsonc"), "utf8"),
  );
  expect(config).toMatchObject({
    "[native]": { agents: { builder: { max_turns: 12 } } },
  });
  expect(config).toMatchObject({
    "[native]": { agents: expect.not.objectContaining({ auditor: expect.anything() }) },
  });
});

it("replaces whole MCP servers when overrides and null deletions are present", async () => {
  // Given: source settings, template callback policy, and OMO-specific overrides.
  const ctx = withTemplates(sample.ctx, {
    "mcp.json": {
      callback: "manual",
      oauth: { port: 1234 },
      mcpServers: { stale: { command: "old" } },
    },
  });
  const input: ResolvedContext = {
    ...ctx,
    model: {
      ...ctx.model,
      mcp: {
        file: "mcp.json",
        settings: { discovery: false },
        mcpServers: {
          docs: { url: "https://example.com/mcp", headers: { Accept: "application/json" } },
          tracker: { command: "old", env: { OLD: "value" } },
        },
        harnessOverrides: {
          omo: {
            docs: null,
            tracker: {
              command: "~/bin/tracker",
              args: ["~/data"],
              transport: "stdio",
              oauth: { enabled: false },
            },
          },
        },
      },
    },
  };
  // When: OMO renders the resolved MCP configuration.
  const result = await adapter.render(input);
  // Then: deleted servers disappear and replacement entries do not inherit old fields.
  expect(JSON.parse(rendered(result, "mcp.json"))).toEqual({
    callback: "manual",
    oauth: { port: 1234 },
    discovery: false,
    mcpServers: {
      tracker: {
        command: join(ctx.snapshot.config.paths.home, "bin/tracker"),
        args: [join(ctx.snapshot.config.paths.home, "data")],
        transport: "stdio",
        oauth: { enabled: false },
      },
    },
  });
  expect(result.diagnostics).toEqual([]);
});

it("reports an invalid server when no command or URL is supplied", async () => {
  // Given: parsed JSON that lacks a usable transport target.
  const ctx = sample.ctx;
  // When: MCP rendering validates its native boundary.
  const result = await adapter.render({
    ...ctx,
    model: {
      ...ctx.model,
      mcp: {
        file: "mcp.json",
        settings: {},
        harnessOverrides: {},
        mcpServers: { docs: { env: { EXAMPLE: "value" } } },
      },
    },
  });
  // Then: the source entry gets an error diagnostic.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "omo.mcp",
      severity: "error",
      jsonPath: "/mcpServers/docs",
    }),
  );
});

it.each([
  ["readOnly", true, "error", "omo.permission"],
  ["noShell", true, "error", "omo.permission"],
] as const)(
  "rejects %s when an applicable agent requests an unenforceable restriction",
  async (field, value, severity, code) => {
    // Given: an agent with a native permission OMO cannot enforce.
    const ctx = sample.ctx;
    const agents: readonly Agent[] = (ctx.model.harnesses.omo?.agents ?? []).map((agent) => ({
      ...agent,
      frontmatter: { ...agent.frontmatter, [field]: value },
    }));
    // When: the adapter is called directly, outside engine preflight.
    const result = await adapter.render({
      ...ctx,
      model: {
        ...ctx.model,
        harnesses: {
          ...ctx.model.harnesses,
          omo: { skills: [], rules: [], assets: [], agents },
        },
      },
    });
    // Then: the unsupported restriction is not silently dropped.
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity,
        code,
        jsonPath: `/frontmatter/${field}`,
      }),
    );
  },
);

function withOpencode(ctx: ResolvedContext, opencode: { enabled: boolean; path: string }) {
  return {
    ...ctx,
    snapshot: {
      ...ctx.snapshot,
      config: {
        ...ctx.snapshot.config,
        harnesses: { ...ctx.snapshot.config.harnesses, opencode: { ...opencode, options: {} } },
      },
    },
  };
}

it.each([
  ["enabled at its default path", true, ".config/opencode", false],
  ["disabled", false, ".config/opencode", true],
  ["installed elsewhere", true, "opencode-alt", true],
])(
  "keeps instructions out of AGENTS.md only when opencode is %s and OMO already loads them",
  async (_case, enabled, relPath, expected) => {
    // Given: an opencode harness whose AGENTS.md OMO may or may not read.
    const ctx = withOpencode(sample.ctx, {
      enabled,
      path: join(sample.ctx.snapshot.config.paths.home, relPath),
    });
    // When: OMO renders its instructions.
    const output = rendered(await adapter.render(ctx), "AGENTS.md");
    // Then: instructions appear once across both files, and rules always remain.
    expect(output.includes("<!-- Source: instructions.md -->")).toBe(expected);
    expect(output).toContain("<!-- Rule: rules/style.md -->");
  },
);

it("omits gated rules when the engine evaluates requires", async () => {
  // Given: a new rule gated on an unavailable environment variable.
  await writeFile(
    join(sample.repo, "rules/optional.md"),
    "---\nrequires:\n  env: EXAMPLE_FEATURE\n---\nOptional runtime policy.\n",
  );
  // When: the real engine resolves requirements before rendering OMO.
  const result = await syncRepo(sample.repo, {
    env: sample.env,
    adapters: new Map([["omo", async () => ({ adapter })]]),
    harness: "omo",
  });
  // Then: only applicable rules reach the generated instructions.
  expect(result.diagnostics).toEqual([]);
  const output = await readFile(join(sample.repo, "generated/current/omo/AGENTS.md"), "utf8");
  expect(output).toContain("rules/runtime.md");
  expect(output).toContain("rules/style.md");
  expect(output).not.toContain("rules/optional.md");
});
