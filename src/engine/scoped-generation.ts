import { createHash } from "node:crypto";
import type { ContentHash, HarnessId, RenderedFile } from "../core/types.js";
import { readGeneration } from "../fs/index.js";
import { hasCode } from "../install/images.js";

/**
 * Files to publish when one harness is selected: the fresh render for that harness and for shared
 * files, and for every other harness the files it was last published with, so installing one
 * harness never changes what the other homes' links resolve to. A harness absent from the active
 * generation takes its fresh render.
 */
export async function scopedFiles(input: {
  readonly root: string;
  readonly files: readonly RenderedFile[];
  readonly others: readonly HarnessId[];
}): Promise<readonly RenderedFile[]> {
  let active: readonly RenderedFile[] = [];
  try {
    active = await readGeneration(input.root);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
  const owner = (file: RenderedFile) =>
    input.others.find((harness) => file.relPath.startsWith(`${harness}/`));
  const kept = active.filter((file) => owner(file) !== undefined);
  const keptHarnesses = new Set(kept.map(owner));
  return [...input.files.filter((file) => !keptHarnesses.has(owner(file))), ...kept];
}

/** A scoped publish is a different tree than the full render of the same snapshot. */
export function filesHash(files: readonly RenderedFile[]): ContentHash {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => (a.relPath < b.relPath ? -1 : 1)))
    hash.update(`${file.kind}\0${file.relPath}\0${file.mode}\0`).update(file.content).update("\0");
  return `sha256:${hash.digest("hex")}`;
}
