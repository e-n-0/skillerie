import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { afterEach, beforeEach, expect, it } from "vitest";
import { adapter as codex } from "../../src/adapters/codex/index.js";
import { adapter as opencode } from "../../src/adapters/opencode/index.js";
import { syncRepo } from "../../src/engine/index.js";
import { adapters, sampleRepo } from "./helpers.js";

let sample: Awaited<ReturnType<typeof sampleRepo>>;
beforeEach(async () => {
  sample = await sampleRepo();
});
afterEach(async () => {
  await sample.cleanup();
});

it("renders directory assets and templates when harness sources use a custom path", async () => {
  // Given: relocated harness sources with a nested Codex asset and OpenCode template.
  await mkdir(join(sample.repo, "custom"));
  await rename(join(sample.repo, "harnesses"), join(sample.repo, "custom/dir"));
  const assetDir = join(sample.repo, "custom/dir/codex/assets/policy/nested");
  await mkdir(assetDir, { recursive: true });
  const policy = 'prefix_rule(pattern = ["git", "status"], decision = "allow")\n';
  await writeFile(join(assetDir, "safe.rules"), policy);
  await writeFile(
    join(sample.repo, "custom/dir/opencode/templates/opencode.jsonc"),
    '{"instructions":["custom-source.md"]}\n',
  );
  const configFile = join(sample.repo, "skillerie.yaml");
  await writeFile(
    configFile,
    (await readFile(configFile, "utf8")) + "\nsources:\n  harnesses: custom/dir\n",
  );

  // When: the real engine discovers and renders the configured sources.
  const result = await syncRepo(sample.repo, {
    env: sample.env,
    adapters: adapters(codex, opencode),
  });

  // Then: nested assets and template settings survive through generation.
  expect(result.diagnostics).toEqual([]);
  if (!result.generation) throw new TypeError("No generation produced.");
  expect(
    await readFile(join(result.generation.dir, "codex/rules/policy/nested/safe.rules"), "utf8"),
  ).toBe(policy);
  expect(
    parse(await readFile(join(result.generation.dir, "opencode/opencode.jsonc"), "utf8")),
  ).toMatchObject({ instructions: expect.arrayContaining(["custom-source.md"]) });
});
