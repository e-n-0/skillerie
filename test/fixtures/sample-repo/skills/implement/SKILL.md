---
name: implement
description: Use when an approved plan is ready to implement.
argument-hint: "[plan]"
user-invocable: true
allowed-tools: [Read, Write, Edit, Bash]
---

# Implement

Announce: "I will implement the approved plan."

## Step 1 - Make the change

Read the plan and change only the affected sources. Use `$ARGUMENTS` as the
plan identifier. Run `/verify` once the requested behavior works.

## Error Handling

Report a blocked dependency with the failing command and its exit status.
