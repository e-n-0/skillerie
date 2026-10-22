import { afterEach, beforeEach, expect, it } from "vitest";
import { capDescription } from "../../src/model/schema.js";
import { agent, discover, fixture, skill } from "./helpers.js";

it("retains the limit when a description has exactly 1024 characters", () => {
  // Given
  const description = "a".repeat(1024);
  // When
  const result = capDescription(description);
  // Then
  expect(result).toHaveLength(1024);
});

it("ends at a sentence boundary when a useful sentence fits before the limit", () => {
  // Given
  const description = `${"a".repeat(700)}. ${"b".repeat(500)}`;
  // When
  const result = capDescription(description);
  // Then
  expect(result).toHaveLength(701);
  expect(result.at(-1)).toBe(".");
});

it("uses an ellipsis when a sentence boundary would leave too little context", () => {
  // Given
  const description = `a. ${"b".repeat(1100)}`;
  // When
  const result = capDescription(description);
  // Then
  expect(result).toHaveLength(1024);
  expect(result.endsWith("...")).toBe(true);
});

it("counts Unicode characters when a description contains surrogate pairs", () => {
  // Given
  const description = "\u{10400}".repeat(1100);
  // When
  const result = capDescription(description);
  // Then
  expect(Array.from(result)).toHaveLength(1024);
  expect(result.endsWith("...")).toBe(true);
});

let repo: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  repo = await fixture();
});
afterEach(async () => {
  await repo.cleanup();
});

it("caps skill and agent descriptions when discovery parses their frontmatter", async () => {
  // Given
  const long = "a".repeat(1100);
  await repo.put(
    "skills/example/SKILL.md",
    skill("example").replace("description: example", `description: ${long}`),
  );
  await repo.put(
    "agents/reviewer.md",
    agent("reviewer").replace("description: example", `description: ${long}`),
  );
  // When
  const model = await discover(repo.root);
  // Then
  expect(model.skills[0]?.frontmatter.description).toHaveLength(1024);
  expect(model.agents[0]?.frontmatter.description).toHaveLength(1024);
});
