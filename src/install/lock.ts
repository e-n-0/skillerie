import { watch } from "node:fs";
import { lstat, mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { hasCode, safeAncestors } from "./images.js";
import { statePath } from "./storage.js";
import { InstallError } from "./types.js";

/** The queue also prevents same-process contenders mistaking our PID for a stale owner. */
const queues = new Map<string, Promise<void>>();

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (hasCode(error, "ESRCH")) return false;
    throw error;
  }
}

async function reclaim(path: string): Promise<boolean> {
  try {
    const before = await stat(path);
    const pid = Number(await readFile(path, "utf8"));
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    if (alive(pid)) return false;
    const after = await lstat(path);
    if (before.ino !== after.ino || before.dev !== after.dev) return false;
    await rm(path);
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return true;
    throw error;
  }
}

async function acquire(home: string) {
  const path = statePath(home, "lock");
  for (;;) {
    // Subscribe before trying O_EXCL, so a release between open and await cannot be missed.
    let changed: (() => void) | undefined;
    let expired: ((error: Error) => void) | undefined;
    const signal = new Promise<void>((resolve, reject) => {
      changed = resolve;
      expired = reject;
    });
    const watcher = watch(dirname(path), () => changed?.());
    const timeout = setTimeout(
      () =>
        expired?.(new InstallError("install.lock", "Timed out waiting for the installation lock.")),
      30_000,
    );
    try {
      try {
        const handle = await open(path, "wx", 0o600);
        try {
          await handle.writeFile(String(process.pid));
          await handle.sync();
        } catch (error) {
          await handle.close();
          await rm(path, { force: true });
          throw error;
        }
        return handle;
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
      }
      if (await reclaim(path)) continue;
      await signal;
    } finally {
      clearTimeout(timeout);
      watcher.close();
    }
  }
}

export async function locked<T>(
  home: string,
  run: (created: readonly string[]) => Promise<T>,
): Promise<T> {
  const previous = queues.get(home) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  queues.set(home, pending);
  await previous;
  try {
    const created: string[] = [];
    for (let directory = home; directory !== dirname(directory); directory = dirname(directory)) {
      try {
        await lstat(directory);
        break;
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw error;
        created.push(directory);
      }
    }
    await safeAncestors(statePath(home, "lock"), home);
    await mkdir(statePath(home, ""), { recursive: true, mode: 0o700 });
    const handle = await acquire(home);
    try {
      return await run(created);
    } finally {
      await handle.close();
      await rm(statePath(home, "lock"));
    }
  } finally {
    release();
    if (queues.get(home) === pending) queues.delete(home);
  }
}
