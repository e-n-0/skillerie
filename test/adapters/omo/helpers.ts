import { join } from "node:path";
import type { JsonObject, ResolvedContext, RenderResult } from "../../../src/core/types.js";
import { adapter } from "../../../src/adapters/omo/index.js";
import { validateRepo } from "../../../src/engine/index.js";
import { sampleRepo } from "../../engine/helpers.js";

export async function setup() {
  const sample = await sampleRepo();
  const validated = await validateRepo(sample.repo, {
    env: sample.env,
    adapters: new Map([["omo", async () => ({ adapter })]]),
  });
  if (validated.model === undefined || validated.snapshot === undefined) {
    await sample.cleanup();
    throw new TypeError(JSON.stringify(validated.diagnostics));
  }
  const ctx: ResolvedContext = {
    snapshot: validated.snapshot,
    model: validated.model,
    harness: "omo",
    paths: adapter.defaultPaths(sample.env),
    harnessVersion: { supportedRange: adapter.supportedRange },
    env: sample.env,
  };
  return { ...sample, ctx };
}

export function rendered(result: RenderResult, path: string): string {
  const entry = result.files.find((file) => file.relPath === path);
  if (entry === undefined) throw new TypeError(`Missing rendered entry ${path}.`);
  return entry.content.toString();
}

export function withTemplates(ctx: ResolvedContext, values: Readonly<Record<string, JsonObject>>) {
  return {
    ...ctx,
    model: {
      ...ctx.model,
      templates: {
        ...ctx.model.templates,
        omo: {
          harness: "omo" as const,
          files: Object.entries(values).map(([relPath, content]) => ({
            file: join(ctx.model.repoDir, "harnesses/omo/templates", relPath),
            relPath,
            format: relPath.endsWith(".jsonc") ? ("jsonc" as const) : ("json" as const),
            content: JSON.stringify(content),
          })),
        },
      },
    },
  };
}

export function payload(call: string): unknown {
  return JSON.parse(call.slice(call.indexOf("(") + 1, -1));
}
