import type { Adapter, Diagnostic, RenderResult } from "../../core/types.js";
import { capabilities, defaultPaths } from "./capabilities.js";
import { check } from "./check.js";
import { renderConfig, renderMcp, templateObject } from "./configuration.js";
import {
  file,
  renderAgents,
  renderInstructions,
  renderPayloads,
  renderSkills,
} from "./documents.js";
import { targets } from "./targets.js";

export const adapter: Adapter = {
  id: "omo",
  supportedRange: ">=5.0.0 <6.0.0",
  capabilities,
  defaultPaths,
  async render(ctx): Promise<RenderResult> {
    const diagnostics: Diagnostic[] = [];
    const skills = await renderSkills(ctx, diagnostics);
    const agents = renderAgents(ctx, diagnostics);
    const files = [
      file("omo.jsonc", renderConfig(ctx, agents, diagnostics)),
      file("mcp.json", renderMcp(ctx, diagnostics)),
      file("AGENTS.md", renderInstructions(ctx, diagnostics)),
      ...skills,
      ...(await renderPayloads(ctx, diagnostics)),
    ];
    if (ctx.model.templates.omo?.files.some((entry) => entry.relPath === "models.json")) {
      files.push(
        file(
          "models.json",
          JSON.stringify(templateObject(ctx, "models.json", diagnostics), null, 2) + "\n",
        ),
      );
    }
    return {
      files: files.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0)),
      diagnostics,
      metadata: {
        agents: Object.keys(agents).sort(),
        skills: ctx.model.harnesses.omo?.skills.map((skill) => skill.name).sort() ?? [],
      },
    };
  },
  targets,
  check,
};
