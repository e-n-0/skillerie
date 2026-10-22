import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  ContentHash,
  EntityRequiresResult,
  InputSnapshot,
  ResolvedConfig,
  SourceModel,
} from "../core/types.js";
import { capturedFiles, relativePath } from "./files.js";

function hash(bytes: string | Buffer): ContentHash {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Snapshot values must be JSON-compatible.");
  return serialized;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}

/** The four arguments are the independently versioned parts of the snapshot contract. */
export async function buildSnapshot(
  config: ResolvedConfig,
  model: SourceModel,
  requires: readonly EntityRequiresResult[],
  engineVersion: string,
): Promise<InputSnapshot> {
  const sourceHashes: Record<string, ContentHash> = {};
  const captured = capturedFiles(model);
  if (captured) {
    for (const [path, file] of captured) sourceHashes[path] = hash(file.content);
  } else {
    // Also accept programmatically constructed inventories without rediscovery.
    const paths = new Set([
      ...model.skills.flatMap((skill) => [
        skill.file,
        ...skill.supportFiles.map((file) => file.sourcePath),
      ]),
      ...model.agents.map((agent) => agent.file),
      ...model.rules.map((rule) => rule.file),
      ...Object.values(model.templates).flatMap((templates) =>
        templates.files.map((file) => file.file),
      ),
      ...model.seeds.map((seed) => seed.sourcePath),
      ...model.bin.map((file) => file.sourcePath),
      ...(model.instructions ? [model.instructions.file] : []),
      ...(model.mcp ? [model.mcp.file] : []),
      ...model.assets.filter((asset) => asset.kind === "file").map((asset) => asset.sourcePath),
    ]);
    for (const path of [...paths].sort())
      sourceHashes[relativePath(model.repoDir, path)] = hash(await readFile(path));
  }
  const sortedRequires = [...requires].sort((left, right) => {
    const a = `${left.entityKind}\0${left.name}\0${left.harness}`;
    const b = `${right.entityKind}\0${right.name}\0${right.harness}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const payload = structuredClone({
    config,
    ...(model.external?.length ? { external: model.external } : {}),
    sourceHashes,
    requires: sortedRequires,
    engineVersion,
  });
  return freeze({ ...payload, hash: hash(canonical(payload)) });
}
