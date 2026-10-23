import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Diagnostic, Environment } from "../core/types.js";
import { configDocument } from "./document.js";
import { validateConfig } from "./input.js";
import { normalizeConfig } from "./normalize.js";
import { resolvePaths } from "./paths.js";
import { applyProfile } from "./profiles.js";
import type { LoadedConfig } from "./sources.js";
import { expandConfigValues } from "./variables.js";

export { expandVariables } from "./variables.js";
export type { ExpansionResult, ExpansionVariables } from "./variables.js";

/** Validation failures omit config and explain the failure with diagnostics. */
export interface LoadConfigResult {
  readonly config?: LoadedConfig;
  readonly diagnostics: readonly Diagnostic[];
}

/** Load YAML 1.2, reject duplicate keys, validate, default, and expand string values. */
export async function loadConfig(
  repoDir: string,
  env: Environment,
  options?: { readonly profile?: string },
): Promise<LoadConfigResult> {
  const file = resolve(repoDir, "skillerie.yaml");
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error)) throw error;
    return {
      diagnostics: [
        {
          severity: "error",
          code: "config.read",
          message: `Cannot read configuration: ${String(error.code)}.`,
          file,
          jsonPath: "",
        },
      ],
    };
  }
  const parsed = configDocument(source, file);
  if (parsed.diagnostics.length > 0) return { diagnostics: parsed.diagnostics };
  let value: unknown;
  try {
    value = parsed.document.toJS({ maxAliasCount: 100 });
    // Cyclic aliases cannot be represented by the JSON configuration contract.
    JSON.stringify(value);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return {
      diagnostics: [
        {
          severity: "error",
          code: "config.yaml",
          message: error.message,
          ...parsed.location(""),
        },
      ],
    };
  }
  if (!validateConfig(value)) {
    return {
      diagnostics: (validateConfig.errors ?? []).map(parsed.schemaDiagnostic),
    };
  }
  const applied = applyProfile(value, options?.profile);
  if (applied.config === undefined) {
    return {
      diagnostics: applied.diagnostics.map((item) => ({
        ...item,
        ...parsed.location(item.jsonPath ?? ""),
      })),
    };
  }
  const resolution = resolvePaths(repoDir, env, applied.config);
  if (resolution.diagnostics.length > 0) {
    return {
      diagnostics: resolution.diagnostics.map((item) => ({
        ...item,
        ...parsed.location(item.jsonPath ?? ""),
      })),
    };
  }
  const expanded = expandConfigValues(applied.config, {
    repo: resolution.paths.repo,
    home: resolution.paths.home,
    paths: resolution.paths,
  });
  if (expanded.diagnostics.length > 0) {
    return {
      diagnostics: expanded.diagnostics.map((item) => ({
        ...item,
        ...parsed.location(item.jsonPath ?? ""),
      })),
    };
  }
  const expandedValue = expanded.value;
  if (!validateConfig(expandedValue)) {
    return {
      diagnostics: (validateConfig.errors ?? []).map(parsed.schemaDiagnostic),
    };
  }
  return {
    config: normalizeConfig(
      {
        ...expandedValue,
        ...(applied.profile === undefined ? {} : { profile: applied.profile }),
      },
      resolution,
      env,
    ),
    diagnostics: [],
  };
}
