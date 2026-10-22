import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { afterEach, beforeEach, expect, it } from "vitest";
import { adapter } from "../../../src/adapters/pi/index.js";
import type { RenderResult } from "../../../src/core/types.js";
import { parseFrontmatter } from "../../../src/model/index.js";
import { fixture, withSources } from "./helpers.js";

let sample: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  sample = await fixture();
});
afterEach(async () => {
  await sample.cleanup();
});

function content(result: RenderResult, path: string): string {
  const file = result.files.find((entry) => entry.relPath === path);
  if (!file) throw new TypeError(`Missing rendered file: ${path}`);
  return String(file.content);
}

it("keeps quoted skill metadata when the skill disables implicit invocation", async () => {
  // Given: effective skill metadata containing punctuation and a native invocation flag.
  const skill = sample.context.model.harnesses.pi?.skills[0];
  if (!skill) throw new TypeError("Expected a skill.");
  const source = {
    ...skill,
    frontmatter: {
      ...skill.frontmatter,
      description: 'Use when "quotes": need preserving.',
      "disable-model-invocation": true,
    },
  };
  // When: rendering the skill.
  const result = await adapter.render(withSources(sample.context, { skills: [source] }));
  // Then: only native fields survive, with quoted strings and a real boolean.
  const text = content(result, `skills/${skill.name}/SKILL.md`);
  const parsed = parseFrontmatter(text, skill.file);
  expect(parsed.frontmatter).toEqual({
    name: skill.name,
    description: source.frontmatter.description,
    "disable-model-invocation": true,
  });
  const document = parseDocument(text.split("---")[1] ?? "");
  expect(document.get("name", true)).toMatchObject({ type: "QUOTE_DOUBLE" });
  expect(document.get("description", true)).toMatchObject({ type: "QUOTE_DOUBLE" });
});

it("rewrites nested support Markdown when copying a skill's support files", async () => {
  // Given: Markdown and executable support files with identical canonical tokens.
  const skill = sample.context.model.harnesses.pi?.skills[0];
  if (!skill) throw new TypeError("Expected a skill.");
  const markdown = join(sample.root, "guide.md");
  const script = join(sample.root, "run.sh");
  await writeFile(markdown, '`Read` mcp__docs__search(query="a,b")');
  await writeFile(script, 'echo "WebSearch"\n');
  await chmod(script, 0o755);
  const source = {
    ...skill,
    supportFiles: [
      { sourcePath: markdown, relPath: "references/nested/guide.md", mode: 0o644 },
      { sourcePath: script, relPath: "scripts/run.sh", mode: 0o755 },
    ],
  };
  // When: rendering support content.
  const result = await adapter.render(withSources(sample.context, { skills: [source] }));
  // Then: Markdown is translated and other bytes/modes pass through unchanged.
  expect(content(result, `skills/${skill.name}/references/nested/guide.md`)).toContain("`read`");
  expect(content(result, `skills/${skill.name}/scripts/run.sh`)).toBe('echo "WebSearch"\n');
  expect(result.files.find((file) => file.relPath.endsWith("scripts/run.sh"))?.mode).toBe(0o755);
});

it("applies whole-server overrides when producing native MCP configuration", async () => {
  // Given: shared servers, overrides, template defaults, and template settings.
  const piTemplates = sample.context.model.templates.pi;
  if (!piTemplates) throw new TypeError("Expected the Pi settings template.");
  const mcpTemplate = {
    file: join(sample.repo, "harnesses/pi/templates/mcp.json"),
    relPath: "mcp.json",
    format: "json" as const,
    content: JSON.stringify({
      settings: { idleTimeout: 0, samplingAutoApprove: false },
      serverDefaults: { lifecycle: "keep-alive", directTools: false },
    }),
  };
  const context = {
    ...sample.context,
    model: {
      ...sample.context.model,
      templates: {
        ...sample.context.model.templates,
        pi: { ...piTemplates, files: [...piTemplates.files, mcpTemplate] },
      },
      mcp: {
        file: join(sample.repo, "mcp.json"),
        mcpServers: {
          docs: { url: "https://docs.example.com/mcp", headers: { "X-Example": "old" } },
          tracker: { command: "sh", args: ["old.sh"] },
        },
        harnessOverrides: {
          pi: {
            docs: { url: "https://example.com/new", directTools: true, lifecycle: "custom" },
            tracker: null,
            local: { command: "node", args: ["example.js"], env: { MODE: "example" } },
          },
        },
        settings: { scriptMode: true, idleTimeout: 30 },
      },
    },
  };
  // When: rendering the Pi MCP configuration.
  const result = await adapter.render(context);
  // Then: per-server values override defaults, with template settings retained.
  const parsed: unknown = JSON.parse(content(result, "mcp.json"));
  expect(parsed).toEqual({
    mcpServers: {
      docs: {
        url: "https://example.com/new",
        directTools: true,
        lifecycle: "custom",
      },
      local: {
        command: "node",
        args: ["example.js"],
        env: { MODE: "example" },
        lifecycle: "keep-alive",
        directTools: false,
      },
    },
    settings: { idleTimeout: 30, samplingAutoApprove: false, scriptMode: true },
  });
});

it("reports invalid Pi MCP template fields", async () => {
  // Given: a Pi MCP template with a non-object settings value.
  const piTemplates = sample.context.model.templates.pi;
  if (!piTemplates) throw new TypeError("Expected the Pi settings template.");
  const context = {
    ...sample.context,
    model: {
      ...sample.context.model,
      templates: {
        ...sample.context.model.templates,
        pi: {
          ...piTemplates,
          files: [
            ...piTemplates.files,
            {
              file: join(sample.repo, "harnesses/pi/templates/mcp.json"),
              relPath: "mcp.json",
              format: "json" as const,
              content: JSON.stringify({ settings: [] }),
            },
          ],
        },
      },
    },
  };
  // When: rendering the adapter configuration.
  const result = await adapter.render(context);
  // Then: the malformed field has a source-located diagnostic.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      severity: "error",
      code: "pi.mcpTemplate",
      file: join(sample.repo, "harnesses/pi/templates/mcp.json"),
      jsonPath: "/settings",
    }),
  );
});

it("keeps native authentication configuration when source servers declare it", async () => {
  // Given: ordinary harness-native authentication and explicit source headers.
  const context = {
    ...sample.context,
    model: {
      ...sample.context.model,
      mcp: {
        file: join(sample.repo, "mcp.json"),
        mcpServers: {
          docs: {
            url: "https://example.com/mcp",
            auth: true,
            headers: { Accept: "application/json" },
          },
        },
        harnessOverrides: {},
        settings: {},
      },
    },
  };
  // When: rendering native MCP.
  const result = await adapter.render(context);
  // Then: source fields pass through without injected token commands.
  const parsed: unknown = JSON.parse(content(result, "mcp.json"));
  expect(parsed).toEqual({
    mcpServers: {
      docs: { url: "https://example.com/mcp", auth: true, headers: { Accept: "application/json" } },
    },
  });
});

it("combines instructions with effective rules when the engine filters applicability", async () => {
  // Given: only one applicable scoped rule remains in the resolved context.
  const rules =
    sample.context.model.harnesses.pi?.rules.filter((rule) => rule.name === "style") ?? [];
  // When: rendering instructions.
  const result = await adapter.render(withSources(sample.context, { rules }));
  // Then: global instructions and selected rule text are present with its scope.
  const text = content(result, "AGENTS.md");
  const instructions = sample.context.model.instructions?.body
    .replace(/`\/([a-z0-9-]+)`/g, "`/skill:$1`")
    .trim();
  expect(text).toContain(instructions);
  expect(text).toContain(rules[0]?.body.trim());
  expect(text).toContain('"src/**"');
  expect(text).not.toContain("<!-- rule: runtime -->");
});

it("passes settings through when an expanded template is present", async () => {
  // Given: the sample's settings have already passed through variable expansion.
  // When: rendering configuration.
  const result = await adapter.render(sample.context);
  // Then: the harness template bytes are preserved.
  expect(content(result, "settings.json")).toBe(
    sample.context.model.templates.pi?.files[0]?.content,
  );
});

it("enables native skill commands when a settings template is absent", async () => {
  // Given: a model without Pi settings.
  const context = { ...sample.context, model: { ...sample.context.model, templates: {} } };
  // When: rendering default configuration.
  const result = await adapter.render(context);
  // Then: Pi uses native skill commands without proxy files.
  const parsed: unknown = JSON.parse(content(result, "settings.json"));
  expect(parsed).toEqual({ enableSkillCommands: true });
  expect(result.files.some((file) => file.relPath.startsWith("commands/"))).toBe(false);
});

it("passes opted-in extensions through when the effective asset tree contains them", async () => {
  // Given: an enabled extension with a nested asset file.
  const sourcePath = join(sample.root, "extensions");
  await mkdir(join(sourcePath, "example"), { recursive: true });
  await writeFile(join(sourcePath, "example", "index.ts"), 'export const name = "example";\n');
  const context = withSources(sample.context, {
    assets: [
      {
        name: "extensions",
        file: sourcePath,
        sourcePath,
        relPath: "extensions",
        source: "user",
        harness: "pi",
        harnesses: ["pi"],
        kind: "directory",
      },
    ],
  });
  // When: rendering the asset tree.
  const result = await adapter.render(context);
  // Then: extensions retain exact source content instead of dialect rewriting.
  expect(content(result, "extensions/example/index.ts")).toBe('export const name = "example";\n');
});
