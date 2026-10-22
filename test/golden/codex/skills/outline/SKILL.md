---
name: "outline"
description: "Use when a change needs a concrete implementation plan."
---

# Outline

Announce: "I will prepare a focused implementation plan."

## Step 1 - Understand the goal

Read the relevant sources with Read and identify the observable result.

## Step 2 - Choose the scope

Use request_user_input in Plan mode, or Default mode with default_mode_request_user_input enabled. In exec mode or when the tool is unavailable, ask the same question in plain text with numbered choices and wait for the answer.

request_user_input({
  "questions": [
    {
      "id": "question_1",
      "header": "Scope",
      "question": "Which scope should the plan cover?",
      "options": [
        {
          "label": "Focused",
          "description": "Only the requested behavior"
        },
        {
          "label": "Complete",
          "description": "The whole feature"
        }
      ]
    }
  ]
})

Use the checklist in `./references/checklist.md`.
Continue with `/implement` after the plan is approved.

## Error Handling

Report missing inputs and stop before changing source files.
