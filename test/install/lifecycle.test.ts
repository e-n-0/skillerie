import { mkdir, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { install, planInstall, status, uninstall } from "../../src/install/index.js";
import { backups, fixture, snapshot } from "./helpers.js";

it("installs once and leaves an idempotent rerun byte-identical", async () => {
  // Given: generated links and copies have no existing installation.
  const f = await fixture();
  const copied = join(f.harnessHome, "copied");
  const options = {
    ...f.options,
    actions: [...f.options.actions, { kind: "copy" as const, source: f.source, target: copied }],
  };
  await install(options);
  const before = await snapshot(f.home);
  // When: the same generation is installed again.
  const result = await install(options);
  // Then: no action or persistent byte changes occur.
  expect(result.actions).toEqual([]);
  expect(await snapshot(f.home)).toEqual(before);
  expect(await readlink(f.target)).toBe(f.source);
  expect(await readFile(copied, "utf8")).toBe("generated\n");
});

it("plans without writing or creating an absent harness home", async () => {
  // Given: the requested harness directory does not exist.
  const f = await fixture(),
    before = await snapshot(f.home);
  const harnessHome = join(f.home, "missing", "harness");
  // When: a plan and status are requested for it.
  const options = {
    ...f.options,
    harnessHome,
    actions: [{ kind: "link" as const, source: f.source, target: join(harnessHome, "config") }],
  };
  const result = await planInstall(options);
  await status(options);
  // Then: the complete HOME snapshot, including directories, is unchanged.
  expect(result.actions.length).toBeGreaterThan(0);
  expect(await snapshot(f.home)).toEqual(before);
});

it("backs up a conflicting real file at its HOME-relative location", async () => {
  // Given: a user file occupies the target.
  const f = await fixture();
  await writeFile(f.target, "user config");
  // When: the generated link replaces it.
  await install(f.options);
  // Then: its original bytes remain in the backup tree.
  const saved = await snapshot(f.options.backupRoot);
  expect(Object.keys(saved).some((path) => path.endsWith("/.harness/config"))).toBe(true);
  expect(await backups(f.options)).toContain(
    `file:420:${Buffer.from("user config").toString("base64")}`,
  );
});

it("backs up a foreign dangling symlink rather than deleting it", async () => {
  // Given: a foreign link has a missing destination.
  const f = await fixture();
  await symlink("missing-foreign", f.target);
  // When: installation takes ownership of the path.
  await install(f.options);
  // Then: the exact original link target survives in backups.
  expect(await backups(f.options)).toContain("link:missing-foreign");
  expect(await readlink(f.target)).toBe(f.source);
});

it("does not restore a dangling preimage link when an entry stops being managed", async () => {
  // Given: the managed link replaced a foreign link whose destination is missing.
  const f = await fixture();
  await symlink("missing-foreign", f.target);
  await install(f.options);
  // When: the entry leaves the managed set, then the same set is installed again.
  const released = await install({ ...f.options, actions: [] });
  const rerun = await install({ ...f.options, actions: [] });
  // Then: the path is removed rather than relinked, and the rerun has nothing to do.
  expect(released.actions).toEqual([
    expect.objectContaining({ target: f.target, after: { kind: "absent" } }),
  ]);
  expect(rerun.actions).toEqual([]);
  expect((await snapshot(f.harnessHome))["config"]).toBeUndefined();
  expect(await backups(f.options)).toContain("link:missing-foreign");
});

it("restores the starting HOME after an install and uninstall roundtrip", async () => {
  // Given: HOME has unrelated files and an absent nested target.
  const f = await fixture();
  await writeFile(join(f.home, "notes"), "keep");
  const before = await snapshot(f.home);
  const options = {
    ...f.options,
    actions: [
      { kind: "link" as const, source: f.source, target: join(f.harnessHome, "nested", "config") },
    ],
  };
  // When: the installation is created and then uninstalled.
  await install(options);
  await uninstall(options);
  // Then: all original entries match, with only backups added.
  const after = await snapshot(f.home);
  expect(
    Object.fromEntries(
      Object.entries(after).filter(([path]) => path !== "backups" && !path.startsWith("backups/")),
    ),
  ).toEqual(before);
});

it("leaves seeds user-owned during reinstall and uninstall", async () => {
  // Given: a seed is installed and then edited.
  const f = await fixture();
  const options = {
    ...f.options,
    actions: [{ kind: "seed" as const, source: f.source, target: f.target }],
  };
  await install(options);
  await writeFile(f.target, "my seed");
  // When: it is reinstalled and uninstalled.
  await install(options);
  await uninstall(options);
  // Then: its user-owned value remains.
  expect(await readFile(f.target, "utf8")).toBe("my seed");
});

it("rejects another repository until takeover is explicitly requested", async () => {
  // Given: one repository owns the harness home.
  const f = await fixture();
  await install(f.options);
  const options = { ...f.options, repo: { ...f.options.repo, path: join(f.root, "other-repo") } };
  // When: the second repository attempts installation.
  await expect(install(options)).rejects.toMatchObject({ code: "install.owner" });
  await install({ ...options, takeover: true });
  // Then: takeover transfers manifest ownership.
  const manifest: unknown = JSON.parse(
    await readFile(join(f.harnessHome, ".skillerie", "manifest.json"), "utf8"),
  );
  expect(manifest).toMatchObject({ repo: options.repo });
});

it("preserves edited managed files and backs them up before force replacement", async () => {
  // Given: a managed copy has been edited by the user.
  const f = await fixture();
  const options = {
    ...f.options,
    actions: [{ kind: "copy" as const, source: f.source, target: f.target }],
  };
  await install(options);
  await writeFile(f.target, "my changes");
  // When: normal reconciliation, status, and then force reconciliation run.
  const normal = await install(options),
    reported = await status(options);
  expect(await readFile(f.target, "utf8")).toBe("my changes");
  await install({ ...options, force: true });
  // Then: drift was reported and force retained the edited preimage.
  expect(normal.findings).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "install.user-edit" })]),
  );
  expect(reported.findings).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "install.user-edit" })]),
  );
  expect(await readFile(f.target, "utf8")).toBe("generated\n");
  expect(await backups(options)).toContain(
    `file:420:${Buffer.from("my changes").toString("base64")}`,
  );
});

it("keeps user-edited managed files when uninstalling", async () => {
  // Given: a managed copy was changed after installation.
  const f = await fixture();
  const options = {
    ...f.options,
    actions: [{ kind: "copy" as const, source: f.source, target: f.target }],
  };
  await install(options);
  await writeFile(f.target, "keep this");
  // When: the installation is removed.
  const result = await uninstall(options);
  // Then: edited content and its ownership record survive.
  expect(await readFile(f.target, "utf8")).toBe("keep this");
  expect(result.findings.some((finding) => finding.code === "install.user-edit")).toBe(true);
});

it("backs up foreign tree entries while retaining preserved descendants", async () => {
  // Given: an exclusive tree includes foreign entries and a protected subdirectory.
  const f = await fixture(),
    source = join(f.root, "skills"),
    target = join(f.harnessHome, "skills");
  await mkdir(source);
  await writeFile(join(source, "demo"), "demo");
  await mkdir(join(target, ".system"), { recursive: true });
  await writeFile(join(target, ".system", "native"), "native");
  await writeFile(join(target, "foreign"), "foreign");
  await symlink("missing", join(target, "foreign-link"));
  const options = {
    ...f.options,
    actions: [{ kind: "exclusiveTree" as const, source, target, preserve: [".system"] }],
  };
  // When: the tree is reconciled twice, then uninstalled.
  await install(options);
  expect((await install(options)).actions).toEqual([]);
  await uninstall(options);
  // Then: preserved entries survive and every foreign entry has a backup.
  expect(await readFile(join(target, ".system", "native"), "utf8")).toBe("native");
  expect(await backups(options)).toContain("link:missing");
  expect(await backups(options)).toContain(`file:420:${Buffer.from("foreign").toString("base64")}`);
});
