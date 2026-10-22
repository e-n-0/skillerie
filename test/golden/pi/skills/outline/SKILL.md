---
name: "outline"
description: "Use when a change needs a concrete implementation plan."
---

# Outline

Announce: "I will prepare a focused implementation plan."

## Step 1 - Understand the goal

Read the relevant sources with Read and identify the observable result.

## Step 2 - Choose the scope

ask_user_question({"questions":[{"header":"Scope","question":"Which scope should the plan cover?","options":[{"label":"Focused","description":"Only the requested behavior"},{"label":"Complete","description":"The whole feature"}],"multiSelect":false}]})

Use the checklist in `./references/checklist.md`.
Continue with `/skill:implement` after the plan is approved.

## Error Handling

Report missing inputs and stop before changing source files.
