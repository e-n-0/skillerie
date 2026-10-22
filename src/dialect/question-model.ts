import type { Diagnostic } from "../core/types.js";
import type {
  DialectOptions,
  NormalizedQuestion,
  QuestionOption,
  QuestionsResult,
  StructuredCall,
} from "./types.js";
import { parseValue, type Value } from "./syntax.js";

export function questionDiagnostic(
  options: DialectOptions,
  jsonPath: string,
  message: string,
): Diagnostic {
  return {
    severity: "error",
    code: "dialect.question",
    message,
    jsonPath,
    ...(options.file === undefined ? {} : { file: options.file }),
  };
}

function stringValue(value: Value | undefined): string | undefined {
  return value?.kind === "literal" && typeof value.value === "string" ? value.value : undefined;
}

function optionValue(value: Value): QuestionOption | undefined {
  if (value.kind === "literal" && typeof value.value === "string") {
    return { label: value.value, description: "" };
  }
  if (value.kind === "array" && value.items.length === 2) {
    const label = stringValue(value.items[0]);
    const description = stringValue(value.items[1]);
    if (label !== undefined && description !== undefined) return { label, description };
  }
  if (value.kind === "object") {
    const label = stringValue(value.fields["label"]);
    const description = stringValue(value.fields["description"]);
    if (
      Object.keys(value.fields).length === 2 &&
      label !== undefined &&
      description !== undefined
    ) {
      return { label, description };
    }
  }
  return undefined;
}

/** Parse flat and array forms into one schema before adapter-specific rendering. */
export function normalizeQuestions(call: StructuredCall, options: DialectOptions): QuestionsResult {
  const diagnostics: Diagnostic[] = [];
  const fields: Record<string, Value> = {};
  for (const [key, item] of Object.entries(call.arguments)) {
    const value = parseValue(item.kind === "literal" ? JSON.stringify(item.value) : item.text);
    if (value !== undefined) Object.defineProperty(fields, key, { value, enumerable: true });
  }
  const fail = (path: string, message: string): void => {
    diagnostics.push(questionDiagnostic(options, path, message));
  };
  const allowed = ["questions", "header", "question", "options", "multiSelect"];
  for (const key of Object.keys(fields)) {
    if (!allowed.includes(key))
      fail(`/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, `Unknown question field: ${key}.`);
  }
  const array = fields["questions"];
  let entries: readonly Value[];
  if (array === undefined) {
    entries = [{ kind: "object", fields, text: "" }];
  } else if (array.kind === "array") {
    entries = array.items;
    if (Object.keys(fields).some((key) => key !== "questions")) {
      fail("/questions", "Use either a questions array or flat question fields.");
    }
  } else {
    fail("/questions", "Questions must be an array.");
    entries = [];
  }
  if (entries.length === 0) fail("/questions", "At least one question is required.");
  const questions: NormalizedQuestion[] = [];
  for (const [index, entry] of entries.entries()) {
    const path = `/questions/${index}`;
    if (entry.kind !== "object") {
      fail(path, "A question must be an object.");
      continue;
    }
    for (const key of Object.keys(entry.fields)) {
      if (!allowed.slice(1).includes(key)) {
        fail(
          `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`,
          `Unknown question field: ${key}.`,
        );
      }
    }
    const header = stringValue(entry.fields["header"]);
    const question = stringValue(entry.fields["question"]);
    if (header === undefined || header.trim() === "")
      fail(`${path}/header`, "A nonempty header is required.");
    if (question === undefined || question.trim() === "")
      fail(`${path}/question`, "A nonempty question is required.");
    const multiple = entry.fields["multiSelect"];
    let multiSelect = false;
    if (multiple !== undefined) {
      if (multiple.kind === "literal" && typeof multiple.value === "boolean") {
        multiSelect = multiple.value;
      } else {
        fail(`${path}/multiSelect`, "multiSelect must be a literal boolean.");
      }
    }
    const choices = entry.fields["options"];
    const parsedOptions: QuestionOption[] = [];
    let dynamicOptions: string | undefined;
    if (choices?.kind === "expression") {
      dynamicOptions = choices.text;
    } else if (choices !== undefined) {
      if (choices.kind !== "array") {
        fail(`${path}/options`, "Options must be an array or a runtime expression.");
      } else if (
        choices.items.length > 0 &&
        choices.items.every((choice) => choice.kind === "expression")
      ) {
        dynamicOptions = choices.text;
      } else {
        for (const [choiceIndex, choice] of choices.items.entries()) {
          const option = optionValue(choice);
          if (option === undefined || option.label.trim() === "") {
            fail(
              `${path}/options/${choiceIndex}`,
              "Use a label/description object, a string, or a quoted pair.",
            );
          } else {
            parsedOptions.push(option);
          }
        }
      }
    }
    if (header !== undefined && question !== undefined) {
      questions.push({
        header,
        question,
        options: parsedOptions,
        multiSelect,
        ...(dynamicOptions === undefined ? {} : { dynamicOptions }),
      });
    }
  }
  return diagnostics.length === 0 ? { model: { questions }, diagnostics } : { diagnostics };
}
