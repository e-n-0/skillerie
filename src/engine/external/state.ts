import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ExternalRevision,
  InputSnapshot,
  RenderedFile,
  ResolvedConfig,
} from "../../core/types.js";
import { readManifest } from "../../install/storage.js";
import { parseExternalRevisions } from "../../model/external-state.js";

const STATE_FILE = ".skillerie-external.json";

/** Keep revision metadata in the same atomic generation as its rendered files. */
export function externalStateFiles(snapshot: InputSnapshot): readonly RenderedFile[] {
  return snapshot.external?.length
    ? [
        {
          kind: "file",
          relPath: STATE_FILE,
          content: JSON.stringify(snapshot.external) + "\n",
          mode: 0o644,
        },
      ]
    : [];
}

export async function installedExternals(
  config: ResolvedConfig,
): Promise<readonly ExternalRevision[]> {
  if (!config.skills.external?.length) return [];
  try {
    const value: unknown = JSON.parse(
      await readFile(join(config.paths.cache, "current", STATE_FILE), "utf8"),
    );
    return parseExternalRevisions(value);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  for (const harness of Object.values(config.harnesses)) {
    try {
      const manifest = await readManifest(harness.path);
      if (manifest?.repo.path === config.paths.repo && manifest.external?.length)
        return manifest.external;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOTDIR")) throw error;
    }
  }
  return [];
}
