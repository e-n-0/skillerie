---
name: outline
description: Use when a change needs a concrete implementation plan.
argument-hint: "[goal]"
user-invocable: true
---

# Outline

Announce: "I will prepare a focused implementation plan."

## Step 1 - Understand the goal

Read the relevant sources with Read and identify the observable result.

## Step 2 - Choose the scope

<interaction>AskUserQuestion(question="Which scope should the plan cover?", header="Scope", options=[{label:"Focused", description:"Only the requested behavior"}, {label:"Complete", description:"The whole feature"}], multiSelect=false)</interaction>

Use the checklist in `${CLAUDE_PLUGIN_ROOT}/references/checklist.md`.
Continue with `/implement` after the plan is approved.

## Error Handling

Report missing inputs and stop before changing source files.
