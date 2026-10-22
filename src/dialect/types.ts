import type { Capabilities, Diagnostic, HarnessId, JsonValue } from "../core/types.js";

/** Adapter policies are data; the shared converter does not select harness schemas. */
export interface DialectOptions {
  readonly harness: HarnessId;
  readonly capabilities: Capabilities;
  readonly file?: string;
  readonly childAgent?: boolean;
  readonly renderQuestions?: (model: QuestionModel, options: DialectOptions) => string;
  readonly mcpTemplate?: (reference: McpReference) => string;
  readonly arguments?:
    { readonly mode: "keep" } | { readonly mode: "replace"; readonly text: string };
}

export interface PluginRootOptions extends DialectOptions {
  /** Discovered source-relative skill directory, not its installation directory. */
  readonly skillDir: string;
}

export interface DialectResult {
  readonly text: string;
  readonly diagnostics: readonly Diagnostic[];
}

export type StructuredValue =
  | { readonly kind: "literal"; readonly value: JsonValue }
  | { readonly kind: "expression"; readonly text: string };

export interface StructuredCall {
  readonly name: "Task" | "Agent" | "Skill" | "AskUserQuestion";
  readonly arguments: Readonly<Record<string, StructuredValue>>;
  /** UTF-16 offsets, with an exclusive end. */
  readonly start: number;
  readonly end: number;
}

export interface StructuredCallsResult {
  readonly calls: readonly StructuredCall[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface QuestionOption {
  readonly label: string;
  readonly description: string;
}

export interface NormalizedQuestion {
  readonly header: string;
  readonly question: string;
  readonly options: readonly QuestionOption[];
  readonly multiSelect: boolean;
  /** Source expression to populate at runtime, never a fabricated choice. */
  readonly dynamicOptions?: string;
}

export interface QuestionModel {
  readonly questions: readonly NormalizedQuestion[];
}

export interface QuestionsResult {
  readonly model?: QuestionModel;
  readonly diagnostics: readonly Diagnostic[];
}

export interface McpReference {
  readonly server: string;
  readonly tool: string;
  readonly arguments?: Readonly<Record<string, StructuredValue>>;
}
