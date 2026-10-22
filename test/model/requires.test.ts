import { expect, it } from "vitest";
import type { Requires } from "../../src/core/types.js";
import { evaluateRequires, type RequiresContext } from "../../src/model/index.js";

const context: RequiresContext = {
  env: { READY: "yes", EMPTY: "" },
  os: "linux",
  harness: "codex",
  availableBins: new Set(["node", "git"]),
};

it("permits an entity when requirements are omitted", () => {
  // Given
  const requires = undefined;
  // When
  const result = evaluateRequires(requires, context);
  // Then
  expect(result).toEqual({ satisfied: true, checks: [] });
});

it("records every successful check when all requirements hold", () => {
  // Given
  const requires: Requires = { bin: ["node", "git"], env: "READY", os: "linux", harness: "codex" };
  // When
  const result = evaluateRequires(requires, context);
  // Then
  expect(result.satisfied).toBe(true);
  expect(result.checks).toHaveLength(5);
  expect(result.checks.every((check) => check.satisfied)).toBe(true);
});

it.each<Requires>([
  { bin: ["node", "missing"] },
  { env: ["READY", "MISSING"] },
  { env: "EMPTY" },
  { os: ["linux", "darwin"] },
  { harness: ["codex", "omo"] },
])("requires every entry when a condition fails: %j", (requires) => {
  // Given: captured successful probes for the other conditions.
  // When
  const result = evaluateRequires(requires, context);
  // Then
  expect(result.satisfied).toBe(false);
  expect(result.checks.some((check) => !check.satisfied)).toBe(true);
});

it("uses captured binaries when ambient PATH would find another command", () => {
  // Given
  const captured = { ...context, availableBins: new Set<string>() };
  // When
  const result = evaluateRequires({ bin: "node" }, captured);
  // Then
  expect(result.satisfied).toBe(false);
});

it.each([true, false])("honors force=%s when the natural decision is opposite", (force) => {
  // Given
  const requires = { bin: force ? "missing" : "node" };
  // When
  const result = evaluateRequires(requires, { ...context, force });
  // Then
  expect(result.satisfied).toBe(force);
  expect(result.forced).toBe(force);
  expect(result.checks[0]?.satisfied).toBe(!force);
});

it("records names without values when an environment variable is required", () => {
  // Given
  const requires = { env: "READY" };
  // When
  const result = evaluateRequires(requires, context);
  // Then
  expect(result.checks).toEqual([{ kind: "env", name: "READY", satisfied: true }]);
});
