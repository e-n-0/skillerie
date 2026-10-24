import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Environment } from "../../src/core/types.js";

/** Bearer value written into the OpenCode MCP config; it must never reach the repository. */
export const SECRET_TOKEN = "sk-live-0123456789abcdef"; // gitleaks:allow (fake value for secret tests)

const skill = (name: string, body = "Review the change.\n") =>
  `---\nname: ${name}\ndescription: Use when ${name} is needed.\n---\n${body}`;

/**
 * A fake HOME with every harness format, plus an init-like config repository.
 * Expected inventory (kind name: sources, notes):
 * - skill review: opencode, codex identical; pi differs. Support file scripts/check.sh in opencode and codex.
 * - skill notes: omo. skill shared-tool: agents. skill claude-only: claude. skill existing: pi, same as the repo.
 * - skipped skills: codex .system/builtin, opencode managed-skill (link into the skillerie cache).
 * - agent planner: opencode, drops mode and model. agent auditor: codex (TOML). agent scout: pi. agent critic: claude.
 * - instructions: opencode and codex "Use pnpm." identical; omo "Prefer bun." differs; claude CLAUDE.md differs.
 * - mcp docs: opencode, secret headers.Authorization removed. mcp tracker: opencode and codex identical.
 * - mcp search: omo and pi identical. skipped: codex "managed" server inside a skillerie block.
 */
export async function importFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "skillerie-import-")));
  const home = join(root, "home");
  const repo = join(root, "repo");
  const cache = join(root, "cache");
  const env: Environment = { HOME: home, PATH: process.env["PATH"] ?? "" };
  const put = async (path: string, content: string) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  };
  const opencode = join(home, ".config", "opencode");
  const codex = join(home, ".codex");
  const omo = join(home, ".omo", "agent");
  const pi = join(home, ".pi", "agent");

  await put(join(opencode, "skills/review/SKILL.md"), skill("review"));
  await put(join(opencode, "skills/review/scripts/check.sh"), "echo check\n");
  await put(
    join(cache, "generations/g1/opencode/skills/managed-skill/SKILL.md"),
    skill("managed-skill"),
  );
  await symlink(
    join(cache, "generations/g1/opencode/skills/managed-skill"),
    join(opencode, "skills/managed-skill"),
  );
  await put(
    join(opencode, "agents/planner.md"),
    "---\ndescription: Use when planning work.\nmode: subagent\nmodel: anthropic/claude\n---\nPlan before coding.\n",
  );
  await put(join(opencode, "AGENTS.md"), "Use pnpm.\n");
  await put(
    join(opencode, "opencode.jsonc"),
    `{
  // user config
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "docs": {
      "type": "remote",
      "url": "https://docs.example.com/mcp",
      "headers": { "Authorization": "Bearer ${SECRET_TOKEN}" }
    },
    "tracker": {
      "type": "local",
      "command": ["node", "/opt/tracker.js"],
      "environment": { "TRACKER_URL": "https://tracker.example.com" }
    }
  }
}
`,
  );

  await put(join(codex, "skills/review/SKILL.md"), skill("review"));
  await put(join(codex, "skills/review/scripts/check.sh"), "echo check\n");
  await put(join(codex, "skills/.system/builtin/SKILL.md"), skill("builtin"));
  await put(
    join(codex, "agents/auditor.toml"),
    'name = "auditor"\ndescription = "Use when auditing dependencies."\ndeveloper_instructions = """\nAudit every dependency.\n"""\n',
  );
  await put(join(codex, "AGENTS.md"), "Use pnpm.\n");
  await put(
    join(codex, "config.toml"),
    `model = "gpt-5"

[mcp_servers.tracker]
command = "node"
args = ["/opt/tracker.js"]
default_tools_approval_mode = "auto"

[mcp_servers.tracker.env]
TRACKER_URL = "https://tracker.example.com"

# skillerie:codex.mcp.tables:begin
[mcp_servers.managed]
url = "https://managed.example.com/mcp"
# skillerie:codex.mcp.tables:end
`,
  );

  await put(join(omo, "skills/notes/SKILL.md"), skill("notes"));
  await put(join(omo, "AGENTS.md"), "Prefer bun.\n");
  await put(
    join(omo, "mcp.json"),
    JSON.stringify({ mcpServers: { search: { url: "https://search.example.com/mcp" } } }, null, 2),
  );

  await put(join(pi, "skills/review/SKILL.md"), skill("review", "Review it the Pi way.\n"));
  await put(join(pi, "skills/existing/SKILL.md"), skill("existing"));
  await put(
    join(pi, "agents/scout.md"),
    "---\nname: scout\ndescription: Use when scouting a codebase.\ntools: read, grep\n---\nScout first.\n",
  );
  await put(
    join(pi, "mcp.json"),
    JSON.stringify({ mcpServers: { search: { url: "https://search.example.com/mcp" } } }, null, 2),
  );

  await put(join(home, ".agents/skills/shared-tool/SKILL.md"), skill("shared-tool"));
  await put(join(home, ".claude/skills/claude-only/SKILL.md"), skill("claude-only"));
  await put(
    join(home, ".claude/agents/critic.md"),
    "---\nname: critic\ndescription: Use when critiquing a plan.\n---\nFind the weakest step.\n",
  );
  await put(join(home, ".claude/CLAUDE.md"), "Be concise.\n");

  await put(
    join(repo, "skillerie.yaml"),
    `version: 1\nharnesses:\n  opencode:\n    enabled: true\n  codex:\n    enabled: true\n  omo:\n    enabled: true\n  pi:\n    enabled: true\npaths:\n  cache: ${cache}\n`,
  );
  await put(
    join(repo, "instructions.md"),
    "# Shared instructions\n\nDescribe your coding conventions, preferred tools, and verification steps here.\n",
  );
  await put(join(repo, "mcp.json"), '{"mcpServers":{}}\n');
  await put(join(repo, "skills/existing/SKILL.md"), skill("existing"));

  return {
    root,
    home,
    repo,
    cache,
    env,
    homes: { opencode, codex, omo, pi },
    put,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
