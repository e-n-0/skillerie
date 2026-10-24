import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { afterEach, beforeEach, expect, it } from "vitest";
import { formatImportInventory, formatImportResult, runCli } from "../../src/cli.js";
import type { CliOptions } from "../../src/cli.js";
import { validateRepo } from "../../src/engine/index.js";
import { inventoryRepo } from "../../src/import/index.js";
import { importFixture, PROVIDER_KEY, SECRET_TOKEN } from "../import/fixture.js";

let fixture: Awaited<ReturnType<typeof importFixture>>;

beforeEach(async () => {
  fixture = await importFixture();
});

afterEach(async () => {
  await fixture.cleanup();
});

async function command(args: readonly string[], options: Pick<CliOptions, "prompt"> = {}) {
  const output: string[] = [];
  const errors: string[] = [];
  const code = await runCli(args, {
    env: fixture.env,
    color: false,
    stdout: (text) => {
      output.push(text);
    },
    stderr: (text) => {
      errors.push(text);
    },
    ...options,
  });
  return { code, stdout: output.join(""), stderr: errors.join("") };
}

it("lists grouped inventory without secrets or writes when --list is given", async () => {
  // Given: every supported home, differing copies, managed content, and secrets.
  // When: the CLI only inventories the setup.
  const result = await command(["import", "--repo", fixture.repo, "--list"]);
  // Then: compact rows explain each choice without exposing source content or paths.
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout).toContain("Skills:\n  1. claude-only  claude");
  expect(result.stdout).toContain("2. existing  pi  already in repo");
  expect(result.stdout).toContain("3. notes  omo");
  expect(result.stdout).toContain("4. review  opencode, codex, pi  differs: pick one");
  expect(result.stdout).toContain("Agents:");
  expect(result.stdout).toContain("planner  opencode  dropped: mode, model");
  expect(result.stdout).toContain("MCP servers:");
  expect(result.stdout).toContain("docs  opencode  needs secret: headers.Authorization");
  expect(result.stdout).toContain("tracker  opencode, codex  identical in 2 homes");
  expect(result.stdout).toContain("Instructions:");
  expect(result.stdout).toContain("instructions@omo");
  expect(result.stdout).toMatch(/Instructions:[\s\S]*Harness settings:/);
  expect(result.stdout).toContain(
    "codex/config.toml  codex  left out: mcp_servers, mcp_oauth_callback_port, projects, notice, tui, plugins",
  );
  expect(result.stdout).toContain(
    "opencode/opencode.jsonc  opencode  left out: mcp; needs secret: provider.anthropic.options.apiKey",
  );
  expect(result.stdout).toContain("mcp-settings  omo, pi  identical in 2 homes");
  expect(result.stdout).toContain("Run skillerie import <name>...");
  expect(result.stdout + result.stderr).not.toContain(SECRET_TOKEN);
  expect(result.stdout + result.stderr).not.toContain(PROVIDER_KEY);
  expect(result.stdout).not.toContain(fixture.home);
  expect(result.stdout).not.toContain("managed-skill");
  expect(result.stdout).not.toContain("builtin");
  expect(await readdir(join(fixture.repo, "skills"))).toEqual(["existing"]);
});

it("only lists inventory when no selection is provided outside a terminal", async () => {
  // Given: a complete setup and non-interactive CLI streams.
  // When: import receives no names.
  const result = await command(["import", "--repo", fixture.repo]);
  // Then: it succeeds without implicitly importing anything.
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout).toContain("Run skillerie import <name>... or --all to import");
  expect(await readdir(join(fixture.repo, "skills"))).toEqual(["existing"]);
});

it("imports unambiguous items but exits one when --all leaves differing copies", async () => {
  // Given: review and instructions differ between homes, and settings and MCP contain secrets.
  const originalMcp = await readFile(join(fixture.homes.opencode, "opencode.jsonc"), "utf8");
  const originalCodex = await readFile(join(fixture.homes.codex, "config.toml"), "utf8");
  // When: every item is requested through the CLI.
  const result = await command(["import", "--repo", fixture.repo, "--all"]);
  // Then: independent items are copied and validated, while unresolved copies stay out.
  expect(result.code).toBe(1);
  expect(result.stdout + result.stderr).toContain("review: pick one with name@source");
  expect(result.stdout + result.stderr).toContain("instructions: pick one with name@source");
  expect(result.stdout).toContain("imported notes@omo");
  expect(result.stdout).toContain(
    "imported codex/config.toml@codex -> harnesses/codex/templates/config.toml",
  );
  expect(result.stdout).toContain("unchanged existing");
  expect(result.stdout).toContain("headers.Authorization");
  expect(result.stdout).toMatch(/Valid: \d+ skills, \d+ agents, \d+ rules/);
  expect(result.stdout).toMatch(
    /Run skillerie install --check to see what install would change\.\n$/,
  );
  expect(await readFile(join(fixture.repo, "skills/notes/SKILL.md"), "utf8")).toContain(
    "name: notes",
  );
  expect(await readdir(join(fixture.repo, "agents"))).toEqual([
    "auditor.md",
    "critic.md",
    "planner.md",
    "scout.md",
  ]);
  await expect(access(join(fixture.repo, "skills/review"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const mcp = await readFile(join(fixture.repo, "mcp.json"), "utf8");
  expect(JSON.parse(mcp)).toMatchObject({
    settings: { timeoutMs: 30000 },
    mcpServers: {
      docs: { url: "https://docs.example.com/mcp" },
      search: { url: "https://search.example.com/mcp" },
      tracker: { command: "node", args: ["/opt/tracker.js"] },
    },
  });
  const codex = await readFile(join(fixture.repo, "harnesses/codex/templates/config.toml"), "utf8");
  expect(parseToml(codex)).toEqual({ model: "gpt-5", approval_policy: "on-request" });
  const files = await readdir(fixture.repo, { recursive: true, withFileTypes: true });
  const contents = await Promise.all(
    files
      .filter((file) => file.isFile())
      .map((file) => readFile(join(file.parentPath, file.name), "utf8")),
  );
  for (const secret of [SECRET_TOKEN, PROVIDER_KEY])
    expect(contents.join("") + result.stdout + result.stderr).not.toContain(secret);
  expect(await readFile(join(fixture.homes.opencode, "opencode.jsonc"), "utf8")).toBe(originalMcp);
  expect(await readFile(join(fixture.homes.codex, "config.toml"), "utf8")).toBe(originalCodex);
});

it.each(["codex/config.toml", "codex/config.toml@codex"])(
  "imports only the requested settings template when %s is selected",
  async (name) => {
    // Given: a settings file among skills, agents, instructions, and MCP servers.
    // When: its plain or source-qualified name is requested.
    const result = await command(["import", name, "--repo", fixture.repo, "--json"]);
    // Then: settings use the same name selection and write reporting as other kinds.
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      writes: [
        {
          kind: "settings",
          name: "codex/config.toml",
          source: "codex",
          target: join(fixture.repo, "harnesses/codex/templates/config.toml"),
          status: "written",
          note: expect.stringContaining("left out: mcp_servers"),
        },
      ],
      exitCode: 0,
    });
    expect(
      parseToml(
        await readFile(join(fixture.repo, "harnesses/codex/templates/config.toml"), "utf8"),
      ),
    ).toEqual({ model: "gpt-5", approval_policy: "on-request" });
    expect(await readdir(join(fixture.repo, "skills"))).toEqual(["existing"]);
    expect(await readFile(join(fixture.repo, "mcp.json"), "utf8")).toBe('{"mcpServers":{}}\n');
  },
);

it("reports the imported path and merge note when a settings template differs", async () => {
  // Given: an existing Codex template that must remain authoritative.
  const template = join(fixture.repo, "harnesses/codex/templates/config.toml");
  const original = 'model = "repo-model"\n';
  await fixture.put(template, original);
  // When: the differing harness settings are selected.
  const result = await command(["import", "codex/config.toml", "--repo", fixture.repo]);
  // Then: the result names the review file and explains the manual merge.
  expect(result.code, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain("imported codex/config.toml@codex -> imported/codex/config.toml");
  expect(result.stdout).toContain("merge imported/codex/config.toml into it");
  expect(await readFile(template, "utf8")).toBe(original);
  expect(
    parseToml(await readFile(join(fixture.repo, "imported/codex/config.toml"), "utf8")),
  ).toEqual({ model: "gpt-5", approval_policy: "on-request" });
});

it("imports a requested source and its support files when a name is qualified", async () => {
  // Given: three review copies, one with different content.
  const source = await readFile(join(fixture.homes.codex, "skills/review/SKILL.md"), "utf8");
  // When: the Codex copy is named explicitly.
  const result = await command(["import", "review@codex", "--repo", fixture.repo, "--json"]);
  // Then: the requested source, including its support file, is copied with a clean result.
  expect(result.code, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    writes: [{ name: "review", source: "codex", status: "written" }],
    exitCode: 0,
  });
  expect(await readFile(join(fixture.repo, "skills/review/SKILL.md"), "utf8")).toBe(source);
  expect(await readFile(join(fixture.repo, "skills/review/scripts/check.sh"), "utf8")).toBe(
    "echo check\n",
  );
});

it("reports unknown and ambiguous requests after importing the other names", async () => {
  // Given: an independent skill, an ambiguous skill, and a nonexistent name.
  // When: all three are requested together.
  const result = await command([
    "import",
    "notes",
    "review",
    "missing",
    "--repo",
    fixture.repo,
    "--json",
  ]);
  // Then: partial success remains visible and the requested failures set exit one.
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    writes: [{ name: "notes", status: "written" }],
    diagnostics: expect.arrayContaining([
      expect.objectContaining({ code: "import.unknown", severity: "error" }),
      expect.objectContaining({ code: "import.ambiguous", severity: "error" }),
    ]),
    exitCode: 1,
  });
  expect(await readFile(join(fixture.repo, "skills/notes/SKILL.md"), "utf8")).toContain(
    "name: notes",
  );
});

it("imports only the chosen numbered entry and source with an injected picker", async () => {
  // Given: the first inventory entry has a second copy and a same-named agent.
  await fixture.put(
    join(fixture.homes.opencode, "skills/claude-only/SKILL.md"),
    "---\nname: claude-only\ndescription: Use when Claude is needed.\n---\nDifferent copy.\n",
  );
  await fixture.put(
    join(fixture.homes.opencode, "agents/claude-only.md"),
    "---\ndescription: Use when Claude is needed.\n---\nAn agent, not the skill.\n",
  );
  const source = await readFile(join(fixture.home, ".claude/skills/claude-only/SKILL.md"), "utf8");
  const answers = ["1", "2"];
  // When: the first entry and its second source are selected.
  const result = await command(["import", "--repo", fixture.repo], {
    prompt: async () => {
      const answer = answers.shift();
      if (answer === undefined) throw new Error("Unexpected extra prompt");
      return answer;
    },
  });
  // Then: numbering selects one kind, and the source picker chooses exactly that copy.
  expect(result.code, result.stdout + result.stderr).toBe(0);
  expect(answers).toEqual([]);
  expect(await readdir(join(fixture.repo, "skills"))).toEqual(["claude-only", "existing"]);
  expect(await readFile(join(fixture.repo, "skills/claude-only/SKILL.md"), "utf8")).toBe(source);
  await expect(access(join(fixture.repo, "agents"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("selects ranges once when the interactive answer overlaps numbers", async () => {
  // Given: notes is row three and shared-tool is row five.
  // When: the picker receives an overlapping number and a one-element range.
  const result = await command(["import", "--repo", fixture.repo], {
    prompt: async () => "3,3,5-5",
  });
  // Then: only those skills are added, without duplicating writes.
  expect(result.code, result.stdout + result.stderr).toBe(0);
  expect(await readdir(join(fixture.repo, "skills"))).toEqual(["existing", "notes", "shared-tool"]);
  expect(result.stdout.match(/imported notes@omo/g)).toHaveLength(1);
});

it("imports numbered settings and their chosen source with the interactive picker", async () => {
  // Given: MCP settings differ between OMO and Pi.
  await fixture.put(
    join(fixture.homes.pi, "mcp.json"),
    '{"mcpServers": {}, "settings": {"timeoutMs": 9000}}\n',
  );
  const { entries } = await inventoryRepo(fixture.repo, { env: fixture.env });
  const row = entries.findIndex(
    (entry) => entry.kind === "settings" && entry.name === "mcp-settings",
  );
  expect(row).toBeGreaterThanOrEqual(0);
  const answers = [String(row + 1), "2"];
  // When: the settings row and its Pi copy are chosen.
  const result = await command(["import", "--repo", fixture.repo], {
    prompt: async () => {
      const answer = answers.shift();
      if (answer === undefined) throw new Error("Unexpected extra prompt");
      return answer;
    },
  });
  // Then: only the selected settings are written, not MCP servers or unrelated content.
  expect(result.code, result.stdout + result.stderr).toBe(0);
  expect(answers).toEqual([]);
  expect(result.stdout).toContain("imported mcp-settings@pi -> mcp.json");
  expect(JSON.parse(await readFile(join(fixture.repo, "mcp.json"), "utf8"))).toEqual({
    mcpServers: {},
    settings: { timeoutMs: 9000 },
  });
  expect(await readdir(join(fixture.repo, "skills"))).toEqual(["existing"]);
});

it("cancels without writes when the interactive answer is empty", async () => {
  // Given: an injected terminal picker.
  // When: the user presses Enter.
  const result = await command(["import", "--repo", fixture.repo], { prompt: async () => "" });
  // Then: cancellation succeeds without importing anything.
  expect(result.code, result.stderr).toBe(0);
  expect(await readdir(join(fixture.repo, "skills"))).toEqual(["existing"]);
});

it.each(["0", "2-1", "1-99999999999999", "nope", "1,99"])(
  "rejects invalid interactive selection %s without partial writes",
  async (answer) => {
    // Given: an invalid or out-of-range numbered selection.
    // When: the picker parses it.
    const result = await command(["import", "--repo", fixture.repo], {
      prompt: async () => answer,
    });
    // Then: the boundary returns a diagnostic rather than importing a prefix.
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain("import.selection");
    expect(await readdir(join(fixture.repo, "skills"))).toEqual(["existing"]);
  },
);

it("never prompts or serializes content when JSON inventory is requested", async () => {
  // Given: an injectable picker that must not be used in machine-readable mode.
  // When: JSON import runs without a selection.
  const result = await command(["--json", "import", "--repo", fixture.repo], {
    prompt: async () => {
      throw new Error("JSON output must not prompt");
    },
  });
  // Then: one metadata envelope includes locations and settings notes but no imported values.
  expect(result.code, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    entries: expect.arrayContaining([
      expect.objectContaining({
        name: "review",
        copies: expect.arrayContaining([
          expect.objectContaining({
            source: "codex",
            path: join(fixture.homes.codex, "skills/review"),
          }),
        ]),
      }),
      expect.objectContaining({
        kind: "settings",
        name: "opencode/opencode.jsonc",
        copies: [
          {
            kind: "settings",
            name: "opencode/opencode.jsonc",
            source: "opencode",
            path: join(fixture.homes.opencode, "opencode.jsonc"),
            hash: expect.any(String),
            excluded: ["mcp"],
            secrets: ["provider.anthropic.options.apiKey"],
          },
        ],
      }),
    ]),
    diagnostics: [],
    exitCode: 0,
  });
  expect(result.stdout).not.toMatch(/"(markdown|content|server|value)":/);
  expect(result.stdout).not.toContain(SECRET_TOKEN);
  expect(result.stdout).not.toContain(PROVIDER_KEY);
  expect(result.stderr).toBe("");
});

it("restricts inventory to the requested harness", async () => {
  // Given: the complete fixture spans all harnesses and shared homes.
  // When: only OpenCode is inventoried.
  const result = await command([
    "import",
    "--repo",
    fixture.repo,
    "--harness",
    "opencode",
    "--list",
    "--json",
  ]);
  // Then: every entry is exclusively from OpenCode.
  const { entries } = await inventoryRepo(fixture.repo, { env: fixture.env, harness: "opencode" });
  expect(result.code, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    entries: entries.map((entry) => ({
      name: entry.name,
      copies: [{ source: "opencode" }],
    })),
    exitCode: 0,
  });
});

it("returns exit two and no writes when configuration is invalid", async () => {
  // Given: an unsupported configuration version.
  await fixture.put(join(fixture.repo, "skillerie.yaml"), "version: 999\n");
  // When: import tries to load the repository.
  const result = await command(["import", "--repo", fixture.repo, "--all", "--json"]);
  // Then: configuration errors use their distinct exit code.
  expect(result.code).toBe(2);
  expect(JSON.parse(result.stdout)).toMatchObject({
    entries: [],
    diagnostics: [expect.objectContaining({ severity: "error" })],
    exitCode: 2,
  });
  expect(await readdir(join(fixture.repo, "skills"))).toEqual(["existing"]);
});

it("preserves conflicting repository content and reports exit one", async () => {
  // Given: a repository skill differs from its harness copy.
  const original = "---\nname: notes\ndescription: Use when taking notes.\n---\nKeep mine.\n";
  await fixture.put(join(fixture.repo, "skills/notes/SKILL.md"), original);
  // When: that skill is requested.
  const result = await command(["import", "notes", "--repo", fixture.repo, "--json"]);
  // Then: no overwrite occurs and the conflict sets exit one.
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    writes: [{ name: "notes", status: "conflict" }],
    exitCode: 1,
  });
  expect(await readFile(join(fixture.repo, "skills/notes/SKILL.md"), "utf8")).toBe(original);
});

it("scaffolds and lists existing content when init --import is non-interactive", async () => {
  // Given: a new destination beside the fixture repository.
  const destination = join(fixture.root, "new-repo");
  // When: init enables OpenCode and hands off to import.
  const result = await command(["init", destination, "--harness", "opencode", "--import"]);
  // Then: onboarding creates the scaffold and lists without choosing any existing content.
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout).toContain(`Initialized ${destination}`);
  expect(result.stdout).toContain("npx skillerie import\n");
  expect(result.stdout).toContain("Skills:");
  expect(result.stdout).toContain("review  opencode, codex, pi");
  expect(await readdir(join(destination, "skills"))).toEqual([".gitkeep"]);
  expect(await readFile(join(destination, "skillerie.yaml"), "utf8")).toContain("opencode:");
});

it("emits one import envelope when init --import uses JSON", async () => {
  // Given: a new destination and machine-readable onboarding.
  const destination = join(fixture.root, "json-repo");
  // When: init hands off to import with the global JSON flag.
  const result = await command([
    "init",
    destination,
    "--import",
    "--harness",
    "opencode",
    "--json",
  ]);
  // Then: stdout is one JSON object, not separate init and inventory documents.
  expect(result.code, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    entries: expect.arrayContaining([expect.objectContaining({ name: "notes" })]),
    diagnostics: [],
    exitCode: 0,
  });
});

it("does not scan homes when init fails to create its scaffold", async () => {
  // Given: the destination already contains scaffold files.
  // When: init --import fails its conflict check.
  const result = await command(["init", fixture.repo, "--import", "--json"]);
  // Then: only the init failure is emitted.
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    valid: false,
    diagnostics: expect.arrayContaining([expect.objectContaining({ code: "init.conflict" })]),
  });
  expect(result.stdout).not.toContain('"entries":');
});

it("formats a plain numbered inventory including repository differences", async () => {
  // Given: a conflicting repository skill and the engine's ordered inventory.
  await fixture.put(join(fixture.repo, "skills/notes/SKILL.md"), "Different notes.\n");
  const { entries } = await inventoryRepo(fixture.repo, { env: fixture.env });
  // When: plain formatting is requested.
  const text = formatImportInventory(entries, { color: false, home: fixture.home });
  // Then: headings, stable numbering, and comparison notes remain readable without ANSI or paths.
  expect(text).toContain("3. notes  omo  differs from the repo");
  expect(text).toContain("12. tracker  opencode, codex  identical in 2 homes");
  expect(text).not.toContain("\x1b");
  expect(text).not.toContain(fixture.home);
  expect(formatImportInventory([], { color: false })).toBe(
    "Nothing to import: every harness home is empty or already managed by skillerie.\n",
  );
});

it("formats plain write statuses, notes, warnings, and validation with short paths", async () => {
  // Given: the three write outcomes and a real valid repository.
  const validation = await validateRepo(fixture.repo, { env: fixture.env });
  // When: a report is formatted without color.
  const text = formatImportResult(
    {
      writes: [
        {
          kind: "skill",
          name: "notes",
          source: "omo",
          target: join(fixture.home, "repo/skills/notes"),
          status: "written",
        },
        {
          kind: "agent",
          name: "planner",
          source: "opencode",
          target: "/repo/agents/planner.md",
          status: "unchanged",
          note: "dropped: mode, model",
        },
        {
          kind: "mcp",
          name: "docs",
          source: "opencode",
          target: "/repo/mcp.json",
          status: "conflict",
          note: "already in the repository with different content",
        },
      ],
      diagnostics: [
        {
          severity: "warn",
          code: "import.secret",
          message: "Server docs: removed secrets: headers.Authorization",
          file: join(fixture.home, ".config/opencode/opencode.jsonc"),
        },
      ],
      validation,
    },
    { color: false, home: fixture.home },
  );
  // Then: every status and warning is visible, followed by validation and the install preview.
  expect(text).toContain("imported notes@omo -> ~/repo/skills/notes");
  expect(text).toContain(
    "unchanged planner@opencode -> /repo/agents/planner.md (dropped: mode, model)",
  );
  expect(text).toContain("conflict docs@opencode -> /repo/mcp.json");
  expect(text).toContain("warn import.secret");
  expect(text).toContain("Valid: 1 skill, 0 agents, 0 rules for opencode, codex, omo, pi.");
  expect(text).toMatch(/Run skillerie install --check to see what install would change\.\n$/);
  expect(text).not.toContain("\x1b");
});

it("offers identical copies as one choice when a group differs", async () => {
  // Given: review is identical in OpenCode and Codex but differs in Pi.
  const questions: string[] = [];
  const answers = ["4", "2"];
  // When: review is picked interactively and the second choice is taken.
  const result = await command(["import", "--repo", fixture.repo], {
    prompt: async (question) => {
      questions.push(question);
      return answers.shift() ?? "";
    },
  });
  // Then: the inventory and prompt list two choices, and the second one is Pi's copy.
  expect(result.code, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain("differs: pick one (review@opencode (same as codex), review@pi)");
  expect(questions).toHaveLength(2);
  expect(await readFile(join(fixture.repo, "skills/review/SKILL.md"), "utf8")).toContain("Pi way");
});

it("never echoes file content when a harness file fails to parse", async () => {
  // Given: a Codex config whose unterminated string holds a credential.
  const leaked = "parse-leak-0123456789"; // gitleaks:allow (fake value for secret tests)
  await fixture.put(
    join(fixture.homes.codex, "config.toml"),
    `api_key = "${leaked}\n[mcp_servers.x]\n`,
  );
  // When: the inventory is printed as text and as JSON.
  const text = await command(["import", "--list", "--repo", fixture.repo]);
  const json = await command(["--json", "import", "--list", "--repo", fixture.repo]);
  // Then: the parse failure is reported by location only.
  expect(text.stdout + text.stderr).toContain("Invalid TOML at line");
  expect(text.stdout + text.stderr + json.stdout + json.stderr).not.toContain(leaked);
});
