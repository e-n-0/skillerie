import { readFile, rm } from "node:fs/promises";
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

/** Commit an upstream edit to the review skill, so selected content really changes. */
async function changeReview(): Promise<string> {
  await sample.put(join(sample.remote, "skills/review/SKILL.md"), skill("review", "Updated.\n"));
  return sample.commit();
}

it.each([undefined, "main"])(
  "reports current with exit zero when floating ref %s has not moved",
  async (ref) => {
    // Given: an installed floating revision.
    await sample.configure([{ url: sample.url, path: "skills", ...(ref ? { ref } : {}) }]);
    expect((await sample.command(["install"])).code).toBe(0);
    // When: the command compares the active generation with upstream.
    const result = await sample.command(["outdated"]);
    // Then: the entry is current.
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("The external source is up to date.\n");
    expect(result.stderr).toBe("");
  },
);

it.each([undefined, "main"])(
  "reports movement with exit one when floating ref %s advances",
  async (ref) => {
    // Given: installed content followed by a new upstream commit.
    await sample.configure([{ url: sample.url, path: "skills", ...(ref ? { ref } : {}) }]);
    await sample.command(["install"]);
    const sha = await changeReview();
    // When: outdated queries the remote.
    const result = await sample.command(["outdated"]);
    // Then: it reports the installed-to-upstream range and does not silently install.
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      `review  changed  ${sample.url}  ${sample.initial.slice(0, 7)} -> ${sha.slice(0, 7)}  SKILL.md`,
    );
    expect(result.stdout).toContain("No changes: release");
    expect(result.stdout).toContain(
      "Run skillerie install to pick up the source that follows a branch.",
    );
    expect(
      JSON.parse(
        await readFile(join(sample.root, "cache/current/.skillerie-external.json"), "utf8"),
      ),
    ).toMatchObject([{ sha: sample.initial }]);
  },
);

it("lists semantic version tags in numeric order when newer tags are available", async () => {
  // Given: an installed tag with several newer versions and a non-version label.
  await sample.remoteGit(["tag", "v1.2.0"]);
  await sample.configure([{ url: sample.url, path: "skills", ref: "v1.2.0" }]);
  await sample.command(["install"]);
  await changeReview();
  for (const tag of ["v1.4.0", "v1.10.0", "v1.10.0-beta.1", "v01.99.0", "nightly"])
    await sample.remoteGit(["tag", tag]);
  // When: outdated returns its structured result.
  const result = await sample.command(["outdated", "--json"]);
  // Then: numeric and prerelease precedence determine available versions.
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    exitCode: 1,
    diagnostics: [],
    entries: [
      {
        kind: "tag",
        ref: "v1.2.0",
        sha: sample.initial,
        status: "behind",
        newerTags: ["v1.4.0", "v1.10.0-beta.1", "v1.10.0"],
        message: "v1.2.0 -> v1.10.0 available; changed: review (SKILL.md)",
      },
    ],
  });
  expect(result.stderr).toBe("");
});

it("prints a tag upgrade when the command uses human output", async () => {
  // Given: an installed semantic version and a newer tag.
  await sample.remoteGit(["tag", "v1.2.0"]);
  await sample.configure([{ url: sample.url, path: "skills", ref: "v1.2.0" }]);
  await sample.command(["install"]);
  await changeReview();
  await sample.remoteGit(["tag", "v1.4.0"]);
  // When: outdated prints its human report.
  const result = await sample.command(["outdated"]);
  // Then: the available tag is actionable without JSON parsing.
  expect(result.code).toBe(1);
  expect(result.stdout).toContain(
    "review  changed  " + sample.url + "  v1.2.0 -> v1.4.0  SKILL.md",
  );
  expect(result.stdout).toContain("Run skillerie update to move this pin, then skillerie install.");
});

it("ignores non-semver tags when a pinned tag is already the newest version", async () => {
  // Given: a semantic pin and a non-semver tag at a newer commit.
  await sample.remoteGit(["tag", "v1.2.0"]);
  await sample.configure([{ url: sample.url, path: "skills", ref: "v1.2.0" }]);
  await sample.commit();
  await sample.remoteGit(["tag", "nightly"]);
  // When: outdated resolves without an existing install.
  const result = await sample.command(["outdated"]);
  // Then: fresh resolution provides a baseline and non-version labels are ignored.
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("The external source is up to date.\n");
});

it.each([
  { moved: false, json: false },
  { moved: true, json: false },
  { moved: false, json: true },
  { moved: true, json: true },
])("reports a full SHA pin when movement is $moved and JSON is $json", async ({ moved, json }) => {
  // Given: a full SHA pin and an optionally newer default branch.
  await sample.configure([{ url: sample.url, path: "skills", ref: sample.initial }]);
  await sample.command(["sync"]);
  const head = moved ? await changeReview() : sample.initial;
  // When: outdated compares the pin with the remote default head.
  const result = await sample.command(["outdated", ...(json ? ["--json"] : [])]);
  // Then: pins report the head rather than being mistaken for branch names.
  expect(result.code).toBe(moved ? 1 : 0);
  const message = moved
    ? `default branch head ${head.slice(0, 8)} differs from pinned ${sample.initial.slice(0, 8)}; changed: review (SKILL.md)`
    : "up to date";
  if (json) {
    expect(JSON.parse(result.stdout)).toMatchObject({
      exitCode: moved ? 1 : 0,
      entries: [
        {
          kind: "sha",
          sha: sample.initial,
          latestSha: head,
          status: moved ? "behind" : "current",
          outdated: moved,
          message,
        },
      ],
    });
  } else
    expect(result.stdout).toContain(
      moved
        ? `review  changed  ${sample.url}  ${sample.initial.slice(0, 7)} -> ${head.slice(0, 7)}  SKILL.md`
        : "The external source is up to date.",
    );
});

it("returns exit two when an upstream comparison fails", async () => {
  // Given: an installed revision but an unreachable remote.
  await sample.command(["install"]);
  await rm(sample.remote, { recursive: true });
  // When: outdated attempts a live comparison.
  const result = await sample.command(["outdated", "--json"]);
  // Then: a cached skill cannot masquerade as a successful remote check.
  expect(result.code).toBe(2);
  expect(JSON.parse(result.stdout)).toMatchObject({
    exitCode: 2,
    diagnostics: [{ code: "external.outdated", severity: "error" }],
  });
});

it("returns exit two when configuration is invalid", async () => {
  // Given: an invalid configuration version.
  await sample.put(join(sample.repo, "skillerie.yaml"), "version: 99\n");
  // When: outdated loads the configuration.
  const result = await sample.command(["outdated", "--json"]);
  // Then: validation errors follow the command's error exit convention.
  expect(result.code).toBe(2);
  expect(JSON.parse(result.stdout)).toMatchObject({ exitCode: 2, entries: [] });
});

it("prints installed revisions when status observes a newer upstream commit", async () => {
  // Given: an installed revision and a newly advanced upstream.
  await sample.command(["install"]);
  await sample.commit();
  // When: status reports ownership and drift.
  const result = await sample.command(["status"]);
  // Then: the external status line names the active generation rather than the fresh validation.
  expect(result.stdout).toContain(
    `EXTERNAL ${sample.url} latest ${sample.initial.slice(0, 8)} skills`,
  );
});

it("stays offline when doctor reports installed external skills", async () => {
  // Given: an installed revision, no remote, and no git executable on PATH.
  await sample.command(["install"]);
  await rm(sample.remote, { recursive: true });
  // When: doctor inspects local state.
  const result = await sample.command(["doctor", "--json"], { env: { ...sample.env, PATH: "" } });
  // Then: it reports installed provenance and suggests the separate online check.
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    diagnostics: expect.arrayContaining([
      expect.objectContaining({
        severity: "info",
        code: "doctor.external",
        message: expect.stringContaining(`${sample.initial.slice(0, 8)}; run skillerie outdated`),
      }),
    ]),
  });
});

it("reports missing installations offline when external content has never been cached", async () => {
  // Given: configured externals without a cache and without git on PATH.
  const env = { ...sample.env, PATH: "" };
  // When: doctor inspects only the local environment.
  const result = await sample.command(["doctor", "--json"], { env });
  // Then: each entry is identified without trying to fetch it.
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    diagnostics: expect.arrayContaining([
      expect.objectContaining({
        code: "doctor.external",
        severity: "info",
        message: expect.stringContaining("not installed; run skillerie outdated"),
      }),
    ]),
  });
});

it("uses the install manifest when active generation revision metadata is unavailable", async () => {
  // Given: installed ownership followed by an unavailable current pointer.
  await sample.command(["install"]);
  await rm(join(sample.root, "cache/current"));
  const sha = await changeReview();
  // When: outdated compares against persisted installation state.
  const result = await sample.command(["outdated", "--json"]);
  // Then: the original installed commit remains the baseline.
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    entries: [{ sha: sample.initial, latestSha: sha, status: "behind" }],
  });
});

it("reports only configured entries when status follows removal of an external entry", async () => {
  // Given: an installed generation with two external entries, then a narrowed configuration.
  await sample.configure([
    { url: sample.url, path: "skills/review" },
    { url: sample.url, path: "skills/release" },
  ]);
  await sample.command(["install"]);
  await sample.configure([{ url: sample.url, path: "skills/review" }]);
  // When: status describes the configured external inputs.
  const result = await sample.command(["status", "--json"]);
  // Then: removed entries do not survive through stale installation metadata.
  expect(JSON.parse(result.stdout)).toMatchObject({
    external: [{ url: sample.url, path: "skills/review", sha: sample.initial }],
  });
  expect(JSON.parse(result.stdout).external).toHaveLength(1);
});

it("keeps invalid external configuration as an error when doctor runs offline", async () => {
  // Given: a URL rejected by the supported remote protocols.
  await sample.configure([{ url: "http://example.invalid/repo.git" }]);
  // When: doctor parses external inputs without git.
  const result = await sample.command(["doctor", "--json"], { env: { ...sample.env, PATH: "" } });
  // Then: missing cached content is lenient, but invalid configuration is still located and fatal.
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    diagnostics: [
      { code: "external.resolve", severity: "error", jsonPath: "/skills/external/0/url" },
    ],
  });
});

it("returns exit two when outdated receives an invalid command option", async () => {
  // Given: an option the outdated command does not accept.
  const args = ["outdated", "--unknown", "--json"];
  // When: the CLI parses the request.
  const result = await sample.command(args);
  // Then: argument errors follow the outdated error convention.
  expect(result.code).toBe(2);
  expect(JSON.parse(result.stdout)).toMatchObject({
    valid: false,
    diagnostics: [{ code: "cli.arguments" }],
  });
});

it("reports an unwritable home when offline external inspection has no manifest", async () => {
  // Given: an external configuration whose harness home is a regular file.
  await sample.put(join(sample.root, "home/opencode"), "not a directory");
  // When: doctor checks the environment without fetching or reading through that home.
  const result = await sample.command(["doctor", "--json"], { env: { ...sample.env, PATH: "" } });
  // Then: the existing home diagnostic remains the actionable failure.
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    diagnostics: expect.arrayContaining([
      expect.objectContaining({ code: "doctor.home.unwritable" }),
    ]),
  });
});

it("reports current when upstream moved without touching the selected skills", async () => {
  // Given: an installed pin that selects only release, then an upstream edit to review.
  await sample.configure([
    { url: sample.url, path: "skills", ref: sample.initial, include: ["release"] },
  ]);
  await sample.command(["install"]);
  const head = await changeReview();
  // When: outdated compares the selected skills between both commits.
  const result = await sample.command(["outdated", "--json"]);
  // Then: the moved head is reported, but nothing selected changed, so it is current.
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    exitCode: 0,
    entries: [
      {
        sha: sample.initial,
        latestSha: head,
        outdated: false,
        status: "current",
        skills: [{ name: "release", status: "unchanged", files: [] }],
        message: `default branch head ${head.slice(0, 8)} differs from pinned ${sample.initial.slice(0, 8)}; no changes to release`,
      },
    ],
  });
});

it("lists changed, added and removed files per skill when selected skills change", async () => {
  // Given: an installed floating entry, then upstream edits, adds and removes skill content.
  await sample.command(["install"]);
  await sample.put(join(sample.remote, "skills/review/SKILL.md"), skill("review", "Updated.\n"));
  await sample.put(join(sample.remote, "skills/review/scripts/check.sh"), "echo ok\n");
  await sample.put(join(sample.remote, "skills/audit/SKILL.md"), skill("audit"));
  await rm(join(sample.remote, "skills/release"), { recursive: true });
  const head = await sample.commit();
  // When: outdated compares every skill under the entry's path.
  const result = await sample.command(["outdated", "--json"]);
  // Then: each skill's status and changed files are reported, and the entry is behind.
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    entries: [
      {
        latestSha: head,
        status: "behind",
        skills: [
          { name: "audit", status: "added", files: ["SKILL.md"] },
          { name: "release", status: "removed", files: ["SKILL.md"] },
          { name: "review", status: "changed", files: ["SKILL.md", "scripts/check.sh"] },
        ],
        message: `upstream moved ${sample.initial.slice(0, 8)}..${head.slice(0, 8)}; changed: audit (added), release (removed), review (SKILL.md, scripts/check.sh)`,
      },
    ],
  });
});
