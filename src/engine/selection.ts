import { createHash } from "node:crypto";
import type { HarnessId, InputSnapshot } from "../core/types.js";

/** Keep captured bytes intact when selection changes the render configuration. */
export function selectSnapshot(snapshot: InputSnapshot, harness: HarnessId): InputSnapshot {
  const { hash: _hash, ...input } = snapshot;
  const payload = {
    ...input,
    config: Object.freeze({
      ...input.config,
      harnesses: Object.freeze(
        Object.fromEntries(Object.entries(input.config.harnesses).filter(([id]) => id === harness)),
      ),
    }),
  };
  const canonical = JSON.stringify(payload, (_key, value: unknown): unknown => {
    if (value !== null && typeof value === "object" && !Array.isArray(value))
      return Object.fromEntries(
        Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
      );
    return value;
  });
  return Object.freeze({
    ...payload,
    hash: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
  });
}
