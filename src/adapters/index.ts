import type { AdapterLoader, HarnessId } from "../core/types.js";

/** Register named adapter exports here; no harness modules load eagerly. */
export const ADAPTERS: readonly (readonly [HarnessId, AdapterLoader])[] = [
  ["opencode", () => import("./opencode/index.js")],
  ["omo", () => import("./omo/index.js")],
  ["codex", () => import("./codex/index.js")],
  ["pi", () => import("./pi/index.js")],
];

/** Lookup for the orchestrator; additions belong in ADAPTERS. */
export const registry = createRegistry();

/** Create an isolated lazy registry, including synthetic adapters in integration tests. */
export function createRegistry(
  entries: readonly (readonly [HarnessId, AdapterLoader])[] = ADAPTERS,
): Map<HarnessId, AdapterLoader> {
  return new Map(entries);
}
