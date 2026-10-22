/** Harness identifiers accepted by configuration version 1. */
export type HarnessId = "opencode" | "codex" | "omo" | "pi";

/** A sparse map; omitted harnesses are not configured or not applicable. */
export type HarnessMap<T> = Readonly<Partial<Record<HarnessId, T>>>;

/** JSON-compatible values after parsing; never unchecked external input. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;

/** Parsed extension/settings fields that the engine passes through unchanged. */
export type JsonObject = { readonly [key: string]: JsonValue };

/** Process environment captured by the caller, rather than read by renderers. */
export type Environment = Readonly<Record<string, string | undefined>>;

/** SHA-256 digest with an explicit algorithm prefix. */
export type ContentHash = `sha256:${string}`;

/** A validation finding; locations are optional for run-wide findings. */
export interface Diagnostic {
  readonly severity: "error" | "warn" | "info";
  readonly code: string;
  readonly message: string;
  /** Absolute local path or external origin URL@shortSHA/repository-path. */
  readonly file?: string;
  /** RFC 6901 JSON Pointer into the parsed document. */
  readonly jsonPath?: string;
  /** One-based source line. */
  readonly line?: number;
}

/** All specified requirement kinds and all entries within a kind must hold. */
export interface Requires {
  readonly bin?: string | readonly string[];
  /** Nonempty environment variables required to exist; values are never recorded. */
  readonly env?: string | readonly string[];
  readonly os?: "darwin" | "linux" | readonly ("darwin" | "linux")[];
  readonly harness?: HarnessId | readonly HarnessId[];
}

/** One evaluated requirement without storing environment values or secrets. */
export interface RequiresCheck {
  readonly kind: keyof Requires;
  readonly name: string;
  readonly satisfied: boolean;
}

/** Eligibility evaluated once for an entity/harness pair and retained in snapshots. */
export interface RequiresResult {
  readonly satisfied: boolean;
  readonly checks: readonly RequiresCheck[];
  /** Present when an explicit force override determined eligibility. */
  readonly forced?: boolean;
}
