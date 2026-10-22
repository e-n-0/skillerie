import type { DialectOptions, QuestionModel } from "../../dialect/index.js";

export function renderQuestions(model: QuestionModel, options: DialectOptions): string {
  const payload = JSON.stringify({
    questions: model.questions.map(({ header, question, options: choices, multiSelect }) => ({
      header,
      question,
      options: choices,
      multiSelect,
    })),
  });
  const dynamic = model.questions.some((question) => question.dynamicOptions !== undefined);
  if (options.childAgent)
    return `Return this clarification request to the parent agent: ${payload}`;
  if (dynamic)
    return `Populate the runtime choices described below, then call ask_user_question with ${payload}`;
  return `ask_user_question(${payload})`;
}
