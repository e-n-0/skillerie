import type { Diagnostic, JsonValue } from "../core/types.js";

export interface ExpansionVariables {
  readonly repo: string;
  readonly home: string;
  readonly paths: Readonly<Record<string, string>>;
}

export interface ExpansionResult {
  readonly value: string;
  readonly diagnostics: readonly Diagnostic[];
}

/** Expand supported placeholders once; escaped and native placeholders remain literal. */
export function expandVariables(value: string, vars: ExpansionVariables): ExpansionResult {
  const diagnostics: Diagnostic[] = [];
  const expanded = value
    .replace(/^~/, () => vars.home)
    .replace(
      /\$\$\{([^}]*)\}|\$\{([^}]*)\}/g,
      (match: string, escaped: string | undefined, name: string | undefined): string => {
        if (escaped !== undefined) return `\${${escaped}}`;
        const replacement =
          name === "repo"
            ? vars.repo
            : name === "home"
              ? vars.home
              : name?.startsWith("paths.") && Object.hasOwn(vars.paths, name.slice(6))
                ? vars.paths[name.slice(6)]
                : undefined;
        if (replacement !== undefined) return replacement;
        diagnostics.push({
          severity: "error",
          code: "config.variable",
          message: `Unknown configuration variable ${match}.`,
        });
        return match;
      },
    );
  return { value: expanded, diagnostics };
}

export function pointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** Walk values, never mapping keys, retaining the location of expansion errors. */
export function expandConfigValues(value: JsonValue, vars: ExpansionVariables) {
  const diagnostics: Diagnostic[] = [];
  const visit = (entry: JsonValue, jsonPath: string): JsonValue => {
    if (typeof entry === "string") {
      const result = expandVariables(entry, vars);
      diagnostics.push(...result.diagnostics.map((item) => ({ ...item, jsonPath })));
      return result.value;
    }
    if (entry === null || typeof entry !== "object") return entry;
    if (Array.isArray(entry)) {
      return entry.map((child: JsonValue, index: number) => visit(child, `${jsonPath}/${index}`));
    }
    return Object.fromEntries(
      Object.entries(entry).map(([key, child]: [string, JsonValue]) => [
        key,
        visit(child, `${jsonPath}/${pointerSegment(key)}`),
      ]),
    );
  };
  return { value: visit(value, ""), diagnostics };
}
