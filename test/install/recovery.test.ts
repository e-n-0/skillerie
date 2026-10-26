import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, readlink, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { install, uninstall } from "../../src/install/index.js";
import { deferred, fixture } from "./helpers.js";

it("bounds the recovery journal while retaining a large replaced file", async () => {
  // Given: an existing file must survive an interrupted install and uninstall.
  const f = await fixture();
  const original = "x".repeat(1024 * 1024);
  await writeFile(f.target, original);
  let journalBytes = 0;
  // When: installation is interrupted after persisting its recovery journal.
  await expect(
    install({
      ...f.options,
      testHook: async () => {
        journalBytes = (await stat(join(f.harnessHome, ".skillerie", "journal.json"))).size;
        throw new Error("simulated interruption");
      },
    }),
  ).rejects.toThrow("simulated interruption");
  await install(f.options);
  await uninstall(f.options);
  // Then: recovery retains the original without duplicating it in the journal.
  expect(await readFile(f.target, "utf8")).toBe(original);
  expect(journalBytes).toBeLessThan(2 * original.length);
});

it("rolls forward after interruption at every journal mutation boundary", async () => {
  // Given: a transaction installs a nested copy and its manifest.
  const measured = await fixture();
  let steps = 0;
  await install({
    ...measured.options,
    testHook: (step) => {
      steps = step;
    },
  });
  for (let stop = 1; stop <= steps; stop += 1) {
    const f = await fixture();
    await writeFile(f.target, "foreign");
    // When: execution stops at a persisted journal boundary and is retried.
    await expect(
      install({
        ...f.options,
        testHook: (step) => {
          if (step === stop) throw new Error("simulated interruption");
        },
      }),
    ).rejects.toThrow("simulated interruption");
    await install(f.options);
    // Then: the target and manifest consistently describe the completed install.
    expect(await readlink(f.target)).toBe(f.source);
    expect((await install(f.options)).actions).toEqual([]);
    const manifest: unknown = JSON.parse(
      await readFile(join(f.harnessHome, ".skillerie", "manifest.json"), "utf8"),
    );
    expect(manifest).toMatchObject({ repo: f.options.repo });
  }
});

it("serializes concurrent installs without overlapping mutation hooks", async () => {
  // Given: the first transaction pauses after its first persisted mutation.
  const f = await fixture(),
    entered = deferred(),
    resume = deferred();
  let active = false,
    overlapped = false;
  const first = install({
    ...f.options,
    testHook: async (step) => {
      if (step === 1) {
        active = true;
        entered.resolve();
        await resume.promise;
        active = false;
      }
    },
  });
  await entered.promise;
  // When: a second install is started while the first still holds its lock.
  const second = install({
    ...f.options,
    repo: { ...f.options.repo, configHash: "sha256:new" },
    testHook: () => {
      overlapped ||= active;
    },
  });
  resume.resolve();
  await Promise.all([first, second]);
  // Then: hooks never overlap, and the second manifest is the final coherent state.
  expect(overlapped).toBe(false);
  expect(await readlink(f.target)).toBe(f.source);
  const manifest: unknown = JSON.parse(
    await readFile(join(f.harnessHome, ".skillerie", "manifest.json"), "utf8"),
  );
  expect(manifest).toMatchObject({ repo: { configHash: "sha256:new" } });
});

it("reclaims an exclusive lock whose owning process has exited", async () => {
  // Given: a lock belongs to a process observed to exit.
  const f = await fixture(),
    child = spawn(process.execPath, ["-e", "process.exit(0)"]);
  const exited = once(child, "exit");
  const pid = child.pid;
  if (pid === undefined) throw new Error("child did not start");
  await exited;
  await mkdir(join(f.harnessHome, ".skillerie"));
  await writeFile(join(f.harnessHome, ".skillerie", "lock"), String(pid));
  // When: installation acquires the stale lock.
  await install(f.options);
  // Then: the dead owner's lock does not prevent installation.
  expect(await readlink(f.target)).toBe(f.source);
});
