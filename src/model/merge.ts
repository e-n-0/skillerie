import type {
  Agent,
  Asset,
  Entity,
  EntityOverride,
  EntitySettings,
  HarnessId,
  HarnessMap,
  HarnessSources,
  ResolvedConfig,
  Rule,
  Skill,
} from "../core/types.js";
import { authoredRule } from "./entities.js";
import { harnessIds } from "./schema.js";

function overrides(settings: EntitySettings, name: string, harness?: HarnessId): EntityOverride {
  return {
    ...settings.overrides[name],
    ...(harness ? settings.harnesses[harness]?.overrides[name] : {}),
  };
}

function selected(entity: Entity, settings: EntitySettings, harness: HarnessId): boolean {
  const local = settings.harnesses[harness];
  if (entity.harness && entity.harness !== harness) return false;
  if (settings.disabled.includes(entity.name) || local?.disabled.includes(entity.name))
    return false;
  const enabled = local?.enabled.length ? local.enabled : settings.enabled;
  return (
    overrides(settings, entity.name, harness).enabled ??
    (enabled.length === 0 || enabled.includes(entity.name))
  );
}

function skillFields(skill: Skill, fields: EntityOverride): Skill {
  const { enabled: _enabled, paths: _paths, ...frontmatter } = fields;
  const merged = { ...frontmatter, ...skill.frontmatter };
  return {
    ...skill,
    frontmatter: merged,
    ...(merged.requires ? { requires: merged.requires } : {}),
  };
}

function agentFields(agent: Agent, fields: EntityOverride): Agent {
  const { enabled: _enabled, paths: _paths, ...frontmatter } = fields;
  const merged = { ...frontmatter, ...agent.frontmatter };
  return {
    ...agent,
    frontmatter: merged,
    ...(merged.requires ? { requires: merged.requires } : {}),
  };
}

function ruleFields(rule: Rule, fields: EntityOverride): Rule {
  const authored = authoredRule(rule);
  const requires = authored.requires ?? fields.requires;
  return {
    ...rule,
    paths: authored.paths ?? fields.paths ?? [],
    ...(requires ? { requires } : {}),
  };
}

interface SelectionInput<T extends Entity> {
  readonly entities: readonly T[];
  readonly settings: EntitySettings;
  readonly config: ResolvedConfig;
  readonly apply: (entity: T, fields: EntityOverride) => T;
}

function resolveSelection<T extends Entity>(
  input: SelectionInput<T>,
): {
  readonly entities: readonly T[];
  readonly harnesses: HarnessMap<readonly T[]>;
} {
  const harnesses: Partial<Record<HarnessId, T[]>> = {};
  for (const harness of harnessIds) {
    if (input.config.harnesses[harness]?.enabled) harnesses[harness] = [];
  }
  const entities = input.entities.map((entity) => {
    const applicable = harnessIds.filter(
      (harness) =>
        input.config.harnesses[harness]?.enabled && selected(entity, input.settings, harness),
    );
    for (const harness of applicable)
      harnesses[harness]?.push({
        ...input.apply(entity, overrides(input.settings, entity.name, harness)),
        harnesses: applicable,
      });
    return {
      ...input.apply(entity, overrides(input.settings, entity.name)),
      harnesses: applicable,
    };
  });
  return { entities, harnesses };
}

export function resolveEntities(
  inventory: {
    readonly skills: readonly Skill[];
    readonly agents: readonly Agent[];
    readonly rules: readonly Rule[];
    readonly assets: readonly Asset[];
  },
  config: ResolvedConfig,
): {
  readonly skills: readonly Skill[];
  readonly agents: readonly Agent[];
  readonly rules: readonly Rule[];
  readonly assets: readonly Asset[];
  readonly harnesses: HarnessMap<HarnessSources>;
} {
  const skills = resolveSelection({
    entities: inventory.skills,
    settings: config.skills,
    config,
    apply: skillFields,
  });
  const agents = resolveSelection({
    entities: inventory.agents,
    settings: config.agents,
    config,
    apply: agentFields,
  });
  const rules = resolveSelection({
    entities: inventory.rules,
    settings: config.rules,
    config,
    apply: ruleFields,
  });
  const assets = resolveSelection({
    entities: inventory.assets,
    settings: config.assets,
    config,
    apply: (entity, fields) => ({
      ...entity,
      ...(fields.requires ? { requires: fields.requires } : {}),
    }),
  });
  const harnesses: Partial<Record<HarnessId, HarnessSources>> = {};
  for (const harness of harnessIds) {
    if (config.harnesses[harness]?.enabled)
      harnesses[harness] = {
        skills: skills.harnesses[harness] ?? [],
        agents: agents.harnesses[harness] ?? [],
        rules: rules.harnesses[harness] ?? [],
        assets: assets.harnesses[harness] ?? [],
      };
  }
  return {
    skills: skills.entities,
    agents: agents.entities,
    rules: rules.entities,
    assets: assets.entities,
    harnesses,
  };
}
