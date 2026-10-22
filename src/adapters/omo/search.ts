import type { Diagnostic } from "../../core/types.js";
import type { DialectOptions, DialectResult } from "../../dialect/index.js";
import { protectedReference } from "../../dialect/calls.js";
import { codeLiteral, fencedBlocks, interactionExamples } from "../../dialect/markdown.js";
import {
  balancedEnd,
  diagnostic,
  parseFields,
  parseValue,
  splitFields,
} from "../../dialect/syntax.js";
import type { Value } from "../../dialect/syntax.js";

function searchFields(body: string): Readonly<Record<string, Value>> | undefined {
  const named = parseFields(body);
  if (named !== undefined) return named;
  const parts = splitFields(body);
  const first = parts?.[0];
  if (parts === undefined || first === undefined) return undefined;
  const pattern = parseValue(first);
  const rest = parseFields(parts.slice(1).join(","));
  if (pattern === undefined || rest === undefined || Object.hasOwn(rest, "pattern"))
    return undefined;
  return { pattern, ...rest };
}

function stringValue(value: Value | undefined): string | undefined {
  return value?.kind === "literal" && typeof value.value === "string" ? value.value : undefined;
}

function quote(value: string): string {
  if (/\$(?:[A-Za-z_]\w*|\{[A-Za-z_]\w*\})/.test(value)) {
    return `"${value.replace(/["\\`]|\$(?![A-Za-z_]\w*|\{[A-Za-z_]\w*\})/g, "\\$&")}"`;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function searchCommand(name: string, fields: Readonly<Record<string, Value>>): string | undefined {
  const pattern = stringValue(fields["pattern"]);
  const path = fields["path"] === undefined ? "." : stringValue(fields["path"]);
  if (pattern === undefined || path === undefined || path.startsWith("~")) return undefined;
  // Prefix option-like relative paths so neither utility treats them as flags.
  const directory = path.startsWith("-") ? `./${path}` : path;
  const root = directory === "." ? "." : quote(directory);
  if (name === "Glob") {
    if (Object.keys(fields).some((key) => key !== "pattern" && key !== "path")) return undefined;
    if (!pattern.includes("/")) return `find ${root} -name ${quote(pattern)}`;
    // find's path wildcard crosses separators; each **/ also admits zero directories.
    let patterns = [""];
    for (const [index, part] of pattern.split("**/").entries()) {
      patterns = patterns.flatMap((prefix) =>
        index === 0 ? [part] : [`${prefix}${part}`, `${prefix}*/${part}`],
      );
    }
    const prefix = directory.replace(/\/$/, "").replace(/[\\*?[]/g, "\\$&");
    const paths = [...new Set(patterns)].map(
      (glob) => `-path ${quote(`${prefix}/${glob.replaceAll("**", "*")}`)}`,
    );
    const predicate = paths.length === 1 ? paths.join("") : `\\( ${paths.join(" -o ")} \\)`;
    return `find ${root} ${predicate}`;
  }
  const allowed = ["pattern", "path", "glob", "output_mode", "-i", "-n"];
  if (Object.keys(fields).some((key) => !allowed.includes(key))) return undefined;
  const outputMode = fields["output_mode"];
  if (outputMode !== undefined && stringValue(outputMode) === undefined) return undefined;
  const mode = stringValue(outputMode) ?? "content";
  if (!["content", "files_with_matches", "count"].includes(mode)) return undefined;
  const insensitive = fields["-i"];
  const numbered = fields["-n"];
  if (
    [insensitive, numbered].some(
      (value) =>
        value !== undefined && (value.kind !== "literal" || typeof value.value !== "boolean"),
    )
  )
    return undefined;
  const flag =
    mode === "content"
      ? numbered?.kind === "literal" && numbered.value === false
        ? ""
        : "n"
      : mode === "count"
        ? "c"
        : "l";
  const ignoreCase = insensitive?.kind === "literal" && insensitive.value === true ? "i" : "";
  const glob = fields["glob"];
  const filter = stringValue(glob);
  if (glob !== undefined && (filter === undefined || filter.includes("/"))) return undefined;
  const include = filter === undefined ? "" : ` --include=${quote(filter)}`;
  return `grep -r${flag}${ignoreCase}E${include} -- ${quote(pattern)} ${root}`;
}

function searchInstruction(
  name: string,
  fields: Readonly<Record<string, Value>>,
  native: string,
): string {
  const command = searchCommand(name, fields);
  if (command !== undefined) {
    const key = native === "exec_command" ? "cmd" : "command";
    return `${native}(${JSON.stringify({ [key]: command })})`;
  }
  const settings = Object.entries(fields).map(([key, value]) => {
    const text = value.kind === "literal" ? JSON.stringify(value.value) : value.text;
    return `${key}=${text}`;
  });
  return `Use \`${native}\` to run \`${name === "Glob" ? "find" : "grep"}\` with these search settings, resolving runtime values first: ${settings.join("; ")}.`;
}

/** Shell adapters share search semantics without changing the source dialect. */
export function rewriteSearchCalls(
  text: string,
  options: DialectOptions,
  rewriteText: (text: string) => DialectResult,
): DialectResult {
  const diagnostics: Diagnostic[] = [];
  const rewrite = (source: string): string => {
    const result = rewriteText(source);
    diagnostics.push(...result.diagnostics);
    return result.text;
  };
  const examples = interactionExamples(text);
  const fences = fencedBlocks(text);
  const pattern = /\b(Grep|Glob)\s*\(/g;
  let output = "";
  let cursor = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const name = match[1] ?? "";
    const native = options.capabilities.toolMap[name];
    if (native !== "bash" && native !== "exec_command") continue;
    if (protectedReference(text, match.index, match.index + name.length)) continue;
    if (examples.some((span) => span.start <= match.index && match.index < span.end)) continue;
    const fence = fences.find((span) => span.start <= match.index && match.index < span.end);
    if (
      fence !== undefined &&
      (!["", "text", "plaintext"].includes(fence.language) || codeLiteral(text, fence, match.index))
    )
      continue;
    const start = pattern.lastIndex - 1;
    const end = balancedEnd(text, start);
    if (
      fence !== undefined &&
      (text.slice(text.lastIndexOf("\n", match.index - 1) + 1, match.index).trim() !== "" ||
        (end !== undefined && !/^[ \t]*;?[ \t]*(?:\r?\n|$)/.test(text.slice(end))))
    )
      continue;
    const fields = end === undefined ? undefined : searchFields(text.slice(start + 1, end - 1));
    if (fields === undefined || end === undefined || fields["pattern"] === undefined) {
      diagnostics.push(
        diagnostic(options, { text, offset: match.index }, `Invalid ${name} search arguments.`),
      );
      continue;
    }
    const opening =
      fence === undefined ? /(`+)[ \t]*$/.exec(text.slice(cursor, match.index)) : null;
    const closing = /^[ \t]*(`+)/.exec(text.slice(end));
    const inline = opening !== null && opening[1] === closing?.[1];
    const spanStart = inline ? match.index - opening[0].length : match.index;
    const spanEnd = inline ? end + (closing?.[0].length ?? 0) : end;
    const command = inline ? searchCommand(name, fields) : undefined;
    const ticks = "`".repeat(
      Math.max(1, ...[...(command ?? "").matchAll(/`+/g)].map((run) => run[0].length + 1)),
    );
    const replacement =
      command === undefined
        ? searchInstruction(name, fields, native)
        : `${ticks}${command}${ticks}`;
    output += rewrite(text.slice(cursor, spanStart)) + replacement;
    cursor = spanEnd;
    pattern.lastIndex = spanEnd;
  }
  return { text: output + rewrite(text.slice(cursor)), diagnostics };
}
