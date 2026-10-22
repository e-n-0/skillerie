import { lstat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { Action, Diagnostic } from "../core/types.js";
import { mergeFindings } from "./conflicts.js";
import { absent, fileImage, fingerprint, hasCode, image, text } from "./images.js";
import { applyMerge, mergeIntact, restoreMerge } from "./merges.js";
import { assertNever, InstallError } from "./types.js";
import type {
  Image,
  InstallOptions,
  InstallPlan,
  ManagedEntry,
  Manifest,
  PlannedAction,
} from "./types.js";

/** A virtual filesystem overlay: planning never mutates the real filesystem. */
export class Planner {
  readonly changes = new Map<string, PlannedAction>();
  readonly entries = new Map<string, ManagedEntry>();
  readonly findings: Diagnostic[] = [];
  readonly directories: Set<string>;
  readonly previous: ReadonlyMap<string, ManagedEntry>;
  readonly inspected = new Set<string>();

  constructor(
    readonly options: InstallOptions,
    readonly manifest: Manifest | undefined,
  ) {
    this.previous = new Map(manifest?.entries.map((entry) => [entry.target, entry]));
    this.directories = new Set(manifest?.createdDirectories ?? []);
  }

  async read(path: string): Promise<Image> {
    const planned = this.changes.get(path);
    if (planned) return planned.after;
    for (let parent = dirname(path); parent !== dirname(parent); parent = dirname(parent)) {
      const ancestor = this.changes.get(parent);
      if (ancestor && ancestor.after.kind === "directory" && ancestor.before.kind !== "directory")
        return absent;
    }
    const current = await image(path);
    if (!this.inspected.has(path)) {
      this.inspected.add(path);
      const actions = this.options.actions.filter((action) => action.target === path);
      if (actions.some((action) => action.kind === "mergeBlock" && action.format === "toml"))
        this.findings.push(...mergeFindings(text(current), actions, this.options.force));
    }
    return current;
  }

  async parents(path: string): Promise<void> {
    const parent = dirname(path);
    if (parent === path) return;
    const planned = this.changes.get(parent);
    if (planned?.after.kind === "directory") return;
    try {
      const info = await lstat(parent);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new InstallError("path.parent", `Unsafe parent: ${parent}`);
      return;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    await this.parents(parent);
    this.directories.add(parent);
    this.changes.set(parent, {
      kind: "mkdir",
      target: parent,
      before: absent,
      after: { kind: "directory", mode: 0o755, children: {} },
    });
  }

  async set(target: string, after: Image): Promise<void> {
    const original = this.changes.get(target)?.before ?? (await this.read(target));
    if (fingerprint(original) === fingerprint(after)) {
      this.changes.delete(target);
      return;
    }
    if (after.kind !== "absent") await this.parents(target);
    this.changes.set(target, {
      kind: after.kind === "absent" ? "remove" : "write",
      target,
      before: original,
      after,
    });
  }

  edited(entry: ManagedEntry, current: Image): boolean {
    if (current.kind === "absent") return false;
    switch (entry.kind) {
      case "directory":
        return current.kind !== "directory";
      case "owned":
        return fingerprint(current) !== entry.fingerprint;
      case "merge":
        try {
          return (
            current.kind !== "file" ||
            !entry.merges.every((merge) => mergeIntact(merge, text(current)))
          );
        } catch (error) {
          if (error instanceof InstallError) return true;
          throw error;
        }
      default:
        return assertNever(entry.kind);
    }
  }

  skip(entry: ManagedEntry, current: Image): boolean {
    if (!this.edited(entry, current) || this.options.force) return false;
    this.findings.push({
      severity: "warn",
      code: "install.user-edit",
      file: entry.target,
      message: "User-edited managed entry was preserved.",
    });
    this.entries.set(entry.target, entry);
    return true;
  }

  async owned(target: string, desired: Image): Promise<void> {
    const current = await this.read(target),
      old = this.previous.get(target);
    if (old && this.skip(old, current)) return;
    await this.set(target, desired);
    this.entries.set(target, {
      target,
      kind: "owned",
      fingerprint: fingerprint(desired),
      preimage: old?.preimage ?? current,
      merges: [],
    });
  }

  async action(action: Action): Promise<void> {
    const current = await this.read(action.target);
    switch (action.kind) {
      case "link":
        if ((await image(action.source)).kind === "absent")
          throw new InstallError("source.missing", `Missing install source: ${action.source}`);
        await this.owned(action.target, { kind: "link", source: action.source });
        return;
      case "copy":
      case "seed": {
        if (action.kind === "seed" && current.kind !== "absent") return;
        const source = await image(action.source);
        if (source.kind === "absent")
          throw new InstallError("source.missing", `Missing install source: ${action.source}`);
        if (action.kind === "seed") await this.set(action.target, source);
        else await this.owned(action.target, source);
        return;
      }
      case "mergeBlock":
      case "jsonArrayMerge": {
        const old = this.entries.get(action.target) ?? this.previous.get(action.target);
        if (old && this.skip(old, current)) return;
        const baseline =
          old && this.options.force && this.edited(old, current)
            ? text(old.preimage)
            : text(current);
        const prior = old?.merges.find((merge) => merge.blockId === action.blockId);
        const base =
          prior && !(old && this.options.force && this.edited(old, current))
            ? restoreMerge(baseline, prior)
            : baseline;
        const merged = applyMerge(base, action);
        const record = prior ? { ...merged, before: prior.before } : merged;
        const merges = [
          ...(old?.merges.filter((merge) => merge.blockId !== action.blockId) ?? []),
          record,
        ];
        const desired = fileImage(record.after, current.kind === "file" ? current.mode : 0o644);
        await this.set(action.target, desired);
        this.entries.set(action.target, {
          target: action.target,
          kind: "merge",
          fingerprint: fingerprint(desired),
          preimage: old?.preimage ?? current,
          merges,
        });
        return;
      }
      case "exclusiveTree":
        await this.tree(action);
        return;
      default:
        assertNever(action);
    }
  }

  async tree(action: Extract<Action, { kind: "exclusiveTree" }>): Promise<void> {
    for (const part of action.preserve) {
      if (
        !part ||
        isAbsolute(part) ||
        part.split("/").some((name) => !name || name === ".." || name === ".")
      ) {
        throw new InstallError("tree.preserve", "Preserved tree entries must be relative paths.");
      }
    }
    const source = await image(action.source);
    if (source.kind !== "directory" && source.kind !== "absent")
      throw new InstallError("tree.source", "Exclusive tree source must be a directory.");
    const current = await this.read(action.target),
      old = this.previous.get(action.target);
    if (old && this.skip(old, current)) return;
    if (current.kind !== "directory") {
      await this.set(action.target, { kind: "directory", mode: 0o755, children: {} });
      if (current.kind === "absent") this.directories.add(action.target);
    }
    this.entries.set(action.target, {
      target: action.target,
      kind: "directory",
      fingerprint: fingerprint({ kind: "directory", mode: 0o755, children: {} }),
      preimage: old?.preimage ?? current,
      merges: [],
    });
    const actual = current.kind === "directory" ? current.children : {};
    const expected = source.kind === "directory" ? source.children : {};
    for (const name of [...new Set([...Object.keys(actual), ...Object.keys(expected)])].sort()) {
      if (action.preserve.includes(name)) continue;
      const target = join(action.target, name),
        childSource = join(action.source, name);
      const nested = action.preserve
        .filter((path) => path.startsWith(name + "/"))
        .map((path) => path.slice(name.length + 1));
      if (nested.length) {
        await this.tree({ ...action, target, source: childSource, preserve: nested });
      } else if (Object.hasOwn(expected, name)) {
        await this.owned(target, { kind: "link", source: childSource });
      } else {
        const previous = this.previous.get(target);
        if (previous && this.skip(previous, await this.read(target))) continue;
        await this.set(target, absent);
      }
    }
  }

  result(): InstallPlan {
    return {
      actions: [...this.changes.values()],
      findings: this.findings,
      manifest: {
        version: 1,
        repo: this.options.repo,
        harness: this.options.harness,
        engineVersion: this.options.engineVersion,
        entries: [...this.entries.values()],
        createdDirectories: [...this.directories],
      },
    };
  }
}
