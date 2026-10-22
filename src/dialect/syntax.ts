import type { Diagnostic, JsonValue } from "../core/types.js";
import type { DialectOptions, StructuredValue } from "./types.js";

/** Syntax-tree containers retain expressions until the adapter can interpret them. */
export type Value =
  | StructuredValue
  | { readonly kind: "array"; readonly items: readonly Value[]; readonly text: string }
  | {
      readonly kind: "object";
      readonly fields: Readonly<Record<string, Value>>;
      readonly text: string;
    };

export function diagnostic(
  options: DialectOptions,
  location: { readonly text: string; readonly offset: number },
  message: string,
): Diagnostic {
  return {
    severity: "error",
    code: "dialect.syntax",
    message,
    ...(options.file === undefined ? {} : { file: options.file }),
    line: location.text.slice(0, location.offset).split("\n").length,
  };
}

/** Length of a quoted token, including triple quotes and escaped delimiters. */
export function quoteEnd(text: string, start: number): number | undefined {
  const quote = text[start];
  if (quote !== '"' && quote !== "'") return undefined;
  const delimiter = text.startsWith(quote.repeat(3), start) ? quote.repeat(3) : quote;
  for (let i = start + delimiter.length; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text.startsWith(delimiter, i)) return i + delimiter.length;
  }
  return undefined;
}

/** A dash option's description is prose, so quotes and parentheses are not syntax. */
function describedOption(
  text: string,
  start: number,
):
  | { readonly labelEnd: number; readonly descriptionStart: number; readonly end: number }
  | undefined {
  const labelEnd = quoteEnd(text, start);
  if (labelEnd === undefined) return undefined;
  const separator = /^[ \t]*(?:--|\u2014)[ \t]*/.exec(text.slice(labelEnd));
  if (separator === null) return undefined;
  const descriptionStart = labelEnd + separator[0].length;
  const boundary = /,(?=\s*(?:["'{(]|\]))|\r?\n(?=[ \t]*(?:["'{(]|\]))|\]/.exec(
    text.slice(descriptionStart),
  );
  return {
    labelEnd,
    descriptionStart,
    end: boundary === null ? text.length : descriptionStart + boundary.index,
  };
}

/** Balanced delimiters, with quoted contents treated as opaque text. */
export function balancedEnd(text: string, start: number): number | undefined {
  const stack: string[] = [];
  const closers: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };
  for (let i = start; i < text.length; i++) {
    const char = text[i] ?? "";
    if (char === '"' || char === "'") {
      const end = describedOption(text, i)?.end ?? quoteEnd(text, i);
      if (end === undefined) return undefined;
      i = end - 1;
    } else if (closers[char] !== undefined) {
      stack.push(closers[char]);
    } else if (char === ")" || char === "]" || char === "}") {
      if (stack.pop() !== char) return undefined;
      if (stack.length === 0) return i + 1;
    }
  }
  return undefined;
}

export function splitFields(text: string, separator = ","): readonly string[] | undefined {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' || char === "'") {
      const option = separator === "," ? describedOption(text, i) : undefined;
      const end = option?.end ?? quoteEnd(text, i);
      if (end === undefined) return undefined;
      if (option !== undefined && /[\r\n]/.test(text[end] ?? "")) {
        parts.push(text.slice(start, end).trim());
        start = end;
      }
      i = end - 1;
    } else if (char === "(" || char === "[" || char === "{") {
      const end = balancedEnd(text, i);
      if (end === undefined) return undefined;
      i = end - 1;
    } else if (char === ")" || char === "]" || char === "}") {
      return undefined;
    } else if (char === separator) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

function decodeString(text: string): string {
  const size = text.startsWith((text[0] ?? "").repeat(3)) ? 3 : 1;
  return text
    .slice(size, -size)
    .replace(/\\(u[0-9a-fA-F]{4}|[\s\S])/g, (escape: string, key: string) => {
      const escapes: Readonly<Record<string, string>> = {
        n: "\n",
        r: "\r",
        t: "\t",
        b: "\b",
        f: "\f",
        "\\": "\\",
        '"': '"',
        "'": "'",
        "/": "/",
      };
      return key.startsWith("u") && key.length === 5
        ? String.fromCharCode(Number.parseInt(key.slice(1), 16))
        : (escapes[key] ?? escape);
    });
}

export function parseFields(text: string): Readonly<Record<string, Value>> | undefined {
  const source = text.trim();
  const body =
    source.startsWith("{") && balancedEnd(source, 0) === source.length
      ? source.slice(1, -1)
      : source;
  const fields = splitFields(body);
  if (fields === undefined) return undefined;
  const result: Record<string, Value> = {};
  for (const field of fields) {
    const match =
      /^(?:([A-Za-z_]\w*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))\s*[:=]\s*([\s\S]+)$/.exec(field);
    if (match === null) return undefined;
    const name = match[1] ?? decodeString(match[2] ?? "");
    const value = parseValue(match[3] ?? "");
    if (Object.hasOwn(result, name) || value === undefined) return undefined;
    Object.defineProperty(result, name, { value, enumerable: true });
  }
  return result;
}

export function parseValue(source: string): Value | undefined {
  const text = source.trim();
  if (text === "") return undefined;
  if (text[0] === '"' || text[0] === "'") {
    const option = describedOption(text, 0);
    if (option !== undefined && option.end === text.length) {
      const description = text.slice(option.descriptionStart).trim();
      if (description === "") return undefined;
      return {
        kind: "array",
        items: [
          { kind: "literal", value: decodeString(text.slice(0, option.labelEnd)) },
          { kind: "literal", value: description },
        ],
        text,
      };
    }
    const pieces = splitFields(text, "+");
    if (pieces?.every((piece) => quoteEnd(piece, 0) === piece.length)) {
      return { kind: "literal", value: pieces.map(decodeString).join("") };
    }
    const end = quoteEnd(text, 0);
    if (end === undefined || !text.slice(end).trimStart().startsWith("+")) return undefined;
  }
  if (text === "true" || text === "false" || text === "null") {
    return { kind: "literal", value: text === "null" ? null : text === "true" };
  }
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) {
    const value = Number(text);
    return Number.isFinite(value) ? { kind: "literal", value } : undefined;
  }
  if (text.startsWith("{") && balancedEnd(text, 0) === text.length) {
    const fields = parseFields(text);
    return fields === undefined ? undefined : { kind: "object", fields, text };
  }
  if ((text.startsWith("[") || text.startsWith("(")) && balancedEnd(text, 0) === text.length) {
    const parts = splitFields(text.slice(1, -1));
    if (parts === undefined) return undefined;
    const items: Value[] = [];
    for (const part of parts) {
      const value = parseValue(part);
      if (value === undefined) return undefined;
      items.push(value);
    }
    return { kind: "array", items, text };
  }
  return { kind: "expression", text };
}

export function literalValue(value: Value): StructuredValue {
  switch (value.kind) {
    case "literal":
    case "expression":
      return value;
    case "array": {
      const values = value.items.map(literalValue);
      if (values.some((item) => item.kind === "expression"))
        return { kind: "expression", text: value.text };
      return {
        kind: "literal",
        value: values.flatMap((item) => (item.kind === "literal" ? [item.value] : [])),
      };
    }
    case "object": {
      const result: Record<string, JsonValue> = {};
      for (const [key, node] of Object.entries(value.fields)) {
        const item = literalValue(node);
        if (item.kind === "expression") return { kind: "expression", text: value.text };
        Object.defineProperty(result, key, { value: item.value, enumerable: true });
      }
      return { kind: "literal", value: result };
    }
    default:
      return assertNever(value);
  }
}

export function assertNever(value: never): never {
  throw new TypeError(`Unexpected variant: ${String(value)}`);
}
