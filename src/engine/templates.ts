import { parseTree, printParseErrorCode } from "jsonc-parser";
import type { Node, ParseError } from "jsonc-parser";
import { parse, stringify } from "smol-toml";
import { expandVariables } from "../config/index.js";
import type { ExpansionVariables } from "../config/index.js";
import type { Diagnostic, HarnessTemplate } from "../core/types.js";

function pointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function expandTemplate(
  template: HarnessTemplate,
  variables: ExpansionVariables,
): { readonly template: HarnessTemplate; readonly diagnostics: readonly Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const expand = (value: string, jsonPath: string): string => {
    const result = expandVariables(value, variables);
    diagnostics.push(
      ...result.diagnostics.map((item) => ({ ...item, file: template.file, jsonPath })),
    );
    return result.value;
  };
  switch (template.format) {
    case "text":
      return { template, diagnostics };
    case "toml": {
      try {
        const parsed = parse(template.content);
        const visit = (value: unknown, path: string): unknown => {
          if (typeof value === "string") return expand(value, path);
          if (Array.isArray(value))
            return value.map((child: unknown, index) => visit(child, `${path}/${index}`));
          if (value !== null && typeof value === "object" && !(value instanceof Date))
            return Object.fromEntries(
              Object.entries(value).map(([key, child]) => [
                key,
                visit(child, `${path}/${pointer(key)}`),
              ]),
            );
          return value;
        };
        const content = stringify(
          Object.fromEntries(
            Object.entries(parsed).map(([key, value]) => [key, visit(value, `/${pointer(key)}`)]),
          ),
        );
        return { template: { ...template, content }, diagnostics };
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        diagnostics.push({
          severity: "error",
          code: "source.toml",
          message: error.message,
          file: template.file,
          line: "line" in error && typeof error.line === "number" ? error.line : 1,
        });
        return { template, diagnostics };
      }
    }
    case "json":
    case "jsonc": {
      const errors: ParseError[] = [];
      const root = parseTree(template.content, errors, {
        allowTrailingComma: template.format === "jsonc",
        disallowComments: template.format === "json",
      });
      for (const error of errors)
        diagnostics.push({
          severity: "error",
          code: "source.json",
          message: printParseErrorCode(error.error),
          file: template.file,
          line: template.content.slice(0, error.offset).split("\n").length,
        });
      if (!root || errors.length) return { template, diagnostics };
      const edits: { readonly offset: number; readonly length: number; readonly text: string }[] =
        [];
      const visit = (node: Node, path: string): void => {
        if (node.type === "string") {
          const value: unknown = node.value;
          if (typeof value === "string")
            edits.push({
              offset: node.offset,
              length: node.length,
              text: JSON.stringify(expand(value, path)),
            });
        } else if (node.type === "object") {
          for (const property of node.children ?? []) {
            const key: unknown = property.children?.[0]?.value;
            const value = property.children?.[1];
            if (typeof key === "string" && value) visit(value, `${path}/${pointer(key)}`);
          }
        } else if (node.type === "array") {
          node.children?.forEach((child, index) => visit(child, `${path}/${index}`));
        }
      };
      visit(root, "");
      let content = template.content;
      for (const edit of edits.sort((left, right) => right.offset - left.offset))
        content =
          content.slice(0, edit.offset) + edit.text + content.slice(edit.offset + edit.length);
      return { template: { ...template, content }, diagnostics };
    }
    default:
      return unreachable(template.format);
  }
}

function unreachable(value: never): never {
  throw new TypeError(`Unknown template format: ${String(value)}`);
}
