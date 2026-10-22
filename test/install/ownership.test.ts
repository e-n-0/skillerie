import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { install, uninstall } from "../../src/install/index.js";
import { fixture } from "./helpers.js";

it("records repository ownership even when every action is a seed", async () => {
  // Given: an installation contains only user-owned seeds.
  const f = await fixture();
  const options = {
    ...f.options,
    actions: [{ kind: "seed" as const, source: f.source, target: f.target }],
  };
  await install(options);
  // When: a different repository attempts installation.
  const other = {
    ...options,
    repo: { ...options.repo, path: join(f.root, "another-repo") },
  };
  // Then: its ownership conflict is enforced independently of managed entry count.
  await expect(install(other)).rejects.toMatchObject({ code: "install.owner" });
});

it("preserves a user replacement of an owned tree during uninstall", async () => {
  // Given: a generated tree was subsequently replaced with a user file.
  const f = await fixture();
  const source = join(f.root, "skills");
  const target = join(f.harnessHome, "skills");
  await mkdir(source);
  await writeFile(join(source, "demo"), "demo");
  const options = {
    ...f.options,
    actions: [{ kind: "exclusiveTree" as const, source, target, preserve: [] }],
  };
  await install(options);
  await rm(target, { recursive: true });
  await writeFile(target, "my replacement");
  // When: uninstall encounters child ownership records below that user replacement.
  const result = await uninstall(options);
  // Then: it preserves the replacement and reports the blocked tree.
  expect(await readFile(target, "utf8")).toBe("my replacement");
  expect(result.findings.some((finding) => finding.code === "install.user-edit")).toBe(true);
});
