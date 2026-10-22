import type { HarnessId, HarnessMap, JsonObject, Requires } from "./primitives.js";

/** Origin of an entity after whole-entity replacement by name. */
export type EntitySource = "starter" | "user" | "harness-scoped";

/** Common source provenance and applicability after configuration is applied. */
export interface Entity {
  readonly name: string;
  readonly file: string;
  readonly source: EntitySource;
  /** Required for harness-scoped sources; absent on shared sources. */
  readonly harness?: HarnessId;
  /** Final applicable harnesses; excluded entities remain discoverable for reference linting. */
  readonly harnesses: readonly HarnessId[];
  readonly requires?: Requires;
}

/** Parsed canonical skill fields; authored spellings are retained. */
export interface SkillFrontmatter {
  readonly name: string;
  readonly description: string;
  readonly "argument-hint"?: string;
  readonly "user-invocable"?: boolean;
  readonly "allowed-tools"?: string | readonly string[];
  readonly "disable-model-invocation"?: boolean;
  readonly license?: string;
  readonly compatibility?: string;
  readonly metadata?: JsonObject;
  readonly requires?: Requires;
}

/** Parsed agent fields; requested restrictions must be enforceable by each adapter. */
export interface AgentFrontmatter {
  readonly name: string;
  readonly description: string;
  readonly allowed_tools?: string | readonly string[];
  readonly skills?: readonly string[];
  readonly maxTurns?: number;
  readonly readOnly?: boolean;
  readonly noShell?: boolean;
  readonly requires?: Requires;
}

/** A regular support file, relative to its owning entity directory. */
export interface SupportFile {
  readonly relPath: string;
  readonly sourcePath: string;
  /** POSIX permission bits, including executable bits. */
  readonly mode: number;
}

/** A canonical skill and its support files, excluding nested skill roots. */
export interface Skill extends Entity {
  readonly dir: string;
  readonly frontmatter: SkillFrontmatter;
  readonly body: string;
  readonly supportFiles: readonly SupportFile[];
}

/** A named canonical agent prompt. */
export interface Agent extends Entity {
  readonly frontmatter: AgentFrontmatter;
  readonly body: string;
}

/** A Markdown rule with optional source-relative applicability globs. */
export interface Rule extends Entity {
  readonly paths: readonly string[];
  readonly body: string;
}

/** Global instructions merged with applicable rules by an adapter. */
export interface Instructions {
  readonly file: string;
  readonly body: string;
  readonly source: EntitySource;
}

/** Parsed server entry; transport-specific extensions are preserved as JSON. */
export interface McpServer extends JsonObject {
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly headers?: Readonly<Record<string, string>>;
}

/** MCP entries use whole-server replacement; null overrides remove a server. */
export interface McpConfig {
  readonly file: string;
  readonly mcpServers: Readonly<Record<string, McpServer>>;
  readonly harnessOverrides: HarnessMap<Readonly<Record<string, McpServer | null>>>;
  readonly settings: JsonObject;
}

/** One settings template; variables expand only in parsed string values. */
export interface HarnessTemplate {
  readonly file: string;
  readonly relPath: string;
  readonly format: "json" | "jsonc" | "toml" | "text";
  readonly content: string;
}

/** Templates indexed by their destination-relative path for one harness. */
export interface HarnessTemplates {
  readonly harness: HarnessId;
  readonly files: readonly HarnessTemplate[];
}

/** An opt-in file or directory that an adapter may describe as an install action. */
export interface Asset extends Entity {
  readonly sourcePath: string;
  readonly relPath: string;
  readonly kind: "file" | "directory";
}

/** A copy-if-missing file that becomes user-owned after installation. */
export interface Seed {
  readonly harness: HarnessId;
  readonly sourcePath: string;
  readonly relPath: string;
  readonly mode: number;
}

/** Effective entity copies after one harness's selection and overrides are applied. */
export interface HarnessSources {
  readonly skills: readonly Skill[];
  readonly agents: readonly Agent[];
  readonly rules: readonly Rule[];
  readonly assets: readonly Asset[];
}

/** Complete merged inventory; harnesses holds effective per-harness entity values. */
export interface SourceModel {
  readonly repoDir: string;
  readonly skills: readonly Skill[];
  readonly agents: readonly Agent[];
  readonly rules: readonly Rule[];
  readonly instructions?: Instructions;
  readonly mcp?: McpConfig;
  readonly templates: HarnessMap<HarnessTemplates>;
  readonly assets: readonly Asset[];
  readonly seeds: readonly Seed[];
  readonly bin: readonly SupportFile[];
  /** Retain the shared inventory above for diagnostics about excluded references. */
  readonly harnesses: HarnessMap<HarnessSources>;
}
