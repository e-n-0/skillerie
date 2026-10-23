import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { externalFixture, skill } from "./helpers.js";

let sample: Awaited<ReturnType<typeof externalFixture>>;
beforeEach(async () => {
  sample = await externalFixture();
});
afterEach(async () => {
  await sample.cleanup();
});

async function changeReview(): Promise<string> {
  await sample.put(join(sample.remote, "skills/review/SKILL.md"), skill("review", "Updated.\n"));
  return sample.commit();
}

const config = () => join(sample.repo, "skillerie.yaml");

/** A hand-written config whose comments and flow lists must survive the edit. */
async function writeConfig(entries: string): Promise<void> {
  await sample.put(
    config(),
    `version: 1
harnesses:
  opencode:
    path: ${join(sample.root, "home", "opencode")}
paths:
  cache: ${join(sample.root, "cache")}
skills:
  # Pinned upstream skills.
  external:
${entries}
`,
  );
}

it("bumps a SHA pin to the default branch head when a selected skill changed", async () => {
  // Given: a SHA-pinned entry with a comment, and an upstream edit to a selected skill.
  await writeConfig(`    - url: ${sample.url}
      ref: ${sample.initial} # keep this comment
      path: skills
      include: [review, release]`);
  const before = await readFile(config(), "utf8");
  const head = await changeReview();
  // When: update rewrites the pins.
  const result = await sample.command(["update"]);
  // Then: only the ref changes, and the next step is printed.
  expect(result.code, result.stderr).toBe(0);
  expect(await readFile(config(), "utf8")).toBe(before.replace(sample.initial, head));
  expect(result.stdout).toContain(
    `UPDATED ${sample.url} ${sample.initial.slice(0, 12)} -> ${head.slice(0, 12)}; changed: review (SKILL.md)`,
  );
  expect(result.stdout).toContain("run skillerie install");
});

it("leaves a pin alone when upstream moved without touching its selected skills", async () => {
  // Given: a pin selecting only release, and an upstream edit to review.
  await writeConfig(`    - url: ${sample.url}
      ref: ${sample.initial}
      path: skills
      include: [release]`);
  const before = await readFile(config(), "utf8");
  await changeReview();
  // When: update runs.
  const result = await sample.command(["update", "--json"]);
  // Then: nothing is rewritten.
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ updated: [], followed: [], exitCode: 0 });
  expect(await readFile(config(), "utf8")).toBe(before);
});

it("only bumps entries containing the named skills when skills are given", async () => {
  // Given: two pinned entries, each selecting one skill, and upstream edits to both skills.
  await writeConfig(`    - url: ${sample.url}
      ref: ${sample.initial}
      path: skills/review
    - url: ${sample.url}
      ref: ${sample.initial}
      path: skills/release`);
  await sample.put(join(sample.remote, "skills/release/SKILL.md"), skill("release", "Updated.\n"));
  const head = await changeReview();
  // When: update is limited to the release skill.
  const result = await sample.command(["update", "release", "--json"]);
  // Then: only the release entry's ref moves.
  expect(result.code, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ updated: [{ index: 1, to: head }] });
  const text = await readFile(config(), "utf8");
  expect(text.indexOf(sample.initial)).toBeLessThan(text.indexOf(head));
  expect(text.split(sample.initial)).toHaveLength(2);
});

it("bumps a tag pin to the newest semantic version tag", async () => {
  // Given: a tag pin and a newer tag carrying a skill change.
  await sample.remoteGit(["tag", "v1.0.0"]);
  await writeConfig(`    - url: ${sample.url}
      ref: "v1.0.0"
      path: skills`);
  await sample.command(["install"]);
  await changeReview();
  await sample.remoteGit(["tag", "v1.1.0"]);
  // When: update rewrites the pin.
  const result = await sample.command(["update", "--json"]);
  // Then: the quoted ref keeps its quotes and names the new tag.
  expect(result.code, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ updated: [{ from: "v1.0.0", to: "v1.1.0" }] });
  expect(await readFile(config(), "utf8")).toContain('ref: "v1.1.0"');
});

it("reports floating entries instead of rewriting them", async () => {
  // Given: an installed entry following the default branch, then an upstream skill change.
  await writeConfig(`    - url: ${sample.url}
      path: skills`);
  await sample.command(["install"]);
  const before = await readFile(config(), "utf8");
  await changeReview();
  // When: update runs.
  const result = await sample.command(["update"]);
  // Then: the entry is reported as following upstream and the file is untouched.
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout).toContain(
    `FOLLOWS ${sample.url} follows the default branch; run install to apply`,
  );
  expect(await readFile(config(), "utf8")).toBe(before);
});
