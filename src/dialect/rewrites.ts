import { posix } from "node:path";
import type { Diagnostic } from "../core/types.js";
import type { DialectOptions, DialectResult, PluginRootOptions } from "./types.js";
import { parseStructuredCalls, protectedReference, resolveAgentAlias } from "./calls.js";
import { balancedEnd, diagnostic, literalValue, parseFields } from "./syntax.js";
import { codeLiteral, fencedBlocks, interactionExamples } from "./markdown.js";

/** Names only change in explicit code references or call position, never prose. */
export function rewriteTools(text: string, options: DialectOptions): DialectResult {
  const map = options.capabilities.toolMap;
  const examples = interactionExamples(text);
  const fences = fencedBlocks(text);
  const structured = parseStructuredCalls(text, options).calls;
  const result = text.replace(
    /(`+)((?:[A-Za-z][\w-]*:)*[A-Za-z][\w-]*)\1|\b([A-Za-z][\w-]*)(?=\s*\()/g,
    (
      source: string,
      ticks: string | undefined,
      codeName: string | undefined,
      callName: string | undefined,
      offset: number,
    ) => {
      if (examples.some((span) => span.start <= offset && offset < span.end)) return source;
      const name = codeName ?? callName ?? "";
      if (protectedReference(text, offset, offset + source.length)) return source;
      const fence = fences.find((span) => span.start <= offset && offset < span.end);
      if (fence !== undefined) {
        if (codeName !== undefined || codeLiteral(text, fence, offset)) return source;
        if (!structured.some((call) => call.start === offset)) {
          if (
            !["", "text", "plaintext"].includes(fence.language) ||
            !Object.hasOwn(map, name) ||
            /^(Task|Agent|Skill|AskUserQuestion)$/.test(name) ||
            /^\s*(?:export\s+)?(?:interface|type|class|func|function|const|let|var|import|package)\b/m.test(
              text.slice(fence.start, fence.end),
            )
          )
            return source;
          const before = text.slice(text.lastIndexOf("\n", offset - 1) + 1, offset);
          const start =
            offset +
            source.length +
            (text.slice(offset + source.length).match(/^\s*/)?.[0].length ?? 0);
          const end = balancedEnd(text, start);
          if (
            before.trim() !== "" ||
            end === undefined ||
            end > fence.end ||
            !/^[ \t]*;?[ \t]*(?:\r?\n|$)/.test(text.slice(end))
          )
            return source;
        }
      }
      if (
        callName !== undefined &&
        /^(Task|Agent|Skill|AskUserQuestion)$/.test(name) &&
        /^\s+\(/.test(text.slice(offset + source.length)) &&
        !/^\s*\(\s*(?:\{|[A-Za-z_]\w*\s*[:=])/.test(text.slice(offset + source.length))
      )
        return source;
      const mapped = Object.hasOwn(map, name) ? map[name] : undefined;
      const alias =
        codeName !== undefined && (!name.includes(":") || /^(productivity|git|codex):/.test(name))
          ? resolveAgentAlias(name, options)
          : name;
      const replacement = mapped ?? alias;
      return ticks === undefined ? replacement : `${ticks}${replacement}${ticks}`;
    },
  );
  return { text: result, diagnostics: [] };
}

/** A template may consume an entire MCP call; without one only its name changes. */
export function rewriteMcpRefs(text: string, options: DialectOptions): DialectResult {
  const pattern = /\bmcp__([A-Za-z0-9][\w-]*?)__([A-Za-z0-9][\w-]*)/g;
  const diagnostics: Diagnostic[] = [];
  const examples = interactionExamples(text);
  let cursor = 0;
  let output = "";
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    if (examples.some((span) => span.start <= match.index && match.index < span.end)) continue;
    const server = match[1];
    const tool = match[2];
    if (
      server === undefined ||
      tool === undefined ||
      protectedReference(text, match.index, pattern.lastIndex)
    )
      continue;
    let end = pattern.lastIndex;
    let replacement: string;
    if (options.mcpTemplate === undefined) {
      replacement = `${server}_${tool}`;
    } else {
      const space = /^\s*/.exec(text.slice(end))?.[0].length ?? 0;
      const callStart = end + space;
      if (text[callStart] === "(") {
        const callEnd = balancedEnd(text, callStart);
        const fields =
          callEnd === undefined ? undefined : parseFields(text.slice(callStart + 1, callEnd - 1));
        if (fields === undefined || callEnd === undefined) {
          diagnostics.push(
            diagnostic(options, { text, offset: match.index }, "Invalid MCP call arguments."),
          );
          continue;
        }
        replacement = options.mcpTemplate({
          server,
          tool,
          arguments: Object.fromEntries(
            Object.entries(fields).map(([key, value]) => [key, literalValue(value)]),
          ),
        });
        end = callEnd;
      } else {
        replacement = options.mcpTemplate({ server, tool });
      }
    }
    output += text.slice(cursor, match.index) + replacement;
    cursor = end;
    pattern.lastIndex = end;
  }
  return { text: output + text.slice(cursor), diagnostics };
}

/** Only block fences count; inline backticks do not toggle the argument policy. */
export function rewriteArguments(text: string, options: DialectOptions): DialectResult {
  const policy = options.arguments ?? { mode: "keep" };
  if (policy.mode === "keep") return { text, diagnostics: [] };
  let fenceLength: number | undefined;
  const output = text
    .split(/(?<=\n)/)
    .map((line) => {
      const fence = /^ {0,3}(`{3,})(.*?)(?:\r?\n)?$/.exec(line);
      const ticks = fence?.[1];
      if (ticks !== undefined) {
        if (fenceLength === undefined) fenceLength = ticks.length;
        else if (ticks.length >= fenceLength && (fence?.[2] ?? "").trim() === "")
          fenceLength = undefined;
        return line;
      }
      return fenceLength === undefined ? line.replace(/\$ARGUMENTS\b/g, () => policy.text) : line;
    })
    .join("");
  return { text: output, diagnostics: [] };
}

/** Resolve logical skill paths independently of the discovered source layout. */
export function rewritePluginRoot(text: string, options: PluginRootOptions): DialectResult {
  const skillDir = options.skillDir.replace(/^\.\//, "").replace(/\/+$/, "");
  const parts = skillDir.split("/");
  const skillsIndex = parts.lastIndexOf("skills");
  const authoredDir =
    skillsIndex < 0 ? `skills/${parts.at(-1) ?? ""}` : parts.slice(skillsIndex).join("/");
  const prefixes = [skillDir, authoredDir, `skills/${parts.at(-1) ?? ""}`];
  return {
    text: text.replace(
      /(?:\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT\b)(?:\/([^\s`"'<>)]*))?/g,
      (_source: string, path: string | undefined) => {
        const target = path ?? "";
        const current = prefixes.find(
          (prefix) => prefix !== "" && (target === prefix || target.startsWith(`${prefix}/`)),
        );
        if (current !== undefined) return `./${target.slice(current.length).replace(/^\//, "")}`;
        if (skillDir !== "" && target.startsWith("skills/")) {
          const relative = posix.relative(authoredDir, target);
          return relative.startsWith(".") ? relative : `./${relative}`;
        }
        return `./${target}`;
      },
    ),
    diagnostics: [],
  };
}
