import { expect, it } from "vitest";
import { renderSkill, skillInterface } from "../../../src/adapters/codex/skills.js";
import { parseFrontmatter } from "../../../src/model/index.js";
import { interfaceYaml, skill } from "./helpers.js";

it("reduces skill metadata when unsupported authoring fields are present", async () => {
  // Given: authored metadata with quotes and tool hints.
  const input = skill({
    description: 'Use when a "quoted" value matters.',
    "allowed-tools": ["Read"],
    "user-invocable": true,
  });
  // When: it is rendered for Codex.
  const result = await renderSkill(input, "/home/alice/config");
  const file = result.files.find((entry) => entry.relPath.endsWith("/SKILL.md"));
  if (!file) throw new TypeError("Missing skill");
  // Then: only the two quoted native fields survive.
  const output = file.content.toString();
  expect(parseFrontmatter(output, "SKILL.md").frontmatter).toEqual({
    name: input.name,
    description: input.frontmatter.description,
  });
  expect(
    output
      .split("\n")
      .slice(1, 3)
      .every((line) => /^\w+: "/.test(line)),
  ).toBe(true);
});

it("renders interface metadata when a skill is manual-only", () => {
  // Given: a skill with an explicit invocation policy.
  const input = skill({ "disable-model-invocation": true });
  // When: native interface YAML is generated.
  const result = interfaceYaml(skillInterface(input));
  // Then: interface fields and the policy are machine-consumed values.
  expect(result).toEqual({
    interface: {
      display_name: "Test Skill",
      short_description: "Use when you need to inspect a change.",
      default_prompt: "Use $test-skill to inspect a change. Then verify it",
    },
    policy: { allow_implicit_invocation: false },
  });
});

it("omits manual policy when implicit invocation remains enabled", () => {
  // Given: a skill using default invocation policy.
  const input = skill();
  // When: native interface YAML is generated.
  const result = interfaceYaml(skillInterface(input));
  // Then: the adapter does not override the harness default.
  expect(result.policy).toBeUndefined();
});

it("caps interface fields when the description exceeds native lengths", () => {
  // Given: a long first sentence.
  const input = skill({ description: `Use when ${"details ".repeat(30)}matter.` });
  // When: interface metadata is generated.
  const result = interfaceYaml(skillInterface(input));
  // Then: the complete default prompt and short description fit native limits.
  expect(result.interface.short_description).toHaveLength(80);
  expect(result.interface.default_prompt).toHaveLength(120);
});
