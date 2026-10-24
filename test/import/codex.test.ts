import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Environment } from "../../src/core/types.js";
import { hashJson, hashText } from "../../src/import/shared.js";
import { scanCodex } from "../../src/import/codex.js";
import type { ScanContext } from "../../src/import/types.js";

let root = "";
let home = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "skillerie-codex-import-"));
  home = join(root, ".codex");
  await mkdir(home, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(relativePath: string, content: string): Promise<string> {
  const path = join(home, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return path;
}

function context(managed: ScanContext["managed"] = () => false): ScanContext {
  const env: Environment = { HOME: home, PATH: process.env["PATH"] ?? "" };
  return { env, managed };
}

it("scans Codex agents, instructions, and MCP servers", async () => {
  // Given: a Codex home with an agent, instructions, user MCP servers, and a managed block.
  await put(
    "agents/auditor.toml",
    'name = "auditor"\ndescription = "Audit dependencies."\ndeveloper_instructions = "Check dependency provenance."\nmodel = "gpt-5"\nmode = "subagent"\n',
  );
  const instructionsPath = await put("AGENTS.md", "Use pnpm.\n");
  const configPath = await put(
    "config.toml",
    `model = "gpt-5"

[mcp_servers.docs]
url = "https://docs.example.com/mcp"
bearer_token_env_var = "DOCS_TOKEN"
oauth_resource = "https://docs.example.com"
default_tools_approval_mode = "auto"
custom_setting = "kept"

[mcp_servers.docs.http_headers]
Authorization = "Bearer sk-live-0123456789abcdef"
X-Team = "core"

[mcp_servers.docs.oauth]
client_id = "docs-client"

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

  // When: the Codex home is scanned.
  const result = await scanCodex(home, context());

  // Then: supported items are translated, managed content is omitted, and secrets are scrubbed.
  const agent = result.items.find((item) => item.kind === "agent");
  expect(agent).toMatchObject({
    kind: "agent",
    name: "auditor",
    path: join(home, "agents/auditor.toml"),
    dropped: ["mode", "model"],
  });
  if (agent?.kind !== "agent") throw new Error("Expected an imported agent.");
  expect(agent.markdown).toContain("Check dependency provenance.");
  expect(agent.hash).toBe(hashText(agent.markdown));

  expect(result.items).toContainEqual({
    kind: "instructions",
    name: "instructions",
    source: "codex",
    path: instructionsPath,
    content: "Use pnpm.\n",
    hash: hashText("Use pnpm.\n"),
  });
  const docs = result.items.find((item) => item.kind === "mcp" && item.name === "docs");
  expect(docs).toMatchObject({
    kind: "mcp",
    path: configPath,
    server: {
      url: "https://docs.example.com/mcp",
      bearer_token_env_var: "DOCS_TOKEN",
      oauth_resource: "https://docs.example.com",
      oauth: { client_id: "docs-client" },
      headers: { "X-Team": "core" },
      custom_setting: "kept",
    },
    secrets: ["headers.Authorization"],
  });
  if (docs?.kind !== "mcp") throw new Error("Expected the docs MCP server.");
  expect(docs.server).not.toHaveProperty("default_tools_approval_mode");
  expect(docs.hash).toBe(hashJson(docs.server));
  expect(
    result.items.find((item) => item.kind === "mcp" && item.name === "managed"),
  ).toBeUndefined();

  const tracker = result.items.find((item) => item.kind === "mcp" && item.name === "tracker");
  expect(tracker).toMatchObject({
    kind: "mcp",
    server: {
      command: "node",
      args: ["/opt/tracker.js"],
      env: { TRACKER_URL: "https://tracker.example.com" },
    },
  });
  expect(result.diagnostics).toEqual([]);
});

it("skips Codex paths already managed by skillerie", async () => {
  // Given: valid Codex inputs whose paths are all marked as managed.
  const agentPath = await put("agents/auditor.toml", 'description = "Audit dependencies."\n');
  const instructionsPath = await put("AGENTS.md", "Use pnpm.\n");
  const configPath = await put(
    "config.toml",
    '[mcp_servers.docs]\nurl = "https://docs.example.com"\n',
  );
  const managed = new Set([agentPath, instructionsPath, configPath]);

  // When: the scanner sees each path as managed.
  const result = await scanCodex(
    home,
    context((path) => managed.has(path)),
  );

  // Then: none of the managed content is inventoried.
  expect(result.items).toEqual([]);
  expect(result.diagnostics).toEqual([]);
});

it("reports invalid Codex agent TOML", async () => {
  // Given: an agent file containing invalid TOML.
  const file = await put("agents/broken.toml", 'description = "unterminated\n');

  // When: the Codex home is scanned.
  const result = await scanCodex(home, context());

  // Then: the invalid file is skipped with an import diagnostic.
  expect(result.items).toEqual([]);
  expect(result.diagnostics).toEqual([
    expect.objectContaining({
      severity: "warn",
      code: "import.agent",
      file,
    }),
  ]);
});
