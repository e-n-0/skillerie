import type { Action, Diagnostic, ExternalRevision, HarnessId, JsonValue } from "../core/types.js";

export interface RepoIdentity {
  readonly path: string;
  readonly configHash: string;
}

export interface InstallOptions {
  readonly external?: readonly ExternalRevision[];
  readonly repo: RepoIdentity;
  readonly harness: HarnessId;
  readonly harnessHome: string;
  /** User home used to retain relative paths in backups. Defaults to harnessHome. */
  readonly home?: string;
  readonly actions: readonly Action[];
  readonly backupRoot: string;
  readonly engineVersion: string;
  readonly force?: boolean;
  readonly takeover?: boolean;
  /** Called after each journaled mutation; throwing simulates interruption. */
  readonly testHook?: (step: number) => void | Promise<void>;
}

export type Image =
  | { readonly kind: "absent" }
  | { readonly kind: "file"; readonly data: string; readonly mode: number }
  | { readonly kind: "link"; readonly source: string }
  | {
      readonly kind: "directory";
      readonly mode: number;
      readonly children: Readonly<Record<string, Image>>;
    };

export interface MergeRecord {
  readonly blockId: string;
  readonly format: "toml" | "json" | "text" | "array";
  readonly jsonPath: string;
  readonly added: readonly JsonValue[];
  readonly before: string;
  readonly after: string;
}

export interface ManagedEntry {
  readonly target: string;
  readonly kind: "owned" | "directory" | "merge";
  readonly fingerprint: string;
  readonly preimage: Image;
  readonly merges: readonly MergeRecord[];
}

export interface Manifest {
  readonly external?: readonly ExternalRevision[];
  readonly version: 1;
  readonly repo: RepoIdentity;
  readonly harness: HarnessId;
  readonly engineVersion: string;
  readonly entries: readonly ManagedEntry[];
  readonly createdDirectories: readonly string[];
}

export interface PlannedAction {
  readonly kind: "write" | "remove" | "mkdir";
  readonly target: string;
  readonly before: Image;
  readonly after: Image;
}

export interface InstallPlan {
  readonly actions: readonly PlannedAction[];
  readonly findings: readonly Diagnostic[];
  readonly manifest: Manifest;
}

export interface Journal {
  readonly version: 1;
  readonly next: number;
  readonly steps: readonly (PlannedAction & { readonly backup: string })[];
}

export class InstallError extends Error {
  override readonly name = "InstallError";
  constructor(
    readonly code: string,
    message: string,
    readonly file?: string,
  ) {
    super(message);
  }
}

export function assertNever(value: never): never {
  throw new TypeError(`Unsupported install variant: ${JSON.stringify(value)}`);
}
