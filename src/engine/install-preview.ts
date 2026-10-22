import { dirname, join, relative } from "node:path";
import type { Action, RenderedFile } from "../core/types.js";
import { absent, hasCode, safeAncestors, text, fileImage, fingerprint } from "../install/images.js";
import { recover, transact } from "../install/journal.js";
import { releaseEntry, manifestStep } from "../install/lifecycle.js";
import { locked } from "../install/lock.js";
import { applyMerge, restoreMerge } from "../install/merges.js";
import { prepare } from "../install/plan.js";
import { Planner } from "../install/planner.js";
import { statePath } from "../install/storage.js";
import { assertNever, InstallError } from "../install/types.js";
import type {
  Image,
  InstallOptions,
  InstallPlan,
  Manifest,
  MergeRecord,
} from "../install/types.js";

/** Rendered sources stay in memory: even the first dry run needs no staging directory. */
class PreviewPlanner extends Planner {
  readonly sources = new Map<string, Image>();
  readonly merged = new Set<string>();

  constructor(
    options: InstallOptions,
    manifest: Manifest | undefined,
    input: { readonly root: string; readonly files: readonly RenderedFile[] },
  ) {
    super(options, manifest);
    for (const file of input.files) {
      let path = join(input.root, file.relPath);
      let value: Image;
      switch (file.kind) {
        case "file":
          value = {
            kind: "file",
            data: Buffer.from(file.content).toString("base64"),
            mode: file.mode,
          };
          break;
        case "symlink":
          value = { kind: "link", source: file.content };
          break;
        default:
          assertNever(file);
      }
      this.sources.set(path, value);
      while (path !== input.root) {
        const parent = dirname(path);
        const previous = this.sources.get(parent);
        const children = previous?.kind === "directory" ? previous.children : {};
        value = {
          kind: "directory",
          mode: 0o755,
          children: { ...children, [relative(parent, path)]: value },
        };
        this.sources.set(parent, value);
        path = parent;
      }
    }
  }

  override async action(action: Action): Promise<void> {
    switch (action.kind) {
      case "link":
      case "copy":
      case "seed": {
        const source = this.sources.get(action.source);
        if (!source)
          throw new InstallError("source.missing", `Missing rendered source: ${action.source}`);
        if (action.kind === "seed") {
          if ((await this.read(action.target)).kind === "absent")
            await this.set(action.target, source);
        } else {
          await this.owned(
            action.target,
            action.kind === "link" ? { kind: "link", source: action.source } : source,
          );
        }
        return;
      }
      case "exclusiveTree":
        await this.tree(action);
        return;
      case "mergeBlock":
      case "jsonArrayMerge":
        await this.mergeTarget(action.target);
        return;
      default:
        assertNever(action);
    }
  }

  /** Restore sibling blocks together, then rebuild once; never merge inside a sibling's markers. */
  async mergeTarget(target: string): Promise<void> {
    if (this.merged.has(target)) return;
    this.merged.add(target);
    const current = await this.read(target);
    const old = this.previous.get(target);
    if (old && this.skip(old, current)) return;
    let content =
      old && this.options.force && this.edited(old, current) ? text(old.preimage) : text(current);
    if (old && !(this.options.force && this.edited(old, current)))
      for (const record of [...old.merges].reverse()) content = restoreMerge(content, record);
    const merges: MergeRecord[] = [];
    for (const action of this.options.actions) {
      if (action.target !== target) continue;
      switch (action.kind) {
        case "mergeBlock":
        case "jsonArrayMerge": {
          const record = applyMerge(content, action);
          merges.push(record);
          content = record.after;
          break;
        }
        case "link":
        case "copy":
        case "seed":
        case "exclusiveTree":
          break;
        default:
          assertNever(action);
      }
    }
    const desired = fileImage(content, current.kind === "file" ? current.mode : 0o644);
    await this.set(target, desired);
    this.entries.set(target, {
      target,
      kind: "merge",
      fingerprint: fingerprint(desired),
      preimage: old?.preimage ?? current,
      merges,
    });
  }

  override async tree(action: Extract<Action, { kind: "exclusiveTree" }>): Promise<void> {
    const source = this.sources.get(action.source);
    if (source && source.kind !== "directory")
      throw new InstallError("tree.source", "Exclusive tree source must be a directory.");
    const current = await this.read(action.target);
    const old = this.previous.get(action.target);
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
    const expected = source?.kind === "directory" ? source.children : {};
    for (const name of [...new Set([...Object.keys(actual), ...Object.keys(expected)])].sort()) {
      if (action.preserve.includes(name)) continue;
      const target = join(action.target, name);
      const nested = action.preserve
        .filter((path) => path.startsWith(name + "/"))
        .map((path) => path.slice(name.length + 1));
      if (nested.length) {
        await this.tree({
          ...action,
          target,
          source: join(action.source, name),
          preserve: nested,
        });
      } else if (Object.hasOwn(expected, name)) {
        await this.owned(target, { kind: "link", source: join(action.source, name) });
      } else {
        const previous = this.previous.get(target);
        if (previous && this.skip(previous, await this.read(target))) continue;
        await this.set(target, absent);
      }
    }
  }
}

async function buildPreview(
  options: InstallOptions,
  input: { readonly root: string; readonly files: readonly RenderedFile[] },
): Promise<PreviewPlanner> {
  const base = await prepare(options);
  const planner = new PreviewPlanner(options, base.manifest, input);
  for (const action of options.actions) {
    await safeAncestors(action.target, options.home ?? options.harnessHome);
    await planner.action(action);
  }
  for (const entry of [...planner.previous.values()].reverse()) {
    if (!planner.entries.has(entry.target)) await releaseEntry(planner, entry);
  }
  return planner;
}

export async function previewInstall(
  options: InstallOptions,
  input: { readonly root: string; readonly files: readonly RenderedFile[] },
): Promise<InstallPlan> {
  return (await buildPreview(options, input)).result();
}

export async function installRendered(
  options: InstallOptions,
  input: { readonly root: string; readonly files: readonly RenderedFile[] },
): Promise<InstallPlan> {
  return locked(options.harnessHome, async (created) => {
    await recover(options);
    const planner = await buildPreview(options, input);
    for (const directory of created) planner.directories.add(directory);
    const { image } = await import("../install/images.js");
    const metadata = manifestStep(
      planner,
      await image(statePath(options.harnessHome, "manifest.json")),
    );
    await transact(options, [...planner.changes.values(), ...(metadata ? [metadata] : [])]);
    return planner.result();
  });
}

export async function generationDrift(input: {
  readonly root: string;
  readonly files: readonly RenderedFile[];
}) {
  const { diffTree } = await import("../fs/index.js");
  try {
    return await diffTree(input.files, input.root);
  } catch (error) {
    if (hasCode(error, "ENOENT"))
      return input.files.map((file) => ({ relPath: file.relPath, reason: "missing" as const }));
    throw error;
  }
}
