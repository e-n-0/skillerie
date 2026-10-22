import type { Diagnostic, JsonObject } from "../core/types.js";
import { LineCounter, parseDocument } from "yaml";
import { isJsonObject } from "./json.js";

/** YAML parsed to JSON-compatible values; entity-specific fields are parsed at discovery. */
export interface FrontmatterResult {
  readonly frontmatter?: JsonObject;
  readonly body: string;
  readonly diagnostics: readonly Diagnostic[];
}

/** Parse a leading YAML fence with duplicate-key rejection and precise locations. */
export function parseFrontmatter(text: string, file: string): FrontmatterResult {
  const opening = /^(?:\uFEFF)?---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!opening) return { body: text, diagnostics: [] };
  const rest = text.slice(opening[0].length);
  const closing = /^---[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (!closing) {
    return {
      body: text,
      diagnostics: [
        {
          severity: "error",
          code: "frontmatter.fence",
          message: "Missing closing YAML fence.",
          file,
          line: 1,
        },
      ],
    };
  }
  const yaml = rest.slice(0, closing.index);
  const body = rest.slice(closing.index + closing[0].length);
  const lineCounter = new LineCounter();
  const document = parseDocument(yaml, {
    version: "1.2",
    schema: "core",
    uniqueKeys: true,
    stringKeys: true,
    resolveKnownTags: false,
    lineCounter,
  });
  const diagnostics: Diagnostic[] = [...document.errors, ...document.warnings].map((error) => ({
    severity: "error",
    code: "frontmatter.yaml",
    message: error.message,
    file,
    line: lineCounter.linePos(error.pos[0]).line + 1,
  }));
  if (diagnostics.length) return { body, diagnostics };
  try {
    const data: unknown = document.contents === null ? {} : document.toJS({ maxAliasCount: 100 });
    if (isJsonObject(data)) return { frontmatter: data, body, diagnostics };
    diagnostics.push({
      severity: "error",
      code: "frontmatter.mapping",
      message: "Frontmatter must be a JSON-compatible mapping.",
      file,
      line: 2,
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    diagnostics.push({
      severity: "error",
      code: "frontmatter.yaml",
      message: error.message,
      file,
      line: 2,
    });
  }
  return { body, diagnostics };
}
