import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { adapter } from "../../../src/adapters/opencode/index.js";
import { syncRepo } from "../../../src/engine/index.js";
import { adapters } from "../../engine/helpers.js";
import { sampleContext } from "./helpers.js";

const goldenDir = fileURLToPath(new URL("../../golden/opencode/", import.meta.url));
let sample: Awaited<ReturnType<typeof sampleContext>>;
beforeEach(async () => {
  sample = await sampleContext();
});
afterEach(async () => {
  await sample.cleanup();
});

async function tree(directory: string, prefix = ""): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    if ((await stat(path)).isDirectory()) Object.assign(files, await tree(path, relative));
    else files[relative] = await readFile(path, "utf8");
  }
  return files;
}

it("matches committed output when the sample uses only the OpenCode adapter", async () => {
  // Given: the real sample repository, discovery, validation, and generation store.
  const options = { env: sample.env, adapters: adapters(adapter), harness: "opencode" as const };
  // When: the complete engine pipeline renders and activates the generation.
  const result = await syncRepo(sample.repo, options);
  expect(result.diagnostics).toEqual([]);
  if (!result.generation) throw new TypeError("The engine must produce a generation.");
  const output = await tree(join(result.generation.dir, "opencode"));
  const normalized = Object.fromEntries(
    Object.entries(output).map(([path, content]) => [
      path,
      content
        .replaceAll(sample.repo, "/home/alice/config")
        .replaceAll(join(sample.root, "home"), "/home/alice"),
    ]),
  );
  if (process.env["UPDATE_GOLDEN"] === "1") {
    await rm(goldenDir, { recursive: true, force: true });
    for (const [path, content] of Object.entries(normalized)) {
      await mkdir(dirname(join(goldenDir, path)), { recursive: true });
      await writeFile(join(goldenDir, path), content);
    }
  }
  // Then: shipped file paths and bytes match the committed golden inventory.
  expect(normalized).toEqual(await tree(goldenDir));
});
