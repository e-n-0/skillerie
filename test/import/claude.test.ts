import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ScanContext } from "../../src/import/types.js";
import { hashText } from "../../src/import/shared.js";
import { scanClaude } from "../../src/import/claude.js";

let home: string | undefined;

afterEach(async () => {
  if (home !== undefined) await rm(home, { recursive: true, force: true });
  home = undefined;
});

async function createHome(): Promise<string> {
  home = await mkdtemp(join(tmpdir(), "skillerie-claude-"));
  return home;
}

async function put(homeDir: string, relativePath: string, content: string): Promise<string> {
  const file = join(homeDir, relativePath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
  return file;
}

function context(managed: (path: string) => boolean = () => false): ScanContext {
  return { env: {}, managed };
}

describe("scanClaude", () => {
  it("imports Markdown agents and CLAUDE.md instructions", async () => {
    // Given a Claude home with an agent and instructions.
    const homeDir = await createHome();
    const agentPath = await put(
      homeDir,
      "agents/critic.md",
      "---\nname: reviewer\ndescription: Review proposed changes.\nmodel: sonnet\ntools:\n  - Read\n---\nFind the weakest assumption.\n",
    );
    const instructionsPath = await put(homeDir, "CLAUDE.md", "Prefer concise answers.\n");
    const markdown = `---
name: reviewer
description: Review proposed changes.
---
Find the weakest assumption.
`;

    // When the Claude home is scanned.
    const result = await scanClaude(homeDir, context());

    // Then the agent is converted and instructions are fingerprinted.
    expect(result.diagnostics).toEqual([]);
    expect(result.items).toHaveLength(2);
    expect(result.items.find((item) => item.kind === "agent")).toMatchObject({
      kind: "agent",
      name: "reviewer",
      source: "claude",
      path: agentPath,
      markdown,
      hash: hashText(markdown),
      dropped: ["model", "tools"],
    });
    expect(result.items.find((item) => item.kind === "instructions")).toMatchObject({
      kind: "instructions",
      name: "instructions",
      source: "claude",
      path: instructionsPath,
      content: "Prefer concise answers.\n",
      hash: hashText("Prefer concise answers.\n"),
    });
  });

  it("skips a managed agent path", async () => {
    // Given an agent path already managed by skillerie.
    const homeDir = await createHome();
    const agentPath = await put(
      homeDir,
      "agents/managed.md",
      "---\ndescription: Already managed.\n---\nDo not import.\n",
    );

    // When the scan context marks that path as managed.
    const result = await scanClaude(
      homeDir,
      context((path) => path === agentPath),
    );

    // Then the managed agent is not inventoried.
    expect(result.items).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports invalid agent frontmatter as a diagnostic", async () => {
    // Given an agent with an unterminated frontmatter fence.
    const homeDir = await createHome();
    const agentPath = await put(
      homeDir,
      "agents/broken.md",
      "---\nname: broken\ndescription: Invalid frontmatter.\nAgent body without a closing fence.\n",
    );

    // When the Claude home is scanned.
    const result = await scanClaude(homeDir, context());

    // Then the invalid file is reported instead of throwing.
    expect(result.items).toEqual([]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "frontmatter.fence",
          file: agentPath,
        }),
      ]),
    );
  });
});
