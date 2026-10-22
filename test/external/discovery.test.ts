import { join } from "node:path";
import { readFile, symlink } from "node:fs/promises";
import { afterEach, beforeEach, expect, it } from "vitest";
import { validateRepo, syncRepo } from "../../src/engine/index.js";
import { assertNever, externalFixture, skill } from "./helpers.js";

let sample: Awaited<ReturnType<typeof externalFixture>>;
beforeEach(async () => {
  sample = await externalFixture();
});
afterEach(async () => {
  await sample.cleanup();
});

it.each([
  { path: "skills/review", names: ["review"] },
  { path: "skills", include: ["release"], names: ["release"] },
  { path: "skills", include: [], names: [] },
])("selects $names when reading path $path", async ({ path, names, ...input }) => {
  // Given: either a single skill directory or an explicitly filtered collection.
  await sample.configure([{ url: sample.url, path, ...input }]);
  // When: validation discovers external skills.
  const result = await validateRepo(sample.repo, { env: sample.env });
  // Then: exactly the requested skills enter selection.
  expect(result.diagnostics).toEqual([]);
  expect(result.model?.skills.map((entry) => entry.name)).toEqual(names);
});

it("reports a precise config path when include names an unknown skill", async () => {
  // Given: a collection with no skill named missing.
  await sample.configure([{ url: sample.url, path: "skills", include: ["missing"] }]);
  // When: discovery applies the include list.
  const result = await validateRepo(sample.repo, { env: sample.env });
  // Then: the invalid selection is located in the configuration.
  expect(result.snapshot).toBeUndefined();
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      severity: "error",
      code: "external.include",
      file: join(sample.repo, "skillerie.yaml"),
      jsonPath: "/skills/external/0/include/0",
    }),
  );
});

it.each(["local", "external"] as const)(
  "reports a collision when a skill duplicates another %s skill",
  async (kind) => {
    // Given: a colliding local source or a second external entry.
    switch (kind) {
      case "local":
        await sample.put(join(sample.repo, "skills/review/SKILL.md"), skill("review"));
        break;
      case "external":
        await sample.configure([
          { url: sample.url, path: "skills" },
          { url: sample.url, path: "skills/review" },
        ]);
        break;
      default:
        assertNever(kind);
    }
    // When: all discovered names are merged.
    const result = await validateRepo(sample.repo, { env: sample.env });
    // Then: collisions fail rather than silently choosing one source.
    expect(result.snapshot).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "external.collision",
        jsonPath: `/skills/external/${kind === "local" ? 0 : 1}`,
      }),
    );
  },
);

it("accepts a disabled collision when the name is globally excluded", async () => {
  // Given: a collision whose name is disabled for every harness.
  await sample.put(join(sample.repo, "skills/review/SKILL.md"), skill("review"));
  await sample.configure([{ url: sample.url, path: "skills" }], {
    skills: { disabled: ["review"] },
  });
  // When: validation merges and selects.
  const result = await validateRepo(sample.repo, { env: sample.env });
  // Then: only the noncolliding skill is applicable.
  expect(result.diagnostics).toEqual([]);
  expect(result.model?.harnesses.opencode?.skills.map((entry) => entry.name)).toEqual(["release"]);
});

it("uses the shared selection and requirement pipeline when externals have overrides", async () => {
  // Given: a disabled skill and a requirement supplied by an override on metadata-free invocation fields.
  await sample.configure([{ url: sample.url, path: "skills" }], {
    harnesses: ["opencode", "pi"],
    skills: {
      disabled: ["release"],
      overrides: { review: { requires: { harness: "opencode" }, "user-invocable": false } },
      harnesses: {
        pi: { enabled: [], disabled: [], overrides: { review: { "argument-hint": "pi-input" } } },
      },
    },
  });
  // When: the engine resolves applicability.
  const result = await validateRepo(sample.repo, { env: sample.env });
  // Then: external provenance survives the same override and requires decisions as local content.
  expect(result.diagnostics).toEqual([]);
  expect(result.model?.harnesses.opencode?.skills.map((entry) => entry.name)).toEqual(["review"]);
  expect(result.model?.harnesses.opencode?.skills[0]?.frontmatter["user-invocable"]).toBe(false);
  expect(result.model?.harnesses.pi?.skills).toEqual([]);
  expect(result.snapshot?.requires).toContainEqual(
    expect.objectContaining({
      entityKind: "skill",
      name: "review",
      harness: "pi",
      result: expect.objectContaining({ satisfied: false }),
    }),
  );
});

it("excludes a skill when a per-harness disabled list selects another external skill", async () => {
  // Given: global and per-harness allowlists differ, and disabled wins.
  await sample.configure([{ url: sample.url, path: "skills" }], {
    harnesses: ["opencode", "pi"],
    skills: {
      enabled: ["review"],
      harnesses: { pi: { enabled: ["release", "review"], disabled: ["review"], overrides: {} } },
    },
  });
  // When: selection is resolved.
  const result = await validateRepo(sample.repo, { env: sample.env });
  // Then: each harness receives its own effective list.
  expect(result.model?.harnesses.opencode?.skills.map((entry) => entry.name)).toEqual(["review"]);
  expect(result.model?.harnesses.pi?.skills.map((entry) => entry.name)).toEqual(["release"]);
});

it.each(["opencode", "codex", "omo", "pi"] as const)(
  "renders external support files and origin when %s is enabled",
  async (harness) => {
    // Given: external Markdown, binary support, and executable metadata.
    await sample.put(
      join(sample.remote, "skills/review/references/guide.md"),
      "`Read` ${CLAUDE_PLUGIN_ROOT}/skills/review/reference.txt\n",
    );
    await sample.put(join(sample.remote, "skills/review/reference.txt"), Buffer.from([0, 255, 10]));
    const sha = await sample.commit();
    await sample.configure([{ url: sample.url, path: "skills", include: ["review"] }], {
      harnesses: [harness],
    });
    // When: the real adapter renders and publishes the skill.
    const result = await syncRepo(sample.repo, { env: sample.env });
    // Then: its body and support files reach the generation without a cache-path source label.
    expect(result.diagnostics).toEqual([]);
    const root = join(sample.root, "cache/current", harness, "skills/review");
    const markdown = await readFile(join(root, "SKILL.md"), "utf8");
    const source = /<!-- (?:Generated by skillerie\. )?Source: (.*?) -->/.exec(markdown)?.[1];
    expect(source).toBe(`${sample.url}@${sha.slice(0, 8)}/skills/review/SKILL.md`);
    expect(await readFile(join(root, "reference.txt"))).toEqual(Buffer.from([0, 255, 10]));
    expect(await readFile(join(root, "references/guide.md"), "utf8")).not.toContain(
      "${CLAUDE_PLUGIN_ROOT}",
    );
  },
);

it("ignores unrelated support failures when include selects another skill", async () => {
  // Given: an unselected skill with a support link and malformed metadata.
  await sample.put(join(sample.remote, "skills/release/SKILL.md"), "---\nname: [invalid\n---\n");
  await symlink("../review/SKILL.md", join(sample.remote, "skills/release/linked.md"));
  await sample.commit();
  await sample.configure([{ url: sample.url, path: "skills", include: ["review"] }]);
  // When: discovery reads the requested subset.
  const result = await validateRepo(sample.repo, { env: sample.env });
  // Then: excluded skill directories are not treated as selected source trees.
  expect(result.diagnostics).toEqual([]);
  expect(result.model?.skills.map((entry) => entry.name)).toEqual(["review"]);
});

it("rejects symlinked ancestors when an external path traverses a repository link", async () => {
  // Given: a configured path through an otherwise valid git symlink.
  await symlink("skills", join(sample.remote, "alias"));
  await sample.commit();
  await sample.configure([{ url: sample.url, path: "alias/review" }]);
  // When: discovery inspects the requested path.
  const result = await validateRepo(sample.repo, { env: sample.env });
  // Then: the path is rejected before following the link.
  expect(result.snapshot).toBeUndefined();
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ severity: "error", code: "source.symlink" }),
  );
});
