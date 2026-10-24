import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, readlink, rm, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import { afterEach, beforeEach, expect, it } from "vitest";
import { importRepo, inventoryRepo, selectItems } from "../../src/import/index.js";
import { hashText } from "../../src/import/shared.js";
import { importFixture, PROVIDER_KEY, SECRET_TOKEN } from "./fixture.js";

let fixture: Awaited<ReturnType<typeof importFixture>>;

beforeEach(async () => {
  fixture = await importFixture();
});

afterEach(async () => {
  await fixture.cleanup();
});

async function homeSnapshot(root: string): Promise<Readonly<Record<string, string>>> {
  const entries: Record<string, string> = {};
  async function visit(path: string, rel: string): Promise<void> {
    const info = await lstat(path);
    if (info.isSymbolicLink()) entries[rel] = `link:${await readlink(path)}`;
    else if (info.isDirectory()) {
      entries[rel] = `directory:${info.mode & 0o777}`;
      for (const name of (await readdir(path)).sort())
        await visit(join(path, name), rel ? `${rel}/${name}` : name);
    } else
      entries[rel] = `file:${info.mode & 0o777}:${createHash("sha256")
        .update(await readFile(path))
        .digest("hex")}`;
  }
  await visit(root, "");
  return entries;
}

it("inventories exactly the fixture groups and excludes managed and built-in content", async () => {
  // Given: every supported home, shared locations, duplicate copies, and managed content.
  const before = await homeSnapshot(fixture.home);
  // When: the engine inventories the repository's harness homes.
  const result = await inventoryRepo(fixture.repo, { env: fixture.env });
  // Then: groups, source order, identity, and repository comparisons match the fixture contract.
  expect(result.diagnostics).toEqual([]);
  expect(
    result.entries.map(({ kind, name, copies, identical, inRepo }) => ({
      kind,
      name,
      sources: copies.map((copy) => copy.source),
      identical,
      inRepo,
    })),
  ).toEqual([
    { kind: "skill", name: "claude-only", sources: ["claude"], identical: true, inRepo: "absent" },
    { kind: "skill", name: "existing", sources: ["pi"], identical: true, inRepo: "same" },
    { kind: "skill", name: "notes", sources: ["omo"], identical: true, inRepo: "absent" },
    {
      kind: "skill",
      name: "review",
      sources: ["opencode", "codex", "pi"],
      identical: false,
      inRepo: "absent",
    },
    { kind: "skill", name: "shared-tool", sources: ["agents"], identical: true, inRepo: "absent" },
    { kind: "agent", name: "auditor", sources: ["codex"], identical: true, inRepo: "absent" },
    { kind: "agent", name: "critic", sources: ["claude"], identical: true, inRepo: "absent" },
    { kind: "agent", name: "planner", sources: ["opencode"], identical: true, inRepo: "absent" },
    { kind: "agent", name: "scout", sources: ["pi"], identical: true, inRepo: "absent" },
    { kind: "mcp", name: "docs", sources: ["opencode"], identical: true, inRepo: "absent" },
    { kind: "mcp", name: "search", sources: ["omo", "pi"], identical: true, inRepo: "absent" },
    {
      kind: "mcp",
      name: "tracker",
      sources: ["opencode", "codex"],
      identical: true,
      inRepo: "absent",
    },
    {
      kind: "instructions",
      name: "instructions",
      sources: ["opencode", "codex", "omo", "claude"],
      identical: false,
      inRepo: "absent",
    },
    {
      kind: "settings",
      name: "codex/config.toml",
      sources: ["codex"],
      identical: true,
      inRepo: "absent",
    },
    {
      kind: "settings",
      name: "mcp-settings",
      sources: ["omo", "pi"],
      identical: true,
      inRepo: "absent",
    },
    {
      kind: "settings",
      name: "omo/models.json",
      sources: ["omo"],
      identical: true,
      inRepo: "absent",
    },
    {
      kind: "settings",
      name: "omo/omo.jsonc",
      sources: ["omo"],
      identical: true,
      inRepo: "absent",
    },
    {
      kind: "settings",
      name: "opencode/opencode.jsonc",
      sources: ["opencode"],
      identical: true,
      inRepo: "absent",
    },
    {
      kind: "settings",
      name: "opencode/tui.json",
      sources: ["opencode"],
      identical: true,
      inRepo: "absent",
    },
    {
      kind: "settings",
      name: "pi/settings.json",
      sources: ["pi"],
      identical: true,
      inRepo: "absent",
    },
  ]);
  expect(
    result.entries.flatMap((entry) =>
      entry.copies.flatMap((copy) =>
        copy.kind === "settings"
          ? [
              {
                name: copy.name,
                source: copy.source,
                excluded: copy.excluded,
                secrets: copy.secrets,
              },
            ]
          : [],
      ),
    ),
  ).toEqual([
    {
      name: "codex/config.toml",
      source: "codex",
      excluded: ["mcp_servers", "mcp_oauth_callback_port", "projects", "notice", "tui", "plugins"],
      secrets: [],
    },
    { name: "mcp-settings", source: "omo", excluded: [], secrets: [] },
    { name: "mcp-settings", source: "pi", excluded: [], secrets: [] },
    {
      name: "omo/models.json",
      source: "omo",
      excluded: [],
      secrets: ["providers.local.apiKey"],
    },
    { name: "omo/omo.jsonc", source: "omo", excluded: [], secrets: [] },
    {
      name: "opencode/opencode.jsonc",
      source: "opencode",
      excluded: ["mcp"],
      secrets: ["provider.anthropic.options.apiKey"],
    },
    { name: "opencode/tui.json", source: "opencode", excluded: [], secrets: [] },
    { name: "pi/settings.json", source: "pi", excluded: [], secrets: [] },
  ]);
  const review = result.entries.find((entry) => entry.name === "review");
  expect(review?.copies[0]).toMatchObject({ files: ["SKILL.md", "scripts/check.sh"] });
  expect(review?.copies[0]?.hash).toBe(review?.copies[1]?.hash);
  expect(review?.copies[2]?.hash).not.toBe(review?.copies[0]?.hash);
  expect(result.entries.find((entry) => entry.name === "docs")?.copies[0]).toMatchObject({
    secrets: ["headers.Authorization"],
    server: { url: "https://docs.example.com/mcp" },
  });
  expect(result.entries.find((entry) => entry.name === "planner")?.copies[0]).toMatchObject({
    dropped: ["mode", "model"],
  });
  expect(result.homes).toEqual([
    { source: "opencode", path: fixture.homes.opencode },
    { source: "codex", path: fixture.homes.codex },
    { source: "omo", path: dirname(fixture.homes.omo) },
    { source: "pi", path: fixture.homes.pi },
    { source: "agents", path: join(fixture.home, ".agents") },
    { source: "claude", path: join(fixture.home, ".claude") },
  ]);
  expect(JSON.stringify(result)).not.toContain(SECRET_TOKEN);
  expect(JSON.stringify(result)).not.toContain(PROVIDER_KEY);
  expect(await homeSnapshot(fixture.home)).toEqual(before);
});

it("requires choices for differing copies and skips items already in the repository", async () => {
  // Given: the fixture's conflicting review and instructions, and existing repository skill.
  const { entries } = await inventoryRepo(fixture.repo, { env: fixture.env });
  // When: every inventory group is requested.
  const result = selectItems(entries, { all: true });
  // Then: only unambiguous new groups are selected, with identical groups using their first copy.
  expect(result.ambiguous.map((entry) => entry.name)).toEqual(["review", "instructions"]);
  expect(result.skipped.map((entry) => entry.name)).toEqual(["existing"]);
  expect(result.unknown).toEqual([]);
  expect(result.items.map((item) => `${item.name}@${item.source}`)).toEqual([
    "claude-only@claude",
    "notes@omo",
    "shared-tool@agents",
    "auditor@codex",
    "critic@claude",
    "planner@opencode",
    "scout@pi",
    "docs@opencode",
    "search@omo",
    "tracker@opencode",
    "codex/config.toml@codex",
    "mcp-settings@omo",
    "omo/models.json@omo",
    "omo/omo.jsonc@omo",
    "opencode/opencode.jsonc@opencode",
    "opencode/tui.json@opencode",
    "pi/settings.json@pi",
  ]);
});

it("resolves explicit copies and reports unknown names or sources", async () => {
  // Given: names with several copies and an already imported item.
  const { entries } = await inventoryRepo(fixture.repo, { env: fixture.env });
  // When: explicit source choices, duplicates, and unmatched requests are supplied.
  const result = selectItems(entries, {
    names: [
      "review@codex",
      "instructions@omo",
      "existing@pi",
      "review@claude",
      "missing",
      "review@codex",
    ],
  });
  // Then: the requested copies are chosen once, without falling back to other sources.
  expect(result.items.map((item) => `${item.name}@${item.source}`)).toEqual([
    "review@codex",
    "instructions@omo",
  ]);
  expect(result.ambiguous).toEqual([]);
  expect(result.skipped.map((entry) => entry.name)).toEqual(["existing"]);
  expect(result.unknown).toEqual(["review@claude", "missing"]);
});

it("matches bare names across kinds and selects nothing without a request", async () => {
  // Given: a skill and an agent with the same name.
  await fixture.put(
    join(fixture.homes.opencode, "agents/review.md"),
    "---\ndescription: Use when reviewing.\n---\nReview.\n",
  );
  const { entries } = await inventoryRepo(fixture.repo, { env: fixture.env });
  // When: the shared name is selected.
  const result = selectItems(entries, { names: ["review"] });
  // Then: the agent is selected while the conflicting skill still requires a choice.
  expect(result.items.map((item) => item.kind)).toEqual(["agent"]);
  expect(result.ambiguous.map((entry) => entry.kind)).toEqual(["skill"]);
  expect(result.unknown).toEqual([]);
  expect(selectItems(entries, {})).toEqual({
    items: [],
    unknown: [],
    ambiguous: [],
    skipped: [],
  });
});

it.each(["opencode", "codex", "omo", "pi"] as const)(
  "limits inventory to %s without shared content",
  async (harness) => {
    // Given: a complete home containing all harnesses and shared items.
    // When: inventory is restricted to one harness.
    const result = await inventoryRepo(fixture.repo, { env: fixture.env, harness });
    // Then: every copy belongs to that harness and only its home is reported.
    expect(result.diagnostics).toEqual([]);
    expect(result.entries.length).toBeGreaterThan(0);
    expect([
      ...new Set(result.entries.flatMap((entry) => entry.copies.map((copy) => copy.source))),
    ]).toEqual([harness]);
    expect(result.homes).toEqual([
      {
        source: harness,
        path: harness === "omo" ? dirname(fixture.homes.omo) : fixture.homes[harness],
      },
    ]);
  },
);

it.each(
  (["opencode", "codex", "omo", "pi"] as const).flatMap((harness) => [
    { harness, configured: false },
    { harness, configured: true },
  ]),
)(
  "uses environment-aware $harness defaults without an authored path (configured: $configured)",
  async ({ harness, configured }) => {
    // Given: no authored harness path and distinct environment overrides.
    await fixture.put(
      join(fixture.repo, "skillerie.yaml"),
      `version: 1\n${configured ? `harnesses:\n  ${harness}:\n    enabled: false\n` : ""}paths:\n  cache: ${fixture.cache}\n`,
    );
    const env = {
      ...fixture.env,
      XDG_CONFIG_HOME: join(fixture.home, "xdg"),
      CODEX_HOME: join(fixture.home, "codex-custom"),
      OMO_CODING_AGENT_DIR: join(fixture.home, "omo-custom"),
      PI_CODING_AGENT_DIR: join(fixture.home, "pi-custom"),
    };
    const homes = {
      opencode: join(env.XDG_CONFIG_HOME, "opencode"),
      codex: env.CODEX_HOME,
      omo: join(fixture.home, ".omo"),
      pi: env.PI_CODING_AGENT_DIR,
    };
    const agentDir = harness === "omo" ? env.OMO_CODING_AGENT_DIR : homes[harness];
    await fixture.put(
      join(agentDir, "skills/relocated/SKILL.md"),
      "---\nname: relocated\ndescription: Use when relocated.\n---\nContent.\n",
    );
    // When: the harness without an authored path is inventoried.
    const result = await inventoryRepo(fixture.repo, { env, harness });
    // Then: the override location, not the default home content, supplies the skill.
    expect(result.diagnostics).toEqual([]);
    expect(result.homes).toEqual([{ source: harness, path: homes[harness] }]);
    expect(
      result.entries.filter((entry) => entry.kind === "skill").map((entry) => entry.name),
    ).toEqual(["relocated"]);
  },
);

it("prefers an authored Pi path over its environment override", async () => {
  // Given: an explicitly authored default path and a different environment location.
  await fixture.put(
    join(fixture.repo, "skillerie.yaml"),
    `version: 1\nharnesses:\n  pi:\n    enabled: false\n    path: ${fixture.homes.pi}\npaths:\n  cache: ${fixture.cache}\n`,
  );
  const env = { ...fixture.env, PI_CODING_AGENT_DIR: join(fixture.home, "other-pi") };
  // When: Pi is inventoried with both path sources present.
  const result = await inventoryRepo(fixture.repo, { env, harness: "pi" });
  // Then: explicit configuration wins, even when its value happens to be the normal default.
  expect(result.diagnostics).toEqual([]);
  expect(result.homes).toEqual([{ source: "pi", path: fixture.homes.pi }]);
  expect(
    result.entries.filter((entry) => entry.kind === "skill").map((entry) => entry.name),
  ).toEqual(["existing", "review"]);
});

it("honors a configured home even when the selected profile disables its harness", async () => {
  // Given: the selected profile disables OpenCode at a custom home.
  const home = join(fixture.home, "profile-opencode");
  await fixture.put(
    join(fixture.repo, "skillerie.yaml"),
    `version: 1
harnesses:
  opencode:
    enabled: true
    path: ${home}
paths:
  cache: ${fixture.cache}
profiles:
  default: {}
  alternate:
    harnesses:
      opencode:
        enabled: false
`,
  );
  await fixture.put(join(home, "AGENTS.md"), "Profile instructions.\n");
  // When: inventory explicitly selects the disabled profile and harness.
  const result = await inventoryRepo(fixture.repo, {
    env: fixture.env,
    harness: "opencode",
    profile: "alternate",
  });
  // Then: enabled status never suppresses the configured home scan.
  expect(result.diagnostics).toEqual([]);
  expect(result.homes).toEqual([{ source: "opencode", path: home }]);
  expect(result.entries).toMatchObject([
    { kind: "instructions", copies: [{ path: join(home, "AGENTS.md") }] },
  ]);
  expect(result.entries).toHaveLength(1);
});

it("scans Omo runtime agents separately from its configured agent content directory", async () => {
  // Given: Omo has independent runtime and content roots.
  const home = join(fixture.home, "omo-runtime");
  const agentDir = join(fixture.home, "omo-content");
  await fixture.put(
    join(fixture.repo, "skillerie.yaml"),
    `version: 1\nharnesses:\n  omo:\n    enabled: false\n    path: ${home}\n    options:\n      agentDir: ${agentDir}\npaths:\n  cache: ${fixture.cache}\n`,
  );
  await fixture.put(
    join(home, "omo.jsonc"),
    '{"[native]":{"agents":{"native":{"description":"Use when native.","prompt":"Native."}}}}',
  );
  await fixture.put(join(agentDir, "AGENTS.md"), "Content instructions.\n");
  await fixture.put(
    join(agentDir, "skills/custom/SKILL.md"),
    "---\nname: custom\ndescription: Use when custom.\n---\nContent.\n",
  );
  // When: the Omo harness is inventoried.
  const result = await inventoryRepo(fixture.repo, { env: fixture.env, harness: "omo" });
  // Then: runtime agents and agent-directory skills and instructions all appear.
  expect(result.diagnostics).toEqual([]);
  expect(result.entries.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
    "skill:custom",
    "agent:native",
    "instructions:instructions",
    "settings:omo/omo.jsonc",
  ]);
  expect(result.entries[1]?.copies[0]?.path).toBe(join(home, "omo.jsonc"));
  expect(result.entries[2]?.copies[0]?.path).toBe(join(agentDir, "AGENTS.md"));
});

it("excludes exact manifest targets without mistaking cache path prefixes for ownership", async () => {
  // Given: a manifest owns ordinary files, and a foreign skill links beside the cache.
  const targets = [
    join(fixture.homes.opencode, "agents/planner.md"),
    join(fixture.homes.opencode, "tui.json"),
  ];
  await fixture.put(
    join(fixture.homes.opencode, ".skillerie/manifest.json"),
    JSON.stringify({
      version: 1,
      harness: "opencode",
      engineVersion: "0.0.0",
      repo: { path: fixture.repo, configHash: "fixture" },
      createdDirectories: [],
      entries: targets.map((target) => ({
        target,
        kind: "owned",
        fingerprint: "fixture",
        preimage: { kind: "absent" },
        merges: [],
      })),
    }),
  );
  const foreign = `${fixture.cache}-foreign`;
  await fixture.put(
    join(foreign, "SKILL.md"),
    "---\nname: foreign\ndescription: Use when foreign.\n---\nContent.\n",
  );
  await symlink(foreign, join(fixture.homes.opencode, "skills/foreign"));
  // When: all homes are scanned.
  const result = await inventoryRepo(fixture.repo, { env: fixture.env });
  // Then: the owned target and cache link are skipped, but the foreign link is retained.
  expect(result.diagnostics).toEqual([]);
  expect(result.entries.some((entry) => entry.name === "planner")).toBe(false);
  expect(result.entries.some((entry) => entry.name === "managed-skill")).toBe(false);
  expect(result.entries.some((entry) => entry.name === "opencode/tui.json")).toBe(false);
  expect(result.entries.find((entry) => entry.name === "foreign")).toMatchObject({
    kind: "skill",
    copies: [{ source: "opencode" }],
  });
});

it("compares complete repository skills, agent text, canonical MCP and trimmed instructions", async () => {
  // Given: one conflicting group matches a non-first copy, and every kind has a repository value.
  const initial = await inventoryRepo(fixture.repo, { env: fixture.env });
  const planner = initial.entries.find((entry) => entry.name === "planner")?.copies[0];
  if (planner?.kind !== "agent") throw new TypeError("Expected fixture agent.");
  await fixture.put(join(fixture.repo, "agents/planner.md"), planner.markdown);
  await fixture.put(
    join(fixture.repo, "skills/review/SKILL.md"),
    await readFile(join(fixture.homes.pi, "skills/review/SKILL.md"), "utf8"),
  );
  await fixture.put(join(fixture.repo, "instructions.md"), "\n  Prefer bun.\n\n");
  await fixture.put(
    join(fixture.repo, "mcp.json"),
    '{"mcpServers":{"tracker":{"env":{"TRACKER_URL":"https://tracker.example.com"},"args":["/opt/tracker.js"],"command":"node"},"docs":{"command":"different"}}}',
  );
  // When: repository content is compared with every source copy.
  const result = await inventoryRepo(fixture.repo, { env: fixture.env });
  // Then: any matching copy suffices, but an existing different MCP server is a conflict.
  expect(result.diagnostics).toEqual([]);
  expect(
    result.entries
      .filter((entry) =>
        ["review", "planner", "tracker", "docs", "instructions"].includes(entry.name),
      )
      .map((entry) => [entry.name, entry.inRepo]),
  ).toEqual([
    ["review", "same"],
    ["planner", "same"],
    ["docs", "different"],
    ["tracker", "same"],
    ["instructions", "same"],
  ]);
});

it.each([
  {
    name: "opencode/tui.json",
    template: "opencode/templates/tui.json",
    content: '{\n // repository formatting\n "theme": "tokyonight",\n}\n',
    inRepo: "same",
    warning: false,
  },
  {
    name: "opencode/tui.json",
    template: "opencode/templates/tui.json",
    content: '{"theme":"light"}',
    inRepo: "different",
    warning: false,
  },
  {
    name: "codex/config.toml",
    template: "codex/templates/config.toml",
    content: '# repository order\napproval_policy = "on-request"\nmodel = "gpt-5"\n',
    inRepo: "same",
    warning: false,
  },
  {
    name: "codex/config.toml",
    template: "codex/templates/config.toml",
    content: 'model = "other"\n',
    inRepo: "different",
    warning: false,
  },
  {
    name: "opencode/tui.json",
    template: "opencode/templates/tui.json",
    content: '{"theme":',
    inRepo: "different",
    warning: true,
  },
  {
    name: "opencode/tui.json",
    template: "opencode/templates/tui.json",
    content: "[]",
    inRepo: "different",
    warning: true,
  },
  {
    name: "codex/config.toml",
    template: "codex/templates/config.toml",
    content: 'model = "unterminated',
    inRepo: "different",
    warning: true,
  },
  {
    name: "opencode/tui.json",
    template: "opencode/templates/tui.json",
    content: undefined,
    inRepo: "different",
    warning: true,
  },
])(
  "compares $name as $inRepo for template $content",
  async ({ name, template, content, inRepo, warning }) => {
    // Given: an existing repository template with independent content or an unreadable directory.
    const file = join(fixture.repo, "harnesses", template);
    if (content === undefined) await mkdir(file, { recursive: true });
    else await fixture.put(file, content);
    // When: settings are compared using their native format.
    const result = await inventoryRepo(fixture.repo, { env: fixture.env });
    // Then: semantic equality ignores formatting, while malformed or unreadable settings differ.
    expect(result.entries.find((entry) => entry.name === name)?.inRepo).toBe(inRepo);
    expect(result.diagnostics).toMatchObject(
      warning ? [{ severity: "warn", code: "import.settings", file }] : [],
    );
  },
);

it.each([
  { content: undefined, inRepo: "absent", warning: false },
  { content: '{"mcpServers":{}}', inRepo: "absent", warning: false },
  { content: '{"settings":{}}', inRepo: "absent", warning: false },
  { content: '{"settings":{"timeoutMs":30000}}', inRepo: "same", warning: false },
  { content: '{"settings":{"timeoutMs":1000}}', inRepo: "different", warning: false },
  { content: '{"settings":[]}', inRepo: "different", warning: true },
  { content: "{invalid", inRepo: "different", warning: true },
])(
  "compares MCP settings as $inRepo for repository $content",
  async ({ content, inRepo, warning }) => {
    // Given: MCP settings exist without any source servers, and the repository varies independently.
    await fixture.put(
      join(fixture.homes.omo, "mcp.json"),
      '{"mcpServers":{},"settings":{"timeoutMs":30000}}',
    );
    const file = join(fixture.repo, "mcp.json");
    if (content === undefined) await rm(file);
    else await fixture.put(file, content);
    // When: only OMO is inventoried, so settings alone must trigger the repository MCP read.
    const result = await inventoryRepo(fixture.repo, { env: fixture.env, harness: "omo" });
    // Then: missing or empty settings are absent, while invalid files warn instead of throwing.
    expect(result.entries.find((entry) => entry.name === "mcp-settings")?.inRepo).toBe(inRepo);
    expect(result.diagnostics).toMatchObject(
      warning ? [{ severity: "warn", code: "import.settings", file }] : [],
    );
  },
);

it("matches repository MCP settings against a non-first differing copy", async () => {
  // Given: OMO and Pi settings differ, and the repository matches only Pi.
  await fixture.put(
    join(fixture.homes.pi, "mcp.json"),
    '{"mcpServers":{},"settings":{"timeoutMs":1000}}',
  );
  await fixture.put(join(fixture.repo, "mcp.json"), '{"settings":{"timeoutMs":1000}}');
  // When: all source copies are compared to the repository.
  const result = await inventoryRepo(fixture.repo, { env: fixture.env });
  // Then: identity detects the conflict, but a match against any copy counts as already imported.
  expect(result.diagnostics).toEqual([]);
  expect(result.entries.find((entry) => entry.name === "mcp-settings")).toMatchObject({
    identical: false,
    inRepo: "same",
    copies: [{ source: "omo" }, { source: "pi" }],
  });
  expect(selectItems(result.entries, { names: ["mcp-settings"] }).items).toEqual([]);
});

it("marks a skill different when a repository support file differs", async () => {
  // Given: matching skill markdown but different support-file bytes.
  const root = join(fixture.repo, "skills/review");
  await fixture.put(
    join(root, "SKILL.md"),
    await readFile(join(fixture.homes.opencode, "skills/review/SKILL.md"), "utf8"),
  );
  await fixture.put(join(root, "scripts/check.sh"), "echo repository\n");
  // When: the skill's complete file tree is compared.
  const result = await inventoryRepo(fixture.repo, { env: fixture.env });
  // Then: matching markdown alone cannot make the repository group identical.
  expect(result.entries.find((entry) => entry.name === "review")?.inRepo).toBe("different");
});

it.each(["missing", "empty", "template"] as const)(
  "treats %s repository instructions as absent",
  async (state) => {
    // Given: instructions that have never been authored.
    const file = join(fixture.repo, "instructions.md");
    if (state === "missing") await rm(file);
    if (state === "empty") await fixture.put(file, " \n\t");
    // When: inventory checks whether instructions already exist.
    const result = await inventoryRepo(fixture.repo, { env: fixture.env });
    // Then: missing, blank, and init-template instructions can all be imported in place.
    expect(result.diagnostics).toEqual([]);
    expect(result.entries.find((entry) => entry.kind === "instructions")?.inRepo).toBe("absent");
  },
);

it("returns diagnostics for unreadable repository files and an invalid manifest", async () => {
  // Given: an agent path is a directory, MCP JSON is malformed, and manifest JSON is invalid.
  await mkdir(join(fixture.repo, "agents/planner.md"), { recursive: true });
  await fixture.put(join(fixture.repo, "mcp.json"), "{ invalid");
  const manifest = join(fixture.homes.codex, ".skillerie/manifest.json");
  await fixture.put(manifest, "[]");
  // When: the engine inventories otherwise valid home content.
  const result = await inventoryRepo(fixture.repo, { env: fixture.env });
  // Then: expected file failures are reported without throwing or losing independent inventory.
  expect(result.entries).toHaveLength(20);
  expect(result.diagnostics.map((diagnostic) => diagnostic.file).sort()).toEqual(
    [join(fixture.repo, "agents/planner.md"), join(fixture.repo, "mcp.json"), manifest].sort(),
  );
  expect(result.entries.find((entry) => entry.name === "planner")?.inRepo).toBe("different");
  expect(result.entries.find((entry) => entry.name === "docs")?.inRepo).toBe("different");
  expect(result.entries.find((entry) => entry.name === "mcp-settings")?.inRepo).toBe("different");
});

it.each(["inventory", "import"] as const)(
  "returns configuration errors before %s",
  async (operation) => {
    // Given: invalid repository configuration and unchanged harness homes.
    await fixture.put(join(fixture.repo, "skillerie.yaml"), "version: 2\n");
    const before = await homeSnapshot(fixture.home);
    // When: an engine operation attempts to load configuration.
    const result =
      operation === "inventory"
        ? await inventoryRepo(fixture.repo, { env: fixture.env })
        : await importRepo(fixture.repo, { env: fixture.env, items: [] });
    // Then: configuration diagnostics are returned without scanning or writing.
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    if ("entries" in result) {
      expect(result.entries).toEqual([]);
      expect(result.homes).toEqual([]);
    } else {
      expect(result.writes).toEqual([]);
      expect(result.validation).toBeUndefined();
    }
    expect(await homeSnapshot(fixture.home)).toEqual(before);
  },
);

it.each(["inventory", "import"] as const)(
  "rejects an unknown requested profile before %s",
  async (operation) => {
    // Given: a valid repository without the requested profile.
    const options = { env: fixture.env, profile: "missing" };
    // When: an engine operation explicitly requests that profile.
    const result =
      operation === "inventory"
        ? await inventoryRepo(fixture.repo, options)
        : await importRepo(fixture.repo, { ...options, items: [] });
    // Then: profile selection reaches the configuration loader instead of using a default.
    expect(result.diagnostics).toMatchObject([
      { severity: "error", code: "config.profile.unknown" },
    ]);
    if ("entries" in result) expect(result.entries).toEqual([]);
    else expect(result.writes).toEqual([]);
  },
);

it("imports resolved selections, validates the repository and preserves every harness byte", async () => {
  // Given: all groups selected with explicit choices for the two differing groups.
  const { entries } = await inventoryRepo(fixture.repo, { env: fixture.env });
  const selected = selectItems(entries, {
    all: true,
    names: ["review@opencode", "instructions@codex"],
  });
  const before = await homeSnapshot(fixture.home);
  const cache = await homeSnapshot(fixture.cache);
  // When: the selected inventory is imported into the repository.
  const result = await importRepo(fixture.repo, { env: fixture.env, items: selected.items });
  // Then: every selected item is written, validation is clean, and no harness home is changed.
  expect(selected.ambiguous).toEqual([]);
  expect(selected.items).toHaveLength(19);
  expect(result.writes).toHaveLength(19);
  expect(result.writes.every((write) => write.status === "written")).toBe(true);
  expect(result.writes.every((write) => write.target.startsWith(`${fixture.repo}/`))).toBe(true);
  expect(result.diagnostics).toMatchObject([
    { severity: "warn", code: "import.secret" },
    { severity: "warn", code: "import.secret" },
    { severity: "warn", code: "import.secret" },
  ]);
  expect(result.validation).toBeDefined();
  expect(
    result.validation?.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
  ).toEqual([]);
  expect(result.validation?.model?.skills.map((skill) => skill.name).sort()).toEqual([
    "claude-only",
    "existing",
    "notes",
    "review",
    "shared-tool",
  ]);
  expect(await readFile(join(fixture.repo, "skills/review/scripts/check.sh"))).toEqual(
    await readFile(join(fixture.homes.opencode, "skills/review/scripts/check.sh")),
  );
  const mcp = await readFile(join(fixture.repo, "mcp.json"), "utf8");
  expect(JSON.parse(mcp)).toEqual({
    settings: { timeoutMs: 30000 },
    mcpServers: {
      docs: { url: "https://docs.example.com/mcp" },
      search: { url: "https://search.example.com/mcp" },
      tracker: {
        command: "node",
        args: ["/opt/tracker.js"],
        env: { TRACKER_URL: "https://tracker.example.com" },
      },
    },
  });
  const templates = {
    "codex/config.toml": { model: "gpt-5", approval_policy: "on-request" },
    "omo/models.json": { providers: { local: { baseUrl: "http://localhost:11434" } } },
    "omo/omo.jsonc": { telemetry: false },
    "opencode/opencode.jsonc": {
      $schema: "https://opencode.ai/config.json",
      model: "anthropic/claude-sonnet",
      provider: { anthropic: { options: {} } },
    },
    "opencode/tui.json": { theme: "tokyonight" },
    "pi/settings.json": { theme: "dark", enableSkillCommands: true },
  };
  for (const [name, value] of Object.entries(templates)) {
    const slash = name.indexOf("/");
    const path = join(
      fixture.repo,
      "harnesses",
      name.slice(0, slash),
      "templates",
      name.slice(slash + 1),
    );
    const content = await readFile(path, "utf8");
    const parsed: unknown = name.endsWith(".toml") ? parseToml(content) : parseJsonc(content);
    expect(parsed).toEqual(value);
    expect(content).not.toContain(PROVIDER_KEY);
  }
  expect(mcp + JSON.stringify(result.diagnostics)).not.toContain(SECRET_TOKEN);
  expect(await homeSnapshot(fixture.home)).toEqual(before);
  expect(await homeSnapshot(fixture.cache)).toEqual(cache);
});

it("stages differing settings beside the repository without overwriting a template", async () => {
  // Given: imported Pi settings conflict with an authored repository template.
  const inventory = await inventoryRepo(fixture.repo, { env: fixture.env });
  const selected = selectItems(inventory.entries, { names: ["pi/settings.json"] });
  const template = join(fixture.repo, "harnesses/pi/templates/settings.json");
  const authored = '{"theme":"light"}\n';
  await fixture.put(template, authored);
  const before = await homeSnapshot(fixture.home);
  // When: the engine passes the repository root to the settings writer.
  const result = await importRepo(fixture.repo, { env: fixture.env, items: selected.items });
  // Then: the conflict copy is inside imported/, and both the template and homes are untouched.
  const target = join(fixture.repo, "imported/pi/settings.json");
  expect(result.writes).toMatchObject([{ target, status: "written" }]);
  expect(JSON.parse(await readFile(target, "utf8"))).toEqual({
    theme: "dark",
    enableSkillCommands: true,
  });
  expect(await readFile(template, "utf8")).toBe(authored);
  expect(result.diagnostics).toEqual([]);
  expect(result.validation).toBeDefined();
  expect(result.validation?.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  expect(await homeSnapshot(fixture.home)).toEqual(before);
});

it("uses configured source paths for inventory comparisons and imports", async () => {
  // Given: all repository sources live under a custom directory.
  await fixture.put(
    join(fixture.repo, "skillerie.yaml"),
    `version: 1
paths:
  cache: ${fixture.cache}
sources:
  skills: custom/skills
  agents: custom/agents
  instructions: custom/instructions.md
  mcp: custom/mcp.json
  harnesses: custom/harnesses
profiles:
  default: {}
  alternate: {}
`,
  );
  await fixture.put(
    join(fixture.repo, "harnesses/pi/templates/settings.json"),
    '{"theme":"dark","enableSkillCommands":true}\n',
  );
  const inventory = await inventoryRepo(fixture.repo, { env: fixture.env });
  const selected = selectItems(inventory.entries, {
    names: ["existing", "docs", "planner", "pi/settings.json", "mcp-settings"],
  });
  // When: selected items are imported into those configured sources.
  const result = await importRepo(fixture.repo, {
    env: fixture.env,
    items: selected.items,
    profile: "alternate",
  });
  // Then: the old default-source copy does not suppress import and all targets use custom paths.
  expect(inventory.entries.find((entry) => entry.name === "existing")?.inRepo).toBe("absent");
  expect(inventory.entries.find((entry) => entry.name === "pi/settings.json")?.inRepo).toBe(
    "absent",
  );
  expect(result.writes.map((write) => write.target)).toEqual([
    join(fixture.repo, "custom/skills/existing"),
    join(fixture.repo, "custom/agents/planner.md"),
    join(fixture.repo, "custom/mcp.json"),
    join(fixture.repo, "custom/mcp.json"),
    join(fixture.repo, "custom/harnesses/pi/templates/settings.json"),
  ]);
  expect(result.writes.every((write) => write.status === "written")).toBe(true);
  expect(result.validation?.profile).toBe("alternate");
  expect(
    result.validation?.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
  ).toEqual([]);
});

it("does not validate when imports write nothing", async () => {
  // Given: the selected skill is already identical in the repository.
  const { entries } = await inventoryRepo(fixture.repo, { env: fixture.env });
  const items = entries.flatMap((entry) => (entry.name === "existing" ? entry.copies : []));
  const progress: string[] = [];
  // When: the existing item is passed directly to the importer.
  const result = await importRepo(fixture.repo, {
    env: fixture.env,
    items,
    onProgress: (message) => progress.push(message),
  });
  // Then: unchanged writes are reported and validation never starts.
  expect(result.writes).toMatchObject([{ name: "existing", status: "unchanged" }]);
  expect(result.validation).toBeUndefined();
  expect(result.diagnostics).toEqual([]);
  expect(progress).toEqual([]);
});

it("returns validation failures after writing without changing home content", async () => {
  // Given: repository instructions reference a nonexistent skill.
  const content = "# Missing reference\n\n`/missing-import-reference`\n";
  const item = {
    kind: "instructions",
    name: "instructions",
    source: "codex",
    path: join(fixture.homes.codex, "AGENTS.md"),
    content,
    hash: hashText(content),
  } as const;
  const before = await homeSnapshot(fixture.home);
  // When: the importer writes instructions that fail semantic validation.
  const result = await importRepo(fixture.repo, { env: fixture.env, items: [item] });
  // Then: the write and validation errors are both available to the caller.
  expect(result.writes).toMatchObject([{ status: "written" }]);
  expect(result.validation?.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(
    true,
  );
  expect(await homeSnapshot(fixture.home)).toEqual(before);
});

it("treats a link into another repository's skillerie cache as managed", async () => {
  // Given: a skill linked into the shared skillerie cache root, outside this repository's own cache.
  const generation = join(
    fixture.home,
    ".cache/skillerie/other-repo/generations/g1/opencode/skills/linked",
  );
  await fixture.put(
    join(generation, "SKILL.md"),
    "---\nname: linked\ndescription: Use when linked.\n---\nLinked.\n",
  );
  await symlink(generation, join(fixture.homes.opencode, "skills/linked"));
  // When: the engine inventories the homes.
  const result = await inventoryRepo(fixture.repo, { env: fixture.env });
  // Then: the linked skill is skipped like any other skillerie-managed content.
  expect(result.entries.map((entry) => entry.name)).not.toContain("linked");
});

it("keeps scanning a file skillerie only merges blocks into", async () => {
  // Given: the Codex config is a manifest merge entry, as after an install with MCP servers.
  await fixture.put(
    join(fixture.homes.codex, ".skillerie/manifest.json"),
    JSON.stringify({
      version: 1,
      harness: "codex",
      engineVersion: "0.0.0",
      repo: { path: fixture.repo, configHash: "fixture" },
      createdDirectories: [],
      entries: [
        {
          target: join(fixture.homes.codex, "config.toml"),
          kind: "merge",
          fingerprint: "fixture",
          preimage: { kind: "absent" },
          merges: [],
        },
      ],
    }),
  );
  // When: all homes are scanned.
  const result = await inventoryRepo(fixture.repo, { env: fixture.env });
  // Then: the user's own server is still found, and the server inside skillerie's block is not.
  const tracker = result.entries.find((entry) => entry.kind === "mcp" && entry.name === "tracker");
  expect(tracker?.copies.map((copy) => copy.source)).toEqual(["opencode", "codex"]);
  expect(result.entries.some((entry) => entry.name === "managed")).toBe(false);
});
