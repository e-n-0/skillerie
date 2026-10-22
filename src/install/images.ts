import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, isAbsolute, resolve, sep } from "node:path";
import { assertNever, InstallError } from "./types.js";
import type { Image } from "./types.js";

export const absent: Image = { kind: "absent" };

export function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export async function image(path: string): Promise<Image> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return absent;
    throw error;
  }
  if (info.isSymbolicLink()) return { kind: "link", source: await readlink(path) };
  if (info.isDirectory()) {
    const children: Record<string, Image> = {};
    for (const name of (await readdir(path)).sort()) {
      Object.defineProperty(children, name, {
        value: await image(join(path, name)),
        enumerable: true,
      });
    }
    return { kind: "directory", mode: info.mode & 0o777, children };
  }
  if (!info.isFile()) throw new InstallError("entry.type", `Unsupported filesystem entry: ${path}`);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return {
      kind: "file",
      data: (await handle.readFile()).toString("base64"),
      mode: info.mode & 0o777,
    };
  } finally {
    await handle.close();
  }
}

export function fingerprint(value: Image): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function fileImage(text: string, mode = 0o644): Image {
  return { kind: "file", data: Buffer.from(text).toString("base64"), mode };
}

export function text(value: Image): string {
  switch (value.kind) {
    case "absent":
      return "";
    case "file":
      return Buffer.from(value.data, "base64").toString("utf8");
    case "link":
    case "directory":
      throw new InstallError("merge.type", "Merge target must be a regular file.");
    default:
      return assertNever(value);
  }
}

export function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

/** Refuse redirected ancestors, without treating system aliases above home as user paths. */
export async function safeAncestors(path: string, home: string): Promise<void> {
  let parent = dirname(path);
  const boundary = within(home, path) ? resolve(home) : dirname(resolve(path));
  while (within(boundary, parent)) {
    try {
      const info = await lstat(parent);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new InstallError("path.parent", `Install parent is not a real directory: ${parent}`);
      }
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    if (parent === boundary) break;
    parent = dirname(parent);
  }
}

async function materialize(path: string, value: Image): Promise<void> {
  switch (value.kind) {
    case "absent":
      return;
    case "link":
      await symlink(value.source, path);
      return;
    case "file": {
      await writeFile(path, Buffer.from(value.data, "base64"), { flag: "wx", mode: value.mode });
      await chmod(path, value.mode);
      const handle = await open(path, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      return;
    }
    case "directory":
      await mkdir(path, { mode: value.mode });
      for (const [name, child] of Object.entries(value.children)) {
        await materialize(join(path, name), child);
      }
      await chmod(path, value.mode);
      return;
    default:
      assertNever(value);
  }
}

/** Destination must be absent; callers journal and back up before replacing it. */
export async function putImage(path: string, value: Image): Promise<void> {
  if (value.kind === "absent") return;
  const staged = join(dirname(path), `.skillerie-${randomUUID()}`);
  try {
    await materialize(staged, value);
    await rename(staged, path);
  } finally {
    await rm(staged, { recursive: true, force: true });
  }
}

export async function atomicJson(path: string, value: unknown): Promise<void> {
  const staged = `${path}.${randomUUID()}`;
  try {
    await materialize(staged, fileImage(JSON.stringify(value, null, 2) + "\n", 0o600));
    await rename(staged, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await rm(staged, { force: true });
  }
}
