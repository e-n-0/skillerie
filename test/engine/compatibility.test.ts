import { expect, it } from "vitest";
import { checkEngineVersion } from "../../src/engine/compatibility.js";

it.each([
  ["^1.2.0", "1.9.0"],
  ["^0.2.0", "0.2.9"],
  ["^0.0.3", "0.0.3"],
  ["~1.2", "1.2.8"],
  [">=1.0.0 <2.0.0", "1.7.1"],
  ["1.x", "1.4.8"],
  ["*", "3.0.0"],
  ["1.2.0 - 2.0.0", "2.0.0"],
  ["1.0.0 || 2.0.0", "2.0.0"],
  ["1.2.3+build", "1.2.3"],
  [">=1.2.3-beta.1 <2.0.0", "1.2.3-beta.2"],
])("accepts the engine pin %s when running %s", (pin, current) => {
  // Given: a compatible version range.
  const file = "skillerie.yaml";
  // When: the engine checks its version.
  const diagnostics = checkEngineVersion(pin, current, file);
  // Then: no incompatibility is reported.
  expect(diagnostics).toEqual([]);
});

it.each([
  ["^1.2.0", "2.0.0"],
  ["^0.2.0", "0.3.0"],
  ["^0.0.3", "0.0.4"],
  ["~1.2.0", "1.3.0"],
  ["1.2.x", "1.3.0"],
  [">1.2", "1.2.9"],
  ["<1.2", "1.2.0"],
  ["*", "1.0.0-beta"],
])("rejects the engine pin %s when running %s", (pin, current) => {
  // Given: a version outside the declared range.
  const file = "skillerie.yaml";
  // When: the engine checks its version.
  const diagnostics = checkEngineVersion(pin, current, file);
  // Then: a precise engine error is returned.
  expect(diagnostics).toEqual([
    expect.objectContaining({ code: "engine.incompatible", file, jsonPath: "/engine" }),
  ]);
});

it.each(["not-a-version", "1.x.3", ">=01.0.0", "1.0.0-01"])(
  "reports an invalid engine range when configured as %s",
  (pin) => {
    // Given: a malformed user-authored range.
    const current = "1.0.0";
    // When: compatibility is checked.
    const diagnostics = checkEngineVersion(pin, current, "skillerie.yaml");
    // Then: malformed syntax is distinct from incompatibility.
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "engine.range", jsonPath: "/engine" }),
    ]);
  },
);
