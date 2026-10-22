import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";
import { beforeAll, expect, it } from "vitest";
import type { ResolvedContext } from "../../../src/core/types.js";
import { adapter } from "../../../src/adapters/codex/index.js";
import { convertText } from "../../../src/adapters/codex/dialect.js";
import { context, fixture, text } from "./helpers.js";

let ctx: ResolvedContext;
beforeAll(async () => {
  ctx = await context();
});

it("serializes agents when their instructions contain TOML delimiters", async () => {
  // Given: unrestricted source instructions that cannot be safely hand-quoted.
  const body = `Read ''' then """ and \\ paths.\n\`Read\` and mcp__docs__search.`;
  const agent = {
    name: "auditor",
    file: "agents/auditor.md",
    source: "user",
    harnesses: ["codex"],
    body,
    frontmatter: {
      name: "auditor",
      description: 'A "quoted" description',
      maxTurns: 8,
      skills: ["outline"],
    },
  } as const;
  const input = {
    ...ctx,
    model: {
      ...ctx.model,
      harnesses: { codex: { skills: [], agents: [agent], rules: [], assets: [] } },
    },
  };
  // When: the agent is rendered with the TOML library.
  const result = await adapter.render(input);
  // Then: the parsed instructions survive and unsupported scheduling fields are absent.
  expect(parse(text(result, "agents/auditor.toml"))).toEqual({
    name: "auditor",
    description: agent.frontmatter.description,
    developer_instructions: convertText(body, { file: agent.file }).text,
  });
  expect(parse(text(result, "agents/general-purpose.toml"))["name"]).toBe("general-purpose");
});

it.each([{ allowed_tools: ["Read"] }, { allowed_tools: [] }, { allowed_tools: "" }])(
  "warns for unenforceable allowlists %j",
  async (restriction) => {
    // Given: a restricted agent passed directly to the adapter.
    const agent = {
      name: "auditor",
      file: "agents/auditor.md",
      source: "user",
      harnesses: ["codex"],
      body: "Inspect sources.",
      frontmatter: { name: "auditor", description: "Inspect sources.", ...restriction },
    } as const;
    const input = {
      ...ctx,
      model: {
        ...ctx.model,
        harnesses: { codex: { skills: [], agents: [agent], rules: [], assets: [] } },
      },
    };
    // When: the adapter renders without engine preflight.
    const result = await adapter.render(input);
    // Then: the hint warns but the agent file is still rendered.
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "warn",
        code: "codex.permission.unenforced",
        file: agent.file,
        jsonPath: "/frontmatter/allowed_tools",
        message: expect.stringContaining("guidance only"),
      }),
    );
    expect(result.files.map((file) => file.relPath)).toContain("agents/auditor.toml");
    expect(adapter.capabilities.permissionEnforcement).toEqual({
      toolAllowlist: false,
      readOnly: false,
      noShell: false,
    });
  },
);

it.each([{ readOnly: true }, { noShell: true }])(
  "rejects hard restrictions when Codex cannot enforce them %j",
  async (restriction) => {
    // Given: an explicit hard restriction passed directly to the adapter.
    const agent = {
      name: "auditor",
      file: "agents/auditor.md",
      source: "user",
      harnesses: ["codex"],
      body: "Inspect sources.",
      frontmatter: { name: "auditor", description: "Inspect sources.", ...restriction },
    } as const;
    const input = {
      ...ctx,
      model: {
        ...ctx.model,
        harnesses: { codex: { skills: [], agents: [agent], rules: [], assets: [] } },
      },
    };
    // When: the adapter renders without engine preflight.
    const result = await adapter.render(input);
    // Then: hard restrictions remain errors and block the agent file.
    const field = "readOnly" in restriction ? "readOnly" : "noShell";
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "codex.permission",
        file: agent.file,
        jsonPath: `/frontmatter/${field}`,
      }),
    );
    expect(result.files.map((file) => file.relPath)).not.toContain("agents/auditor.toml");
  },
);

it("rewrites support Markdown when it contains source dialect references", async () => {
  // Given: a synthetic support document, using a real file as the byte source.
  const sourcePath = join(fixture, "skills/outline/SKILL.md");
  const original = ctx.model.harnesses.codex?.skills.find((skill) => skill.name === "outline");
  if (!original) throw new TypeError("Missing outline skill");
  const skill = {
    ...original,
    supportFiles: [{ relPath: "references/guide.md", sourcePath, mode: 0o755 }],
  };
  const input = {
    ...ctx,
    model: {
      ...ctx.model,
      harnesses: { codex: { skills: [skill], agents: [], rules: [], assets: [] } },
    },
  };
  const expected = convertText(await readFile(sourcePath, "utf8"), {
    file: sourcePath,
    skillDir: "skills/outline",
  });
  // When: the complete adapter renders.
  const result = await adapter.render(input);
  // Then: support docs receive the same converter, and modes survive.
  expect(text(result, "skills/outline/references/guide.md")).toBe(expected.text);
  expect(result.files.find((file) => file.relPath.endsWith("/guide.md"))?.mode).toBe(0o755);
});

it("includes only applicable rules when global instructions are generated", async () => {
  // Given: the engine has already filtered out a gated rule.
  const rule = ctx.model.harnesses.codex?.rules.find((rule) => rule.name === "style");
  if (!rule) throw new TypeError("Missing style rule");
  const input = {
    ...ctx,
    model: {
      ...ctx.model,
      harnesses: { codex: { skills: [], agents: [], rules: [rule], assets: [] } },
    },
  };
  // When: the adapter renders AGENTS.md.
  const result = await adapter.render(input);
  // Then: source instructions, scoped rule provenance, and rule body are the shipped content.
  expect(text(result, "AGENTS.md")).toBe(
    `${ctx.model.instructions?.body.trim()}\n\n<!-- Rule: rules/style.md -->\nApplies to: \`src/**\`.\n\n${rule.body.trim()}\n`,
  );
});

it("passes through execpolicy assets when their names are captured in the snapshot", async () => {
  // Given: one selected directory asset and its captured policy file.
  const sourcePath = fileURLToPath(new URL("./fixtures/rules", import.meta.url));
  const asset = {
    name: "rules",
    file: sourcePath,
    sourcePath,
    relPath: "rules",
    kind: "directory",
    source: "user",
    harnesses: ["codex"],
  } as const;
  const input: ResolvedContext = {
    ...ctx,
    snapshot: {
      ...ctx.snapshot,
      sourceHashes: {
        "harnesses/codex/assets/rules/safe.rules": "sha256:fixture",
      },
    },
    model: {
      ...ctx.model,
      harnesses: { codex: { skills: [], agents: [], rules: [], assets: [asset] } },
    },
  };
  // When: rendering reads the captured asset paths without rewriting their bytes.
  const result = await adapter.render(input);
  // Then: both the generated file and its non-exclusive install action preserve unrelated rules.
  expect(text(result, "rules/safe.rules")).toBe(
    await readFile(join(sourcePath, "safe.rules"), "utf8"),
  );
  expect(adapter.targets(input, "/tmp/generation")).toContainEqual({
    kind: "link",
    source: "/tmp/generation/codex/rules/safe.rules",
    target: "/home/alice/.codex/rules/safe.rules",
  });
  expect(
    adapter
      .targets(input, "/tmp/generation")
      .filter((action) => action.kind === "exclusiveTree")
      .map((action) => action.target),
  ).not.toContain(ctx.paths.rulesDir);
});

it("describes settings and MCP blocks when installing into a custom home", () => {
  // Given: an explicit Codex environment root and stable generation pointer.
  const paths = adapter.defaultPaths({
    HOME: "/home/alice",
    CODEX_HOME: "/home/alice/custom-codex",
  });
  // When: targets are requested without filesystem mutations.
  const actions = adapter.targets({ ...ctx, paths }, "/tmp/cache/current");
  // Then: native trees retain bundled skills while config remains a foreign-file merge.
  expect(paths.home).toBe("/home/alice/custom-codex");
  expect(adapter.defaultPaths({ HOME: "/home/alice" }).home).toBe("/home/alice/.codex");
  expect(actions).toContainEqual({
    kind: "exclusiveTree",
    source: "/tmp/cache/current/codex/skills",
    target: `${paths.home}/skills`,
    preserve: [".system"],
  });
  const merges = actions.filter((action) => action.kind === "mergeBlock");
  expect(merges.map((action) => action.blockId)).toEqual(["codex.settings", "codex.mcp"]);
  expect(
    merges.every(
      (action) => action.target === `${paths.home}/config.toml` && action.format === "toml",
    ),
  ).toBe(true);
  expect(merges.map((action) => parse(action.content))).toEqual([
    expect.objectContaining({ model: "example-model" }),
    expect.objectContaining({ mcp_servers: expect.any(Object) }),
  ]);
  expect(
    actions.some((action) => action.kind === "link" && action.target.endsWith("/config.toml")),
  ).toBe(false);
});
