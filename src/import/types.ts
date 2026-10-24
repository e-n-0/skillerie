import type { Diagnostic, Environment, HarnessId, McpServer } from "../core/types.js";

/** Where an item was found: a harness home, or a shared location several harnesses read. */
export type ImportSource = HarnessId | "agents" | "claude";

export type ImportKind = "skill" | "agent" | "instructions" | "mcp";

interface FoundBase {
  readonly kind: ImportKind;
  /** Name in the config repository: skill folder, agent file stem, MCP server name, or "instructions". */
  readonly name: string;
  readonly source: ImportSource;
  /** Absolute path of the file or directory the item was read from. */
  readonly path: string;
  /** Content fingerprint from shared.ts; equal fingerprints mean identical copies. */
  readonly hash: string;
  /** Fields that could not be carried over, such as agent frontmatter skillerie doesn't support. */
  readonly dropped?: readonly string[];
}

export interface FoundSkill extends FoundBase {
  readonly kind: "skill";
  /** Skill-relative file paths, SKILL.md included, sorted. */
  readonly files: readonly string[];
}

export interface FoundAgent extends FoundBase {
  readonly kind: "agent";
  /** The agent in skillerie's dialect: frontmatter with name and description, then the body. */
  readonly markdown: string;
}

export interface FoundInstructions extends FoundBase {
  readonly kind: "instructions";
  readonly name: "instructions";
  readonly content: string;
}

export interface FoundMcp extends FoundBase {
  readonly kind: "mcp";
  /** The server in mcp.json shape, with secrets removed and harness-added defaults dropped. */
  readonly server: McpServer;
  /** Dotted fields removed because they looked like secrets, such as "headers.Authorization". */
  readonly secrets: readonly string[];
}

export type FoundItem = FoundSkill | FoundAgent | FoundInstructions | FoundMcp;

export interface ScanContext {
  readonly env: Environment;
  /** True when a path is already managed by skillerie: a link into its cache or a manifest entry. */
  readonly managed: (path: string) => boolean;
}

export interface ScanResult {
  readonly items: readonly FoundItem[];
  readonly diagnostics: readonly Diagnostic[];
}

/** One name of one kind, with every copy found across homes. */
export interface InventoryEntry {
  readonly kind: ImportKind;
  readonly name: string;
  readonly copies: readonly FoundItem[];
  /** True when every copy has the same fingerprint. */
  readonly identical: boolean;
  /** Whether the config repository already has this item, and whether it matches. */
  readonly inRepo: "absent" | "same" | "different";
}

/** What happened to one selected item when it was written into the repository. */
export interface ImportWrite {
  readonly kind: ImportKind;
  readonly name: string;
  readonly source: ImportSource;
  /** File or directory written, or that would have been written. */
  readonly target: string;
  readonly status: "written" | "unchanged" | "conflict";
  readonly note?: string;
}
