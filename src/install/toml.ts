import { parse, TomlError } from "smol-toml";
import { InstallError } from "./types.js";

interface Definition {
  readonly path: readonly string[];
  readonly table: boolean;
  readonly sealed: boolean;
  readonly start: number;
  readonly end: number;
}

function prefix(parent: readonly string[], child: readonly string[]): boolean {
  return parent.length <= child.length && parent.every((part, index) => part === child[index]);
}

/** Decode quoted and dotted names with the TOML parser, rather than splitting on dots. */
function keyPath(document: string): readonly string[] {
  const path: string[] = [];
  let value: unknown = parse(document);
  while (value && typeof value === "object") {
    if (Array.isArray(value)) {
      value = value[0];
      continue;
    }
    const entry = Object.entries(value)[0];
    if (!entry) break;
    path.push(entry[0]);
    value = entry[1];
  }
  return path;
}

/** Keep source ranges: serialization would discard comments and unrelated formatting. */
function definitions(content: string): readonly Definition[] {
  parse(content);
  const result: Definition[] = [];
  let context: readonly string[] = [];
  let pending = "";
  let start = 0;
  for (const line of content.matchAll(/[^\n]+(?:\n|$)|\n/gu)) {
    const value = line[0];
    if (!pending && /^\s*(?:#|$)/u.test(value)) continue;
    if (!pending) start = line.index;
    pending += value;
    try {
      parse(pending);
    } catch (error) {
      if (!(error instanceof TomlError)) throw error;
      continue; // Arrays and multiline strings are not complete until their closing delimiter.
    }
    const end = line.index + value.length;
    if (/^\s*\[/u.test(pending)) {
      context = keyPath(pending);
      result.push({
        path: context,
        table: !/^\s*\[\[/u.test(pending),
        sealed: false,
        start,
        end,
      });
    } else {
      const key = /^((?:[^"'=]|"(?:\\.|[^"\\])*"|'[^']*')+)=/u.exec(pending)?.[1];
      if (key === undefined)
        throw new InstallError("merge.toml", "Cannot locate a TOML assignment.");
      const path = keyPath(`${key}=0`);
      result.push({ path: [...context, ...path], table: false, sealed: false, start, end });
      for (let length = 1; length < path.length; length += 1)
        result.push({
          path: [...context, ...path.slice(0, length)],
          table: true,
          sealed: true,
          start,
          end,
        });
    }
    pending = "";
  }
  return result;
}

function collisions(
  existing: readonly Definition[],
  managed: readonly Definition[],
): readonly (readonly string[])[] {
  const paths: (readonly string[])[] = [];
  for (const left of existing) {
    for (const right of managed) {
      if (prefix(left.path, right.path)) {
        if (
          (!left.table && !right.sealed) ||
          (left.path.length === right.path.length && !(left.sealed && right.sealed))
        )
          paths.push(left.path);
      } else if (prefix(right.path, left.path) && !right.table && !left.sealed) {
        paths.push(right.path);
      }
    }
  }
  const unique: (readonly string[])[] = [];
  for (const path of paths.sort((a, b) => a.length - b.length))
    if (!unique.some((other) => prefix(other, path))) unique.push(path);
  return unique;
}

export function tomlOwnership(before: string, managed: string) {
  const existing = definitions(before);
  const conflicts = collisions(existing, definitions(managed));
  const ranges: { start: number; end: number; readonly header: boolean }[] = [];
  for (const path of conflicts) {
    let previous: (typeof ranges)[number] | undefined;
    for (const definition of existing.filter((item) => !item.sealed && prefix(path, item.path))) {
      if (previous && !before.slice(previous.end, definition.start).trim())
        previous.end = definition.end;
      else {
        previous = {
          start: definition.start,
          end: definition.end,
          header: /^\s*\[/u.test(before.slice(definition.start, definition.end)),
        };
        ranges.push(previous);
      }
    }
  }
  let content = before;
  for (const range of [...ranges].sort((a, b) => b.start - a.start))
    content = content.slice(0, range.start) + content.slice(range.end);
  return {
    content,
    removed: ranges,
    conflicts: conflicts.map((path) => ({
      key: path.map((part) => (/^[\w-]+$/u.test(part) ? part : JSON.stringify(part))).join("."),
      jsonPath: "/" + path.map((part) => part.replace(/~/gu, "~0").replace(/\//gu, "~1")).join("/"),
    })),
  };
}

/** Reinsert displaced definitions next to surviving definitions, even after unrelated value edits. */
export function restoreTomlOwnership(current: string, before: string, managed: string): string {
  const { removed } = tomlOwnership(before, managed);
  if (!removed.length) return current;
  const original = definitions(before).filter(
    (item) =>
      !item.sealed && !removed.some((range) => range.start <= item.start && item.end <= range.end),
  );
  let restored = current;
  for (const range of [...removed].sort((a, b) => b.start - a.start)) {
    const actual = definitions(restored).filter((item) => !item.sealed);
    const next = original
      .filter((item) => item.start >= range.end)
      .map((item) =>
        actual.find(
          (candidate) =>
            candidate.table === item.table &&
            candidate.path.length === item.path.length &&
            prefix(candidate.path, item.path),
        ),
      )
      .find((item) => item !== undefined);
    const position = next?.start ?? (range.header ? restored.length : 0);
    const separator = position > 0 && restored[position - 1] !== "\n" ? "\n" : "";
    const value = before.slice(range.start, range.end);
    restored =
      restored.slice(0, position) +
      separator +
      value +
      (position < restored.length && !value.endsWith("\n") ? "\n" : "") +
      restored.slice(position);
  }
  return restored;
}

/** Parser failures belong to the destination, not to the repository configuration. */
export function atTomlTarget<T>(target: string, operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (!(error instanceof TomlError)) throw error;
    throw new InstallError("merge.toml", error.message, target);
  }
}
