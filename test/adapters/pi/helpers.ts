import type { HarnessSources, JsonObject, ResolvedContext } from "../../../src/core/types.js";
import { adapter } from "../../../src/adapters/pi/index.js";
import { validateRepo } from "../../../src/engine/index.js";
import { literalValue, parseFields } from "../../../src/dialect/syntax.js";
import { adapters, sampleRepo } from "../../engine/helpers.js";

export async function fixture() {
  const sample = await sampleRepo();
  const result = await validateRepo(sample.repo, {
    env: sample.env,
    adapters: adapters(adapter),
  });
  if (!result.model || !result.snapshot) {
    await sample.cleanup();
    throw new TypeError(JSON.stringify(result.diagnostics));
  }
  const context: ResolvedContext = {
    model: result.model,
    snapshot: result.snapshot,
    harness: "pi",
    paths: adapter.defaultPaths(sample.env),
    env: sample.env,
    harnessVersion: { supportedRange: adapter.supportedRange },
  };
  return { ...sample, context };
}

export function withSources(
  context: ResolvedContext,
  sources: Partial<HarnessSources>,
): ResolvedContext {
  const current = context.model.harnesses.pi;
  if (!current) throw new TypeError("Expected Pi sources.");
  return {
    ...context,
    model: {
      ...context.model,
      harnesses: { ...context.model.harnesses, pi: { ...current, ...sources } },
    },
  };
}

export function nativeCall(text: string, name: string): JsonObject {
  const prefix = `${name}(`;
  if (!text.startsWith(prefix) || !text.endsWith(")"))
    throw new TypeError(`Expected a ${name} invocation.`);
  const fields = parseFields(text.slice(prefix.length, -1));
  if (!fields) throw new TypeError("Expected an object payload.");
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => {
      const literal = literalValue(value);
      switch (literal.kind) {
        case "literal":
          return [key, literal.value];
        case "expression":
          throw new TypeError("Expected a literal tool argument.");
        default:
          throw new TypeError(`Unexpected value: ${String(literal satisfies never)}`);
      }
    }),
  );
}
