import type { Diagnostic, ExternalRevision, HarnessId } from "../core/types.js";
import type { TreeDifference } from "../fs/index.js";
import type { RepoIdentity } from "../install/index.js";
import type { EngineOptions } from "./types.js";

export type LifecycleCommand = "install" | "uninstall" | "status" | "doctor";

export interface LifecycleOptions extends EngineOptions {
  readonly command: LifecycleCommand;
  readonly harness?: HarnessId;
  readonly check?: boolean;
  readonly force?: boolean;
  readonly takeover?: boolean;
  /** Called as each slow phase starts, with a short human description. */
  readonly onProgress?: (message: string) => void;
}

export interface InstallLine {
  readonly kind: "LINK" | "RELINK" | "BACKUP" | "MERGE" | "SEED" | "SKIP";
  readonly target: string;
}

export interface InstallationResult {
  readonly harness: HarnessId;
  readonly home: string;
  readonly installed: boolean;
  readonly owner?: RepoIdentity;
  readonly managedPaths: readonly string[];
  readonly actions: readonly InstallLine[];
  readonly userEdits: readonly string[];
}

export interface LifecycleResult {
  readonly profile?: string;
  readonly external?: readonly ExternalRevision[];
  readonly valid: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly installations: readonly InstallationResult[];
  readonly clean?: boolean;
  readonly drift?: readonly TreeDifference[];
}
