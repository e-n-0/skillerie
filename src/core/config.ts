import type { AgentFrontmatter, SkillFrontmatter } from "./entities.js";
import type { HarnessMap, JsonObject } from "./primitives.js";

/** Normalized starter selection; user entities replace entire starter entities. */
export interface StarterOptions {
  readonly enabled: boolean;
  readonly exclude: readonly string[];
}

/** Entity configuration fields applied before authored frontmatter. */
export interface EntityOverride extends Partial<SkillFrontmatter>, Partial<AgentFrontmatter> {
  readonly enabled?: boolean;
  readonly paths?: readonly string[];
}

/** Disable lists win over enable lists regardless of precedence. */
export interface EntitySelection {
  readonly enabled: readonly string[];
  readonly disabled: readonly string[];
  readonly overrides: Readonly<Record<string, EntityOverride>>;
}

/** Global selection plus per-harness selection/override layers. */
export interface EntitySettings extends EntitySelection {
  readonly harnesses: HarnessMap<EntitySelection>;
}

/** Normalized harness settings; executable assets are never implicitly enabled. */
export interface ResolvedHarnessConfig {
  readonly enabled: boolean;
  /** Absolute installation root after environment and path expansion. */
  readonly path: string;
  readonly assets: readonly string[];
  readonly options: JsonObject;
  readonly replaceAgents: Readonly<Record<string, string>>;
}

/** Absolute named paths; additional names are available through paths variables. */
export interface ResolvedPaths {
  readonly repo: string;
  readonly home: string;
  readonly docs: string;
  readonly backup: string;
  readonly cache: string;
  readonly [name: string]: string;
}

/** Lint-only severity; off is not a diagnostic severity. */
export type LintSeverity = "error" | "warn" | "info" | "off";

/** Semantic lints configurable independently of syntax/schema errors. */
export interface LintSettings {
  readonly descriptionPrefix: { readonly value: string; readonly severity: LintSeverity };
  readonly structure: { readonly severity: LintSeverity };
  readonly questions: { readonly severity: LintSeverity; readonly allowProse: readonly string[] };
  readonly references: { readonly severity: LintSeverity };
}

/** A shell command run only by the engine after a successful install. */
export interface PostInstallHook {
  readonly command: string;
  readonly fatal: boolean;
}

/** Validated/defaulted version-1 configuration, not the raw YAML document. */
export interface ResolvedConfig {
  readonly version: 1;
  readonly dialect: 1;
  readonly starter: StarterOptions;
  readonly harnesses: HarnessMap<ResolvedHarnessConfig>;
  readonly paths: ResolvedPaths;
  readonly skills: EntitySettings;
  readonly agents: EntitySettings;
  readonly rules: EntitySettings;
  readonly assets: EntitySettings;
  readonly shared: { readonly agentsSkillsDir: "dedupe" | "preserve" };
  readonly lint: LintSettings;
  readonly generated: { readonly commit: boolean };
  readonly hooks: { readonly postInstall: readonly PostInstallHook[] };
  /** Optional semver range checked against the running engine at startup. */
  readonly engine?: string;
}
