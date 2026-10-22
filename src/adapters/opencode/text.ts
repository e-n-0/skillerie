import { parseDocument } from "yaml";
import {
  convertInteractionBlocks,
  rewriteArguments,
  rewriteMcpRefs,
  rewritePluginRoot,
  rewriteTools,
  type DialectOptions,
  type DialectResult,
} from "../../dialect/index.js";
import { isJsonObject } from "../../model/json.js";
import { convertCalls } from "./calls.js";
import { capabilities } from "./capabilities.js";
import { renderQuestions } from "./questions.js";

interface TextSource {
  readonly file: string;
  readonly skillDir?: string;
  readonly childAgent?: boolean;
}

/** Compose shared parsing/rewrites; only native call schemas live in this adapter. */
export function convertText(text: string, source: TextSource): DialectResult {
  const options: DialectOptions = {
    harness: "opencode",
    capabilities,
    file: source.file,
    ...(source.childAgent === undefined ? {} : { childAgent: source.childAgent }),
    arguments: { mode: "keep" },
    renderQuestions,
  };
  // Older authored snippets use a fenced flat YAML question instead of a call.
  const fenced = text.replace(
    /^```(?:ya?ml)?[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm,
    (original: string, body: string) => {
      if (!/^\s*header:/m.test(body) || !/^\s*question:/m.test(body)) return original;
      const document = parseDocument(body, { version: "1.2", uniqueKeys: true });
      if (document.errors.length) return original;
      const value: unknown = document.toJS({ maxAliasCount: 100 });
      return isJsonObject(value) ? `AskUserQuestion(${JSON.stringify(value)})` : original;
    },
  );
  let result = convertInteractionBlocks(fenced, options);
  const apply = (next: DialectResult): void => {
    result = { text: next.text, diagnostics: [...result.diagnostics, ...next.diagnostics] };
  };
  apply(convertCalls(result.text, options));
  if (source.skillDir !== undefined)
    apply(rewritePluginRoot(result.text, { ...options, skillDir: source.skillDir }));
  apply(rewriteTools(result.text, options));
  apply(rewriteMcpRefs(result.text, options));
  apply(rewriteArguments(result.text, options));
  return result;
}
