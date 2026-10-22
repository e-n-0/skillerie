import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { loadConfig } from "../../src/config/index.js";
import { externalFixture } from "./helpers.js";

let sample: Awaited<ReturnType<typeof externalFixture>>;
beforeEach(async () => {
  sample = await externalFixture();
});
afterEach(async () => {
  await sample.cleanup();
});

it.each([
  ["skills:\n  external: [{}]\n", "/skills/external/0/url"],
  ["skills:\n  external: [{ url: 'file:///repo', extra: true }]\n", "/skills/external/0/extra"],
  [
    "skills:\n  external: [{ url: 'file:///repo', include: [42] }]\n",
    "/skills/external/0/include/0",
  ],
  ["agents:\n  external: [{ url: 'file:///repo' }]\n", "/agents/external"],
  ["rules:\n  external: [{ url: 'file:///repo' }]\n", "/rules/external"],
])("rejects invalid external configuration %s", async (yaml, jsonPath) => {
  // Given: schema-invalid input.
  await sample.put(join(sample.repo, "skillerie.yaml"), `version: 1\n${yaml}`);
  // When: configuration crosses the schema boundary.
  const result = await loadConfig(sample.repo, sample.env);
  // Then: unknown fields and malformed values have precise JSON pointers.
  expect(result.config).toBeUndefined();
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ severity: "error", jsonPath }),
  );
});
