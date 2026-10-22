import type { QuestionModel } from "../../dialect/index.js";

export function renderQuestions(model: QuestionModel): string {
  const questions = model.questions.map(({ question, header, multiSelect, options }) => ({
    question,
    header,
    multiSelect,
    options,
  }));
  return `ask_user_question(${JSON.stringify({ questions, waitForAnswer: true })})`;
}
