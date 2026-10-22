import type { InputSnapshot } from "../core/types.js";

/** Generation paths use the snapshot hash and are owned exclusively by the engine. */
export interface Generation {
  readonly hash: InputSnapshot["hash"];
  readonly dir: string;
}

/** Differences compare bytes, entry kind, symlink target, and executable bits. */
export interface TreeDifference {
  readonly relPath: string;
  readonly reason: "missing" | "extra" | "content" | "kind" | "symlink" | "mode";
}
