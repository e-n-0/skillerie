import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ScanContext } from "../../src/import/types.js";
import { hashText } from "../../src/import/shared.js";
import { scanOpencode } from "../../src/import/opencode.js";

let home: string | undefined;

afterEach(async () => {
  if (home !== undefined) await rm(home, { recursive: true, force: true });
  home = undefined;
});

async function createHome(): Promise<string> {
  home = await mkdtemp(join(tmpdir(), "skillerie-opencode-"));
  return home;
}

async function put(homeDir: string, relativePath: string, content: string): Promise<string> {
  const file = join(homeDir, relativePath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
  return file;
}

function context(homeDir: string, managed: (path: string) => boolean = () => false): ScanContext {
  return {
    env: { HOME: homeDir, PATH: process.env["PATH"] ?? "" },
    managed,
  };
}

describe("scanOpencode", () => {
  it("imports agents, instructions, and MCP servers", async () => {
    // Given OpenCode agent, instructions, and JSONC MCP configuration.
    const homeDir = await createHome();
    await put(
      homeDir,
      "agents/planner.md",
      "---\ndescription: Use when planning.\nmode: subagent\nmodel: anthropic/claude\npermission:\n  read: true\n---\nPlan before coding.\n",
    );
    await put(homeDir, "AGENTS.md", "Use pnpm.\n");
    const config = await put(
      homeDir,
      "opencode.jsonc",
      `{
  // A remote server keeps its OAuth client ID.
  "mcp": {
    "docs": {
      "type": "remote",
      "url": "https://docs.example.com/mcp",
      "headers": {
        "Authorization": "Bearer secret-value-with-length",
        "X-Mode": "safe"
      },
      "oauth": { "clientId": "docs-client" }
    },
    "tracker": {
      "type": "local",
      "enabled": false,
      "command": ["node", "/opt/tracker.js"],
      "environment": { "TRACKER_URL": "https://tracker.example.com" }
    }
  },
}`,
    );

    // When the home is scanned.
    const result = await scanOpencode(homeDir, context(homeDir));

    // Then supported content is mapped, and secret values are removed.
    const expectedAgent = `---
name: planner
description: Use when planning.
---
Plan before coding.
`;
    expect(result.diagnostics).toEqual([]);
    expect(result.items).toHaveLength(4);
    expect(result.items.find((item) => item.kind === "agent")).toMatchObject({
      kind: "agent",
      name: "planner",
      source: "opencode",
      path: join(homeDir, "agents/planner.md"),
      markdown: expectedAgent,
      hash: hashText(expectedAgent),
      dropped: ["mode", "model", "permission"],
    });
    expect(result.items.find((item) => item.kind === "instructions")).toMatchObject({
      kind: "instructions",
      name: "instructions",
      path: join(homeDir, "AGENTS.md"),
      content: "Use pnpm.\n",
      hash: hashText("Use pnpm.\n"),
    });
    expect(result.items.find((item) => item.kind === "mcp" && item.name === "docs")).toMatchObject({
      kind: "mcp",
      name: "docs",
      path: config,
      server: {
        url: "https://docs.example.com/mcp",
        headers: { "X-Mode": "safe" },
        oauth: { clientId: "docs-client" },
      },
      secrets: ["headers.Authorization"],
    });
    expect(
      result.items.find((item) => item.kind === "mcp" && item.name === "tracker"),
    ).toMatchObject({
      kind: "mcp",
      name: "tracker",
      server: {
        command: "node",
        args: ["/opt/tracker.js"],
        env: { TRACKER_URL: "https://tracker.example.com" },
      },
      secrets: [],
    });
  });

  it("skips managed agent files", async () => {
    // Given an agent file already managed by skillerie.
    const homeDir = await createHome();
    const agent = await put(
      homeDir,
      "agents/managed.md",
      "---\ndescription: Managed agent.\n---\nDo not import.\n",
    );

    // When the scan context marks that path as managed.
    const result = await scanOpencode(
      homeDir,
      context(homeDir, (path) => path === agent),
    );

    // Then the file is not inventoried.
    expect(result.items).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports invalid MCP JSONC as a diagnostic", async () => {
    // Given an invalid OpenCode JSONC file.
    const homeDir = await createHome();
    const config = await put(homeDir, "opencode.jsonc", '{ "mcp": { "docs": ');

    // When the home is scanned.
    const result = await scanOpencode(homeDir, context(homeDir));

    // Then the invalid file is reported instead of throwing.
    expect(result.items).toEqual([]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warn",
          code: "import.mcp",
          file: config,
        }),
      ]),
    );
  });
});
