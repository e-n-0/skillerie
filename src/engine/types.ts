import type {
  AdapterLoader,
  Diagnostic,
  Environment,
  HarnessId,
  InputSnapshot,
  SourceModel,
} from "../core/types.js";
import type { Generation, TreeDifference } from "../fs/index.js";

/** Dependencies captured once per invocation, including an optional test registry. */
export interface EngineOptions {
  /** Doctor resolves only from local external cache, without remote access. */
  readonly offlineExternal?: boolean;
  readonly env?: Environment;
  readonly adapters?: ReadonlyMap<HarnessId, AdapterLoader>;
  readonly engineVersion?: string;
  readonly os?: "darwin" | "linux";
}

export interface ValidationResult {
  readonly diagnostics: readonly Diagnostic[];
  readonly model?: SourceModel;
  readonly snapshot?: InputSnapshot;
}

export interface SyncOptions extends EngineOptions {
  readonly check?: boolean;
  readonly harness?: HarnessId;
}

export interface SyncResult extends ValidationResult {
  readonly drift: readonly TreeDifference[];
  readonly generation?: Generation;
}

export const HARNESS_IDS = ["opencode", "codex", "omo", "pi"] as const;

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
