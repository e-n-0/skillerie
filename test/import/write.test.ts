import { chmod, lstat, mkdir, readFile, readdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { defaultSourcePaths } from "../../src/config/sources.js";
import type { ResolvedSourcePaths } from "../../src/config/sources.js";
import type { McpServer } from "../../src/core/types.js";
import { scrubServer } from "../../src/import/secrets.js";
import { agentMarkdown, hashFiles, hashJson, hashText } from "../../src/import/shared.js";
import type {
  FoundAgent,
  FoundInstructions,
  FoundMcp,
  FoundSkill,
} from "../../src/import/types.js";
import { writeImport } from "../../src/import/write.js";
import { scaffoldFiles } from "../../src/init/templates.js";
import { importFixture, SECRET_TOKEN } from "./fixture.js";

let fixture: Awaited<ReturnType<typeof importFixture>>;
let sources: ResolvedSourcePaths;

beforeEach(async () => {
  fixture = await importFixture();
  sources = defaultSourcePaths(fixture.repo);
});

afterEach(async () => {
  await fixture.cleanup();
});

async function skill(): Promise<FoundSkill> {
  const path = join(fixture.homes.opencode, "skills/review");
  const files = ["SKILL.md", "scripts/check.sh"];
  return {
    kind: "skill",
    name: "review",
    source: "opencode",
    path,
    files,
    hash: hashFiles(
      await Promise.all(
        files.map(async (relPath) => ({ relPath, content: await readFile(join(path, relPath)) })),
      ),
    ),
  };
}

function agent(): FoundAgent {
  const markdown = agentMarkdown({
    name: "planner",
    description: "Use when planning work.",
    body: "Plan before coding.\n",
  });
  return {
    kind: "agent",
    name: "planner",
    source: "opencode",
    path: join(fixture.homes.opencode, "agents/planner.md"),
    hash: hashText(markdown),
    markdown,
    dropped: ["mode", "model"],
  };
}

function instructions(): FoundInstructions {
  const content = "Use pnpm.\n";
  return {
    kind: "instructions",
    name: "instructions",
    source: "opencode",
    path: join(fixture.homes.opencode, "AGENTS.md"),
    hash: hashText(content),
    content,
  };
}

function mcp(name = "docs", server: McpServer = { url: "https://docs.example.com/mcp" }): FoundMcp {
  return {
    kind: "mcp",
    name,
    source: "opencode",
    path: join(fixture.homes.opencode, "opencode.jsonc"),
    server,
    hash: hashJson(server),
    secrets: [],
  };
}

it("copies only selected skill files with their bytes and exact modes", async () => {
  // Given: a skill with an executable support file and an unselected extra file.
  const item = await skill();
  const script = join(item.path, "scripts/check.sh");
  await chmod(script, 0o751);
  await fixture.put(join(item.path, "unselected.txt"), "Keep this in the harness.\n");
  const original = await readFile(script);
  // When: the skill is imported.
  const result = await writeImport({ sources, items: [item] });
  // Then: selected files and modes are copied, while the harness is unchanged.
  const target = join(sources.skills, "review");
  expect(result).toEqual({
    writes: [{ kind: "skill", name: "review", source: "opencode", target, status: "written" }],
    diagnostics: [],
  });
  expect(await readFile(join(target, "SKILL.md"))).toEqual(
    await readFile(join(item.path, "SKILL.md")),
  );
  expect(await readFile(join(target, "scripts/check.sh"))).toEqual(original);
  expect((await lstat(join(target, "scripts/check.sh"))).mode & 0o777).toBe(0o751);
  expect((await readdir(target)).sort()).toEqual(["SKILL.md", "scripts"]);
  expect(await readFile(script)).toEqual(original);
  expect((await lstat(script)).mode & 0o777).toBe(0o751);
  expect(await readFile(join(item.path, "unselected.txt"), "utf8")).toBe(
    "Keep this in the harness.\n",
  );
});

it.each(["identical", "changed support file", "extra file"] as const)(
  "preserves an existing skill with %s",
  async (state) => {
    // Given: a repository skill whose complete file set may differ from the inventory.
    const item = await skill();
    const target = join(sources.skills, "review");
    for (const file of item.files)
      await fixture.put(join(target, file), await readFile(join(item.path, file), "utf8"));
    if (state === "changed support file")
      await fixture.put(join(target, "scripts/check.sh"), "echo local\n");
    if (state === "extra file") await fixture.put(join(target, "local.txt"), "Local content.\n");
    const before = await readFile(join(target, "scripts/check.sh"));
    // When: that name is imported.
    const result = await writeImport({ sources, items: [item] });
    // Then: only an exact complete-tree match is unchanged; all content is preserved.
    expect(result.diagnostics).toEqual([]);
    expect(result.writes).toEqual([
      {
        kind: "skill",
        name: "review",
        source: "opencode",
        target,
        status: state === "identical" ? "unchanged" : "conflict",
        ...(state === "identical"
          ? {}
          : { note: "already in the repository with different content" }),
      },
    ]);
    expect(await readFile(join(target, "scripts/check.sh"))).toEqual(before);
    if (state === "extra file")
      expect(await readFile(join(target, "local.txt"), "utf8")).toBe("Local content.\n");
  },
);

it.each(["written", "unchanged", "conflict"] as const)(
  "returns %s for an agent and reports dropped fields",
  async (status) => {
    // Given: an absent, equivalent, or different agent destination.
    const item = agent();
    const target = join(sources.agents, "planner.md");
    const previous =
      status === "unchanged" ? item.markdown.replaceAll("\n", "\r\n") + "\r\n" : "Local agent.\n";
    if (status !== "written") await fixture.put(target, previous);
    const original = await readFile(item.path);
    // When: the normalized agent is imported.
    const result = await writeImport({ sources, items: [item] });
    // Then: existing content is never replaced, and the dropped-field note survives conflicts.
    expect(result.diagnostics).toEqual([]);
    expect(result.writes).toEqual([
      {
        kind: "agent",
        name: "planner",
        source: "opencode",
        target,
        status,
        note:
          status === "conflict"
            ? "already in the repository with different content; dropped: mode, model"
            : "dropped: mode, model",
      },
    ]);
    expect(await readFile(target, "utf8")).toBe(status === "written" ? item.markdown : previous);
    expect(await readFile(item.path)).toEqual(original);
  },
);

it("batches MCP additions while preserving other keys and existing servers", async () => {
  // Given: extension keys, an identical server with reordered fields, and a conflicting server.
  const tracker = mcp("tracker", { command: "node", args: ["tracker.js"] });
  const docs = mcp();
  const alpha = mcp("alpha", { command: "alpha" });
  const zeta = mcp("zeta", { command: "zeta" });
  const existing = {
    settings: { enabled: true },
    harnessOverrides: { pi: { docs: null } },
    extension: ["keep"],
    mcpServers: {
      tracker: { args: ["tracker.js"], command: "node" },
      docs: { url: "https://local.example.com/mcp" },
    },
  };
  await fixture.put(sources.mcp, JSON.stringify(existing));
  // When: several names are imported in a deliberately unsorted order.
  const result = await writeImport({ sources, items: [zeta, docs, tracker, alpha] });
  // Then: additions share one valid sorted document, and collisions retain their original values.
  expect(result.diagnostics).toEqual([]);
  expect(result.writes.map(({ name, status, target }) => ({ name, status, target }))).toEqual([
    { name: "zeta", status: "written", target: sources.mcp },
    { name: "docs", status: "conflict", target: sources.mcp },
    { name: "tracker", status: "unchanged", target: sources.mcp },
    { name: "alpha", status: "written", target: sources.mcp },
  ]);
  expect(result.writes[1]?.note).toBe("already in the repository with different content");
  const expected = {
    ...existing,
    mcpServers: {
      alpha: alpha.server,
      docs: existing.mcpServers.docs,
      tracker: existing.mcpServers.tracker,
      zeta: zeta.server,
    },
  };
  expect(await readFile(sources.mcp, "utf8")).toBe(`${JSON.stringify(expected, null, 2)}\n`);
});

it("creates a missing MCP document and its parent directory", async () => {
  // Given: a custom MCP path in a directory that does not exist.
  sources = { ...sources, mcp: join(fixture.repo, "nested/mcp.json") };
  const item = mcp();
  // When: a server is imported.
  const result = await writeImport({ sources, items: [item] });
  // Then: it creates the canonical MCP document at the configured absolute path.
  expect(result.diagnostics).toEqual([]);
  expect(result.writes).toMatchObject([{ target: sources.mcp, status: "written" }]);
  expect(await readFile(sources.mcp, "utf8")).toBe(
    `${JSON.stringify({ mcpServers: { docs: item.server } }, null, 2)}\n`,
  );
});

it.each(["unchanged", "conflict"] as const)(
  "does not rewrite MCP JSON when all servers are %s",
  async (status) => {
    // Given: JSONC formatting around a server that already exists.
    const item = mcp();
    const server = status === "unchanged" ? item.server : { command: "local" };
    const before = `{\n// keep formatting\n"mcpServers":{"docs":${JSON.stringify(server)}}\n}\n`;
    await fixture.put(sources.mcp, before);
    // When: no new server can be added.
    const result = await writeImport({ sources, items: [item] });
    // Then: it reports the comparison without touching the document.
    expect(result.diagnostics).toEqual([]);
    expect(result.writes).toMatchObject([{ target: sources.mcp, status }]);
    expect(await readFile(sources.mcp, "utf8")).toBe(before);
  },
);

it("reports secret fields without exposing their values or changing the harness", async () => {
  // Given: a scanned server with an inline Authorization value removed.
  const scrubbed = scrubServer({
    url: "https://docs.example.com/mcp",
    headers: { Authorization: `Bearer ${SECRET_TOKEN}`, "X-Team": "core" },
  });
  const item: FoundMcp = { ...mcp("docs", scrubbed.server), secrets: scrubbed.secrets };
  const original = await readFile(item.path);
  // When: that server is imported.
  const result = await writeImport({ sources, items: [item] });
  // Then: only field names appear in the warning and note; source credentials stay at home.
  expect(result.writes).toMatchObject([
    { status: "written", note: "removed secrets: headers.Authorization" },
  ]);
  expect(result.diagnostics).toEqual([
    {
      severity: "warn",
      code: "import.secret",
      message: "Server docs: removed secrets: headers.Authorization",
      file: item.path,
    },
  ]);
  const document = await readFile(sources.mcp, "utf8");
  expect(JSON.parse(document)).toEqual({ mcpServers: { docs: scrubbed.server } });
  expect(JSON.stringify(result) + document).not.toContain(SECRET_TOKEN);
  expect(await readFile(item.path)).toEqual(original);
});

it.each(["missing", "empty", "template"] as const)(
  "replaces %s instructions in place",
  async (state) => {
    // Given: a configurable instructions path containing no authored instructions.
    sources = { ...sources, instructions: join(fixture.repo, "custom/instructions.md") };
    const item = instructions();
    const template =
      scaffoldFiles({ opencode: true, codex: false, omo: false, pi: false }, "1.2.3", fixture.repo)[
        "instructions.md"
      ] ?? "";
    if (state !== "missing")
      await fixture.put(sources.instructions, state === "empty" ? " \n\t" : `\n${template}\n`);
    // When: instructions are imported.
    const result = await writeImport({ sources, items: [item] });
    // Then: the configured instructions file receives exactly the selected content.
    expect(result.diagnostics).toEqual([]);
    expect(result.writes).toMatchObject([{ target: sources.instructions, status: "written" }]);
    expect(await readFile(sources.instructions, "utf8")).toBe(item.content);
  },
);

it("leaves equivalent authored instructions unchanged after trimming", async () => {
  // Given: the selected instructions already exist with surrounding whitespace.
  const item = instructions();
  const previous = `\n ${item.content}\n`;
  await fixture.put(sources.instructions, previous);
  // When: the same instructions are imported.
  const result = await writeImport({ sources, items: [item] });
  // Then: the existing bytes remain intact.
  expect(result.diagnostics).toEqual([]);
  expect(result.writes).toMatchObject([{ target: sources.instructions, status: "unchanged" }]);
  expect(await readFile(sources.instructions, "utf8")).toBe(previous);
});

it.each(["written", "unchanged", "conflict"] as const)(
  "returns %s for imported instructions beside authored instructions",
  async (status) => {
    // Given: authored instructions and an absent, matching, or conflicting imported file.
    sources = { ...sources, instructions: join(fixture.repo, "custom/instructions.md") };
    const item = instructions();
    const target = join(fixture.repo, "custom/instructions.imported.md");
    const original = "# Local instructions\n\nKeep these.\n";
    const imported = `# Imported from ${item.path}\n\n${item.content}`;
    const previous = status === "unchanged" ? imported : "Earlier imported instructions.\n";
    await fixture.put(sources.instructions, original);
    if (status !== "written") await fixture.put(target, previous);
    // When: different instructions are imported.
    const result = await writeImport({ sources, items: [item] });
    // Then: authored content survives, and existing imported content is never overwritten.
    expect(result.diagnostics).toEqual([]);
    expect(result.writes).toMatchObject([
      {
        target,
        status,
        note:
          status === "conflict"
            ? "already in the repository with different content"
            : "merge it into instructions.md",
      },
    ]);
    expect(await readFile(sources.instructions, "utf8")).toBe(original);
    expect(await readFile(target, "utf8")).toBe(status === "written" ? imported : previous);
  },
);

it.each(["{ invalid", "[]", '{"mcpServers":[]}', '{"mcpServers":null}'])(
  "returns diagnostics without overwriting invalid MCP input %s",
  async (text) => {
    // Given: an invalid repository document and an independent agent to import.
    await fixture.put(sources.mcp, text);
    // When: both items are imported.
    const result = await writeImport({ sources, items: [mcp(), agent()] });
    // Then: MCP fails safely while the independent import completes.
    expect(result.diagnostics).toMatchObject([
      { severity: "error", code: "import.write", file: sources.mcp },
    ]);
    expect(result.writes).toMatchObject([{ kind: "agent", status: "written" }]);
    expect(await readFile(sources.mcp, "utf8")).toBe(text);
  },
);

it("returns a diagnostic without creating a partial skill when a selected file is missing", async () => {
  // Given: the source lost a selected support file after scanning.
  const item = await skill();
  await rm(join(item.path, "scripts/check.sh"));
  // When: its inventory is imported.
  const result = await writeImport({ sources, items: [item] });
  // Then: the error is reported and the destination was never created.
  expect(result.writes).toEqual([]);
  expect(result.diagnostics).toMatchObject([{ severity: "error", code: "import.write" }]);
  await expect(lstat(join(sources.skills, "review"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("returns a diagnostic when an agent target is a directory", async () => {
  // Given: a directory occupies an agent destination.
  const target = join(sources.agents, "planner.md");
  await mkdir(target, { recursive: true });
  // When: the agent is imported.
  const result = await writeImport({ sources, items: [agent()] });
  // Then: the invalid target is reported rather than throwing or being replaced.
  expect(result.writes).toEqual([]);
  expect(result.diagnostics).toMatchObject([{ severity: "error", file: target }]);
  expect((await lstat(target)).isDirectory()).toBe(true);
});

it("does not write through an MCP target linked into a harness home", async () => {
  // Given: the repository MCP path is a link to a harness file.
  const homeFile = join(fixture.homes.omo, "mcp.json");
  const original = await readFile(homeFile);
  await rm(sources.mcp);
  await symlink(homeFile, sources.mcp);
  // When: an MCP server is imported.
  const result = await writeImport({ sources, items: [mcp()] });
  // Then: the redirected target is diagnosed and the harness content stays untouched.
  expect(result.writes).toEqual([]);
  expect(result.diagnostics).toMatchObject([{ severity: "error", file: sources.mcp }]);
  expect(await readFile(homeFile)).toEqual(original);
  expect((await lstat(sources.mcp)).isSymbolicLink()).toBe(true);
});
