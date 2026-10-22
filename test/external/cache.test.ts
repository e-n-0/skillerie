import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { validateRepo } from "../../src/engine/index.js";
import { parseExternalUrl } from "../../src/engine/external/url.js";
import { externalFixture } from "./helpers.js";

let sample: Awaited<ReturnType<typeof externalFixture>>;
beforeEach(async () => {
  sample = await externalFixture();
});
afterEach(async () => {
  await sample.cleanup();
});

it("uses cached content without git when a full SHA pin has no reachable remote", async () => {
  // Given: cached commit content and a removed remote.
  await sample.configure([{ url: sample.url, ref: sample.initial, path: "skills" }]);
  const cached = await validateRepo(sample.repo, { env: sample.env });
  await rm(sample.remote, { recursive: true });
  // When: validation runs with neither a remote nor a git executable.
  const result = await validateRepo(sample.repo, { env: { ...sample.env, PATH: "" } });
  // Then: full-SHA cache reuse does not require git or remote resolution.
  expect(result.diagnostics).toEqual([]);
  expect(result.snapshot?.hash).toBe(cached.snapshot?.hash);
});

it.each([undefined, "main", "v1.2.0"])(
  "falls back with a warning when ref %s becomes unreachable",
  async (ref) => {
    // Given: a cached entry followed by an unreachable remote.
    await sample.remoteGit(["tag", "v1.2.0"]);
    await sample.configure([{ url: sample.url, path: "skills", ...(ref ? { ref } : {}) }]);
    const cached = await validateRepo(sample.repo, { env: sample.env });
    await rm(sample.remote, { recursive: true });
    // When: remote resolution fails.
    const result = await validateRepo(sample.repo, { env: sample.env });
    // Then: the most recently used entry revision remains usable and visible as a fallback.
    expect(result.snapshot?.hash).toBe(cached.snapshot?.hash);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "warn",
        code: "external.fallback",
        jsonPath: "/skills/external/0",
      }),
    );
  },
);

it("reports a located error when the remote is unreachable without cached content", async () => {
  // Given: no previous resolution and a deleted remote.
  await rm(sample.remote, { recursive: true });
  // When: first validation attempts resolution.
  const result = await validateRepo(sample.repo, { env: sample.env });
  // Then: the URL is named and no snapshot is produced.
  expect(result.snapshot).toBeUndefined();
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      severity: "error",
      code: "external.resolve",
      message: expect.stringContaining(sample.url),
      jsonPath: "/skills/external/0/url",
    }),
  );
});

it("rejects a short SHA when it does not name a tag or branch", async () => {
  // Given: a short object ID instead of a supported ref.
  await sample.configure([{ url: sample.url, ref: sample.initial.slice(0, 8), path: "skills" }]);
  // When: git cannot resolve it as a named ref.
  const result = await validateRepo(sample.repo, { env: sample.env });
  // Then: the diagnostic explains how to supply a supported revision.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "external.resolve",
      jsonPath: "/skills/external/0/ref",
      message: expect.stringContaining("full 40-character SHA"),
    }),
  );
});

it("cleans staging directories when two validations publish the same commit concurrently", async () => {
  // Given: an empty content cache shared by two invocations.
  const options = { env: sample.env };
  // When: both resolve and fetch the same external entry.
  const results = await Promise.all([
    validateRepo(sample.repo, options),
    validateRepo(sample.repo, options),
  ]);
  // Then: both use a complete commit and no fetch staging directories remain.
  expect(results.map((result) => result.diagnostics)).toEqual([[], []]);
  expect(results[0]?.snapshot?.hash).toBe(results[1]?.snapshot?.hash);
  const directories = await readdir(
    join(sample.root, "cache/external", parseExternalUrl({ url: sample.url }).cacheKey),
    { recursive: true },
  );
  expect(directories.some((name) => String(name).startsWith(".fetch-"))).toBe(false);
});

it("retains fallback identity when YAML entry fields are reordered", async () => {
  // Given: a cached entry whose equivalent author configuration has a different key order.
  await sample.configure([{ url: sample.url, path: "skills", ref: "main" }]);
  await validateRepo(sample.repo, { env: sample.env });
  await sample.configure([{ ref: "main", path: "skills", url: sample.url }]);
  await rm(sample.remote, { recursive: true });
  // When: remote resolution falls back using the entry identity.
  const result = await validateRepo(sample.repo, { env: sample.env });
  // Then: serialization order cannot make a cached revision disappear.
  expect(result.snapshot?.external?.[0]?.sha).toBe(sample.initial);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ severity: "warn", code: "external.fallback" }),
  );
});
