import { applyEdits, modify, parse, parseTree } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";
import type { JsonObject, JsonValue } from "../core/types.js";
import { InstallError } from "./types.js";

export function jsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item: unknown) => jsonValue(item));
  return (
    typeof value === "object" && Object.values(value).every((item: unknown) => jsonValue(item))
  );
}

export function parseJson(content: string): JsonValue {
  const errors: ParseError[] = [];
  const value: unknown = parse(content, errors, { allowTrailingComma: true });
  if (errors.length || !jsonValue(value))
    throw new InstallError("json.syntax", "Invalid JSON document.");
  return value;
}

function object(value: JsonValue | undefined): value is JsonObject {
  return (
    value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value)
  );
}

export function pointer(path: string): string[] {
  if (!path.startsWith("/") || /~(?![01])/u.test(path)) {
    throw new InstallError("json.pointer", `Invalid JSON pointer: ${path}`);
  }
  const parts = path
    .slice(1)
    .split("/")
    .map((part) => part.replace(/~1/gu, "/").replace(/~0/gu, "~"));
  if (parts.some((part) => ["__proto__", "prototype", "constructor"].includes(part))) {
    throw new InstallError("json.pointer", "Unsafe JSON pointer.");
  }
  return parts;
}

export function arrayAt(content: string, path: string): readonly JsonValue[] {
  let value: JsonValue | undefined = parseJson(content || "{}");
  for (const part of pointer(path)) {
    if (!object(value)) {
      throw new InstallError("json.pointer", "Array pointer traverses a non-object.");
    }
    value = value[part];
    if (value === undefined) return [];
  }
  if (!Array.isArray(value)) throw new InstallError("json.array", `Expected an array at ${path}`);
  return value;
}

export function setArray(content: string, path: string, values: readonly JsonValue[]): string {
  return applyEdits(
    content || "{}",
    modify(content || "{}", pointer(path), values, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    }),
  );
}

export function sameValue(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value: JsonValue, i: number) => {
        const other: JsonValue | undefined = right[i];
        return other !== undefined && sameValue(value, other);
      })
    );
  }
  if (object(left) && object(right)) {
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => {
        const a = left[key],
          b = right[key];
        return a !== undefined && b !== undefined && sameValue(a, b);
      })
    );
  }
  return false;
}

/** JSON blocks contain object members and comments, using the harness JSONC dialect. */
export function appendJsonBlock(content: string, block: string): string {
  const base = content || "{}";
  const root = parseTree(base);
  if (root?.type !== "object")
    throw new InstallError("json.object", "Managed JSON blocks require an object.");
  parseJson(base);
  const offset = root.offset + root.length - 1;
  const hasMembers = (root.children?.length ?? 0) > 0;
  const prefix = base.slice(0, offset);
  const separator = hasMembers && !/,\s*$/u.test(prefix) ? "," : "";
  return prefix + separator + "\n" + block + "\n" + base.slice(offset);
}
