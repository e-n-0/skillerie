import { expectTypeOf, it } from "vitest";
import type { Adapter } from "../../src/core/types.js";

it("accepts an adapter when the declarative contract is implemented", () => {
  // Given: a synthetic adapter with no installation side effects.
  const fake = {
    id: "opencode",
    supportedRange: ">=1.0.0",
    capabilities: {
      toolMap: { Read: "read" },
      questionLimits: {
        maxHeaderLength: 12,
        maxOptions: 3,
        maxQuestions: 1,
        multiSelect: false,
      },
      permissionEnforcement: {
        toolAllowlist: true,
        readOnly: true,
        noShell: true,
      },
      nativeAgentReplacements: {},
      supportsCommands: true,
      supportsRules: true,
    },
    defaultPaths: () => ({
      home: "/home/alice/.config/opencode",
      configDir: "/home/alice/.config/opencode",
      skillsDir: "/home/alice/.config/opencode/skills",
      agentsDir: "/home/alice/.config/opencode/agents",
      rulesDir: "/home/alice/.config/opencode/rules",
      assetsDir: "/home/alice/.config/opencode/assets",
    }),
    render: () => Promise.resolve({ files: [], diagnostics: [], metadata: {} }),
    targets: () => [],
    check: () => Promise.resolve([]),
    doctor: () => Promise.resolve([]),
  } satisfies Adapter;

  // When: the compiler assigns the implementation through the shared interface.
  const adapter: Adapter = fake;

  // Then: the adapter remains consumable through the public contract.
  expectTypeOf(adapter).toMatchTypeOf<Adapter>();
});
