import type { QuestionModel } from "../../dialect/index.js";

/** The shared converter has already validated and limited the question model. */
export function renderQuestions(model: QuestionModel): string {
  return `question(${JSON.stringify({
    questions: model.questions.map((item) => ({
      header: item.header,
      question: item.question,
      options: item.options,
      multiple: item.multiSelect,
    })),
  })})`;
}
