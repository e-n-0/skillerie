import { parse as parseToml } from "smol-toml";
import type { Action } from "../core/types.js";
import { appendJsonBlock, arrayAt, parseJson, sameValue, setArray } from "./json.js";
import { assertNever, InstallError } from "./types.js";
import type { MergeRecord } from "./types.js";
import { atTomlTarget, restoreTomlOwnership, tomlOwnership } from "./toml.js";

type MergeAction = Extract<Action, { readonly kind: "mergeBlock" | "jsonArrayMerge" }>;

function markers(id: string, format: string): readonly [string, string] {
  const comment = format === "json" ? "//" : "#";
  return [`${comment} skillerie:${id}:begin`, `${comment} skillerie:${id}:end`];
}

function sections(content: string, record: Pick<MergeRecord, "blockId" | "format">) {
  const found: { start: number; end: number; value: string }[] = [];
  for (const suffix of ["", ".root", ".tables"]) {
    const [begin, end] = markers(record.blockId + suffix, record.format);
    const start = content.indexOf(begin);
    if (start < 0) continue;
    const finish = content.indexOf(end, start + begin.length);
    if (finish < 0 || content.indexOf(begin, start + begin.length) >= 0) {
      throw new InstallError("merge.markers", `Ambiguous managed block: ${record.blockId}`);
    }
    const last = finish + end.length + (content[finish + end.length] === "\n" ? 1 : 0);
    found.push({ start, end: last, value: content.slice(start, last) });
  }
  return found.sort((a, b) => a.start - b.start);
}

export function mergeIntact(record: MergeRecord, current: string): boolean {
  switch (record.format) {
    case "array": {
      const values = arrayAt(current, record.jsonPath);
      return record.added.every((added) => values.some((value) => sameValue(added, value)));
    }
    case "toml":
    case "json":
    case "text": {
      const expected = sections(record.after, record).map((section) => section.value);
      const actual = sections(current, record).map((section) => section.value);
      return JSON.stringify(expected) === JSON.stringify(actual);
    }
    default:
      return assertNever(record.format);
  }
}

export function restoreMerge(current: string, record: MergeRecord): string {
  if (current === record.after) return record.before;
  switch (record.format) {
    case "array": {
      const remaining = arrayAt(current, record.jsonPath).filter(
        (value) => !record.added.some((added) => sameValue(value, added)),
      );
      return setArray(current, record.jsonPath, remaining);
    }
    case "toml":
    case "json":
    case "text": {
      let restored = current;
      const originals = sections(record.before, record);
      for (const section of sections(current, record).reverse()) {
        const replacement = originals.find(
          (original) => original.value.split("\n")[0] === section.value.split("\n")[0],
        );
        restored =
          restored.slice(0, section.start) +
          (replacement?.value ?? "") +
          restored.slice(section.end);
      }
      return record.format === "toml"
        ? restoreTomlOwnership(
            restored,
            unmanaged(record.before, record),
            sections(record.after, record)
              .map((section) => section.value)
              .join("\n"),
          )
        : restored;
    }
    default:
      return assertNever(record.format);
  }
}

function wrapped(id: string, format: string, content: string): string {
  const [begin, end] = markers(id, format);
  return `${begin}\n${content.trim()}\n${end}\n`;
}

export function unmanaged(
  content: string,
  record: Pick<MergeRecord, "blockId" | "format">,
): string {
  let base = content;
  for (const section of sections(content, record).reverse())
    base = base.slice(0, section.start) + base.slice(section.end);
  return base;
}

function firstTable(content: string): number {
  for (const match of content.matchAll(/^[ \t]*\[/gmu)) {
    try {
      parseToml(content.slice(0, match.index));
      return match.index;
    } catch (error) {
      // A bracket within a multiline value is not a table boundary.
      if (!(error instanceof Error)) throw error;
    }
  }
  return content.length;
}

function mergeBlock(before: string, action: Extract<Action, { kind: "mergeBlock" }>): string {
  if (!/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/u.test(action.blockId)) {
    throw new InstallError(
      "merge.id",
      "Block identifiers must contain only letters, digits, dots, underscores, and hyphens.",
    );
  }
  // Existing marker regions are replaced, not duplicated.
  let base = unmanaged(before, action);
  switch (action.format) {
    case "text":
      return (
        base +
        (base && !base.endsWith("\n") ? "\n" : "") +
        wrapped(action.blockId, action.format, action.content)
      );
    case "json": {
      const value = parseJson(action.content);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new InstallError("merge.object", "JSON block content must be an object.");
      }
      const members = JSON.stringify(value, null, 2).slice(1, -1).trim();
      const result = appendJsonBlock(base, wrapped(action.blockId, action.format, members));
      parseJson(result);
      return result;
    }
    case "toml": {
      base = atTomlTarget(action.target, () => tomlOwnership(base, action.content).content);
      const split = firstTable(action.content);
      const roots = action.content.slice(0, split).trim();
      const tables = action.content.slice(split).trim();
      const position = firstTable(base);
      const prefix = base.slice(0, position);
      const rootBlock = roots ? wrapped(`${action.blockId}.root`, action.format, roots) : "";
      const tableBlock = tables ? wrapped(`${action.blockId}.tables`, action.format, tables) : "";
      const result =
        prefix +
        (prefix && !prefix.endsWith("\n") ? "\n" : "") +
        rootBlock +
        base.slice(position) +
        (base.slice(position) && !base.endsWith("\n") ? "\n" : "") +
        tableBlock;
      atTomlTarget(action.target, () => parseToml(result));
      return result;
    }
    default:
      return assertNever(action.format);
  }
}

export function applyMerge(before: string, action: MergeAction): MergeRecord {
  switch (action.kind) {
    case "mergeBlock":
      return {
        blockId: action.blockId,
        format: action.format,
        jsonPath: "",
        added: [],
        before,
        after: mergeBlock(before, action),
      };
    case "jsonArrayMerge": {
      const existing = arrayAt(before, action.jsonPath);
      const added = action.values.filter(
        (value, index) =>
          !existing.some((other) => sameValue(value, other)) &&
          !action.values.slice(0, index).some((other) => sameValue(value, other)),
      );
      return {
        blockId: action.blockId,
        format: "array",
        jsonPath: action.jsonPath,
        added,
        before,
        after: added.length ? setArray(before, action.jsonPath, [...existing, ...added]) : before,
      };
    }
    default:
      return assertNever(action);
  }
}
