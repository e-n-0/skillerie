import { join } from "node:path";
import type { ResolvedContext } from "../../../src/core/types.js";
import { adapter } from "../../../src/adapters/opencode/index.js";
import { validateRepo } from "../../../src/engine/index.js";
import { adapters, sampleRepo } from "../../engine/helpers.js";

export async function sampleContext() {
  const sample = await sampleRepo();
  try {
    const result = await validateRepo(sample.repo, {
      env: sample.env,
      adapters: adapters(adapter),
    });
    if (!result.model || !result.snapshot) throw new TypeError(JSON.stringify(result.diagnostics));
    const home = join(sample.root, "home", ".config", "opencode");
    const ctx: ResolvedContext = {
      model: result.model,
      snapshot: result.snapshot,
      harness: "opencode",
      paths: adapter.defaultPaths({ HOME: join(sample.root, "home") }),
      harnessVersion: { supportedRange: adapter.supportedRange },
      env: { ...sample.env, HOME: join(sample.root, "home") },
    };
    return { ...sample, ctx: { ...ctx, paths: { ...ctx.paths, home } } };
  } catch (error) {
    await sample.cleanup();
    throw error;
  }
}

export function withTemplate(ctx: ResolvedContext, content: string): ResolvedContext {
  return {
    ...ctx,
    model: {
      ...ctx.model,
      templates: {
        ...ctx.model.templates,
        opencode: {
          harness: "opencode",
          files: [
            {
              file: join(ctx.model.repoDir, "harnesses/opencode/templates/opencode.jsonc"),
              relPath: "opencode.jsonc",
              format: "jsonc",
              content,
            },
          ],
        },
      },
    },
  };
}
