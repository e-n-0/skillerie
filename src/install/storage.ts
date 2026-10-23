import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { hasCode } from "./images.js";
import { jsonValue } from "./json.js";
import { InstallError } from "./types.js";
import { parseExternalRevisions } from "../model/external-state.js";
import type { Image, Journal, ManagedEntry, Manifest, MergeRecord, RepoIdentity } from "./types.js";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InstallError("state.invalid", "Invalid installer state.");
  return Object.fromEntries(Object.entries(value));
}

function string(value: unknown): string {
  if (typeof value !== "string")
    throw new InstallError("state.invalid", "Expected a state string.");
  return value;
}

function path(value: unknown): string {
  const result = string(value);
  if (!isAbsolute(result)) throw new InstallError("state.path", "State path must be absolute.");
  return result;
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new InstallError("state.invalid", "Expected a state array.");
  return value;
}

function mode(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0o777) {
    throw new InstallError("state.mode", "Invalid state file mode.");
  }
  return value;
}

function parseImage(input: unknown): Image {
  const value = object(input);
  switch (value["kind"]) {
    case "absent":
      return { kind: "absent" };
    case "file":
      return { kind: "file", data: string(value["data"]), mode: mode(value["mode"]) };
    case "link":
      return { kind: "link", source: string(value["source"]) };
    case "directory": {
      const children: Record<string, Image> = {};
      for (const [name, child] of Object.entries(object(value["children"]))) {
        if (!name || name === "." || name === ".." || /[/\\\0]/u.test(name)) {
          throw new InstallError("state.path", "Invalid state child path.");
        }
        Object.defineProperty(children, name, { value: parseImage(child), enumerable: true });
      }
      return { kind: "directory", mode: mode(value["mode"]), children };
    }
    default:
      throw new InstallError("state.image", "Unknown state image.");
  }
}

function merge(input: unknown): MergeRecord {
  const value = object(input);
  const format = value["format"];
  if (format !== "toml" && format !== "json" && format !== "text" && format !== "array") {
    throw new InstallError("state.merge", "Unknown merge format.");
  }
  const added = list(value["added"]);
  if (!added.every(jsonValue))
    throw new InstallError("state.merge", "Invalid array ownership values.");
  return {
    blockId: string(value["blockId"]),
    format,
    jsonPath: string(value["jsonPath"]),
    added,
    before: string(value["before"]),
    after: string(value["after"]),
  };
}

function entry(input: unknown): ManagedEntry {
  const value = object(input);
  const kind = value["kind"];
  if (kind !== "owned" && kind !== "directory" && kind !== "merge") {
    throw new InstallError("state.entry", "Unknown ownership kind.");
  }
  return {
    target: path(value["target"]),
    kind,
    fingerprint: string(value["fingerprint"]),
    preimage: parseImage(value["preimage"]),
    merges: list(value["merges"]).map(merge),
  };
}

async function load(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

export function statePath(home: string, name: string): string {
  return join(home, ".skillerie", name);
}

export async function readManifest(home: string): Promise<Manifest | undefined> {
  const input = await load(statePath(home, "manifest.json"));
  if (input === undefined) return undefined;
  const value = object(input),
    repo = object(value["repo"]),
    harness = value["harness"];
  if (
    value["version"] !== 1 ||
    (harness !== "codex" && harness !== "opencode" && harness !== "omo" && harness !== "pi")
  ) {
    throw new InstallError("state.version", "Unsupported installer manifest.");
  }
  const identity: RepoIdentity = {
    path: path(repo["path"]),
    configHash: string(repo["configHash"]),
  };
  return {
    version: 1,
    ...(value["profile"] === undefined ? {} : { profile: string(value["profile"]) }),
    ...(value["external"] === undefined
      ? {}
      : { external: parseExternalRevisions(value["external"]) }),
    repo: identity,
    harness,
    engineVersion: string(value["engineVersion"]),
    entries: list(value["entries"]).map(entry),
    createdDirectories: list(value["createdDirectories"]).map(path),
  };
}

export async function readJournal(home: string): Promise<Journal | undefined> {
  const input = await load(statePath(home, "journal.json"));
  if (input === undefined) return undefined;
  const value = object(input),
    next = value["next"],
    steps = list(value["steps"]);
  if (
    value["version"] !== 1 ||
    typeof next !== "number" ||
    !Number.isInteger(next) ||
    next < 0 ||
    next > steps.length
  ) {
    throw new InstallError("state.journal", "Invalid installer journal.");
  }
  return {
    version: 1,
    next,
    steps: steps.map((input) => {
      const step = object(input),
        kind = step["kind"];
      if (kind !== "write" && kind !== "remove" && kind !== "mkdir")
        throw new InstallError("state.step", "Invalid journal step.");
      return {
        kind,
        target: path(step["target"]),
        backup: path(step["backup"]),
        before: parseImage(step["before"]),
        after: parseImage(step["after"]),
      };
    }),
  };
}
