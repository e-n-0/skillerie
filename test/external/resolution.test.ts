import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { validateRepo, runLifecycle } from "../../src/engine/index.js";
import { readManifest } from "../../src/install/storage.js";
import { assertNever, externalFixture, skill } from "./helpers.js";

let sample: Awaited<ReturnType<typeof externalFixture>>;
beforeEach(async () => {
  sample = await externalFixture();
});
afterEach(async () => {
  await sample.cleanup();
});

it.each(["tag", "annotated-tag", "branch", "sha"] as const)(
  "resolves a pinned %s when loading external skills",
  async (kind) => {
    // Given: a named or content-addressed revision with two skills and a support file.
    await sample.put(join(sample.remote, "skills/review/reference.txt"), "support bytes\n");
    const sha = await sample.commit();
    let ref: string;
    switch (kind) {
      case "tag":
        ref = "v1.2.0";
        await sample.remoteGit(["tag", ref]);
        break;
      case "annotated-tag":
        ref = "v1.2.0";
        await sample.remoteGit([
          "-c",
          "user.name=Synthetic",
          "-c",
          "user.email=synthetic@example.invalid",
          "-c",
          "tag.gpgsign=false",
          "tag",
          "-a",
          ref,
          "-m",
          "fixture tag",
        ]);
        break;
      case "branch":
        ref = "main";
        break;
      case "sha":
        ref = sha;
        break;
      default:
        assertNever(kind);
    }
    await sample.configure([{ url: sample.url, ref, path: "skills" }]);
    // When: the real engine resolves, fetches, and validates.
    const result = await validateRepo(sample.repo, { env: sample.env });
    // Then: the snapshot pins the commit and discovery retains support bytes and origin.
    expect(result.diagnostics).toEqual([]);
    expect(result.snapshot?.external).toEqual([{ url: sample.url, ref, sha, path: "skills" }]);
    const review = result.model?.skills.find((entry) => entry.name === "review");
    expect(review).toMatchObject({ source: "external", external: { sha, path: "skills/review" } });
    const support = review?.supportFiles.find((file) => file.relPath === "reference.txt");
    expect(support).toBeDefined();
    expect(await readFile(support?.sourcePath ?? "", "utf8")).toBe("support bytes\n");
    expect(Object.keys(result.snapshot?.sourceHashes ?? {})).not.toEqual(
      expect.arrayContaining([expect.stringContaining("/cache/")]),
    );
  },
);

it.each([undefined, "main"])(
  "refreshes the generation hash when floating ref %s moves without skill changes",
  async (ref) => {
    // Given: a validated commit and a later metadata-only upstream commit.
    await sample.configure([{ url: sample.url, path: "skills", ...(ref ? { ref } : {}) }]);
    const before = await validateRepo(sample.repo, { env: sample.env });
    const sha = await sample.commit();
    // When: the same configuration is validated again.
    const after = await validateRepo(sample.repo, { env: sample.env });
    // Then: revision identity alone changes the snapshot hash.
    expect(after.diagnostics).toEqual([]);
    expect(after.snapshot?.sourceHashes).toEqual(before.snapshot?.sourceHashes);
    expect(after.snapshot?.external?.[0]?.sha).toBe(sha);
    expect(after.snapshot?.hash).not.toBe(before.snapshot?.hash);
  },
);

it("keeps a full commit pinned when upstream advances", async () => {
  // Given: a full SHA pin followed by a different remote head.
  await sample.configure([{ url: sample.url, ref: sample.initial, path: "skills" }]);
  await sample.commit();
  // When: validation fetches the requested commit.
  const result = await validateRepo(sample.repo, { env: sample.env });
  // Then: remote movement does not replace the pin.
  expect(result.snapshot?.external?.[0]?.sha).toBe(sample.initial);
  expect(result.diagnostics).toEqual([]);
});

it("records the resolved commit when install publishes an external generation", async () => {
  // Given: an external repository selected for installation.
  const sha = sample.initial;
  // When: the engine installs through the real OpenCode adapter.
  const result = await runLifecycle(sample.repo, { command: "install", env: sample.env });
  // Then: both installed ownership and the active generation retain its revision.
  expect(result.valid).toBe(true);
  const manifest = await readManifest(join(sample.root, "home/opencode"));
  expect(manifest?.external?.[0]?.sha).toBe(sha);
  expect(
    JSON.parse(await readFile(join(sample.root, "cache/current/.skillerie-external.json"), "utf8")),
  ).toMatchObject([{ sha }]);
});

it("discovers a repository-root skill when its checkout directory is a commit SHA", async () => {
  // Given: a root skill whose metadata name differs from the repository name.
  await sample.put(join(sample.remote, "SKILL.md"), skill("root-skill"));
  await sample.commit();
  await sample.configure([{ url: sample.url }]);
  // When: discovery reads the content-addressed checkout.
  const result = await validateRepo(sample.repo, { env: sample.env });
  // Then: the canonical skill name comes from metadata rather than the cache path.
  expect(result.diagnostics).toEqual([]);
  expect(result.model?.skills.map((entry) => entry.name)).toEqual(["root-skill"]);
});
