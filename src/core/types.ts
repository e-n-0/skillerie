/**
 * Public engine contract. Import shared types from this entry point.
 * Paths are absolute unless explicitly named relPath. Arrays and records are
 * readonly; Buffer contents are borrowed and must not be mutated by consumers.
 */
export type * from "./primitives.js";
export type * from "./config.js";
export type * from "./entities.js";

import type { Buffer } from "node:buffer";
import type { ResolvedConfig } from "./config.js";
import type { SourceModel } from "./entities.js";
import type {
  ContentHash,
  Diagnostic,
  Environment,
  HarnessId,
  JsonObject,
  JsonValue,
  RequiresResult,
} from "./primitives.js";

/** A requirement decision associated with an unambiguous entity and harness. */
export interface EntityRequiresResult {
  readonly entityKind: "skill" | "agent" | "rule" | "asset";
  readonly name: string;
  readonly harness: HarnessId;
  readonly result: RequiresResult;
}

/** Immutable inputs sufficient to reproduce a generation without probing again. */
export interface InputSnapshot {
  readonly config: ResolvedConfig;
  /** Source-relative paths mapped to SHA-256 digests, including support files. */
  readonly sourceHashes: Readonly<Record<string, ContentHash>>;
  readonly requires: readonly EntityRequiresResult[];
  readonly engineVersion: string;
  /** Hash of the canonicalized snapshot payload, excluding this field. */
  readonly hash: ContentHash;
}

/** One generation entry. For symlinks, content is the link target string. */
export type RenderedFile =
  | {
      readonly kind: "file";
      readonly relPath: string;
      readonly content: Buffer | string;
      readonly mode: number;
    }
  | {
      readonly kind: "symlink";
      readonly relPath: string;
      readonly content: string;
      readonly mode: number;
    };

/** Pure adapter output; no installation side effects occur during rendering. */
export interface RenderResult {
  readonly files: readonly RenderedFile[];
  readonly diagnostics: readonly Diagnostic[];
  readonly metadata: JsonObject;
}

/**
 * Installation intent. All source/target paths are absolute. The engine owns
 * preimages, ownership, backups, locks, journaling, drift checks, and execution.
 * Link/copy/exclusiveTree sources may use the stable current generation path.
 */
export type Action =
  | { readonly kind: "link"; readonly source: string; readonly target: string }
  | { readonly kind: "copy"; readonly source: string; readonly target: string }
  | { readonly kind: "seed"; readonly source: string; readonly target: string }
  | {
      readonly kind: "mergeBlock";
      readonly target: string;
      readonly format: "toml" | "json" | "text";
      readonly blockId: string;
      readonly content: string;
    }
  | {
      readonly kind: "exclusiveTree";
      readonly source: string;
      readonly target: string;
      /** Relative entries retained even when not in the generated tree. */
      readonly preserve: readonly string[];
    }
  | {
      readonly kind: "jsonArrayMerge";
      readonly target: string;
      /** RFC 6901 pointer to the array, for example /skills. */
      readonly jsonPath: string;
      /** Stable ownership key used to restore this merge's preimage. */
      readonly blockId: string;
      /** Append unique values without removing unrelated existing entries. */
      readonly values: readonly JsonValue[];
    };

/** Native question schema limits; null means no declared upper bound. */
export interface QuestionLimits {
  readonly maxHeaderLength: number | null;
  readonly maxOptions: number | null;
  readonly maxQuestions: number | null;
  readonly multiSelect: boolean;
}

/** Only runtime-enforced permissions count; prose is not enforcement. */
export interface PermissionEnforcement {
  readonly toolAllowlist: boolean;
  readonly readOnly: boolean;
  readonly noShell: boolean;
}

/** Data consumed by shared conversions and restriction validation. */
export interface Capabilities {
  readonly toolMap: Readonly<Record<string, string>>;
  readonly questionLimits: QuestionLimits;
  readonly permissionEnforcement: PermissionEnforcement;
  readonly nativeAgentReplacements: Readonly<Record<string, string>>;
  readonly supportsCommands: boolean;
  readonly supportsRules: boolean;
}

/** Harness homes may separate runtime configuration and agent content. */
export interface HarnessPaths {
  readonly home: string;
  readonly configDir: string;
  readonly skillsDir: string;
  readonly agentsDir: string;
  readonly rulesDir: string;
  readonly assetsDir: string;
  readonly commandsDir?: string;
}

/** Probe captured by the engine; supportedRange is declared by the adapter. */
export interface HarnessVersionInfo {
  readonly supportedRange: string;
  readonly installed?: string;
  readonly executable?: string;
}

/** Inputs available to an adapter without discovering sources or global state. */
export interface ResolvedContext {
  readonly snapshot: InputSnapshot;
  readonly model: SourceModel;
  readonly harness: HarnessId;
  readonly paths: HarnessPaths;
  readonly harnessVersion: HarnessVersionInfo;
  readonly env: Environment;
}

/** A harness integration describes outputs/actions; the engine performs mutations. */
export interface Adapter {
  readonly id: HarnessId;
  readonly capabilities: Capabilities;
  /** Semver range used by doctor and recorded in the resolved context. */
  readonly supportedRange: string;
  defaultPaths(env: Environment): HarnessPaths;
  render(ctx: ResolvedContext): Promise<RenderResult>;
  /** generationDir is the stable current path, not an ephemeral staging directory. */
  targets(ctx: ResolvedContext, generationDir: string): readonly Action[];
  check?(ctx: ResolvedContext): Promise<readonly Diagnostic[]>;
  doctor?(ctx: ResolvedContext): Promise<readonly Diagnostic[]>;
}

/** An adapter module is loaded only when that harness is selected. */
export type AdapterLoader = () => Promise<{ readonly adapter: Adapter }>;
