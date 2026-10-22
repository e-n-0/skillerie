import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import type {
  EntitySelection,
  EntitySettings,
  HarnessMap,
  JsonObject,
  LintSeverity,
  ResolvedHarnessConfig,
} from "../core/types.js";
import type { SourcePathInput } from "./sources.js";

type SelectionInput = Partial<EntitySelection>;
type HarnessInput = Partial<ResolvedHarnessConfig>;
type SeverityInput = { readonly severity?: LintSeverity };

/** Schema-validated author input, before defaults or path expansion. */
export interface ConfigInput {
  readonly version: 1;
  readonly dialect?: 1;
  readonly engine?: string;
  readonly starter?:
    | boolean
    | {
        readonly enabled?: boolean;
        readonly exclude?: readonly string[];
      };
  readonly harnesses?: HarnessMap<HarnessInput>;
  readonly paths?: Readonly<Record<string, string>>;
  readonly sources?: SourcePathInput;
  readonly skills?: EntityInput;
  readonly agents?: EntityInput;
  readonly rules?: EntityInput;
  readonly assets?: EntityInput;
  readonly shared?: { readonly agentsSkillsDir?: "dedupe" | "preserve" };
  readonly lint?: {
    readonly descriptionPrefix?: SeverityInput & { readonly value?: string };
    readonly structure?: SeverityInput;
    readonly questions?: SeverityInput & {
      readonly allowProse?: readonly string[];
    };
    readonly references?: SeverityInput;
  };
  readonly generated?: { readonly commit?: boolean };
  readonly hooks?: {
    readonly postInstall?: readonly (
      string | { readonly command: string; readonly fatal?: boolean }
    )[];
  };
}

export interface EntityInput extends SelectionInput {
  readonly harnesses?: HarnessMap<SelectionInput>;
}

const schema: object = JSON.parse(
  readFileSync(new URL("../../schema/skillerie.schema.json", import.meta.url), "utf8"),
);

export const validateConfig = new Ajv2020({
  allErrors: true,
  strict: true,
  allowUnionTypes: true,
}).compile<ConfigInput & JsonObject>(schema);

export function entitySettings(input: EntityInput = {}): EntitySettings {
  const selection = (value: SelectionInput): EntitySelection => ({
    enabled: value.enabled ?? [],
    disabled: value.disabled ?? [],
    overrides: value.overrides ?? {},
  });
  return {
    ...selection(input),
    harnesses: Object.fromEntries(
      Object.entries(input.harnesses ?? {}).map(([name, value]) => [name, selection(value)]),
    ),
  };
}
