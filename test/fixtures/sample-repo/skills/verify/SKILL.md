---
name: verify
description: Use when a completed change needs focused verification.
argument-hint: "[changed paths]"
user-invocable: true
---

# Verify

Announce: "I will run the checks for the changed behavior."

## Step 1 - Verify the result

Run the relevant tests and exercise the observable behavior. Record each
command and its outcome.

## Error Handling

Distinguish failures caused by the change from existing failures.
