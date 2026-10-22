---
name: security-best-practices
description: Use when the user explicitly requests security best-practice guidance, a security review or report, or secure-by-default coding help for Python, JavaScript/TypeScript, or Go. Do not use for general code review or debugging.
argument-hint: "[path or scope to review]"
user-invocable: true
---

# Security Best Practices

"I’ll identify the relevant stack, load its security guidance, and apply it to the requested work."

> Modified for generic use.

This skill provides stack-specific guidance for secure-by-default implementation, passive security review while editing, and requested security audits.

## Step 1: Identify the stack and scope

1. Identify every language and framework used in the requested scope. Inspect project manifests, framework configuration, source files, and deployment files with `Glob`, `Grep`, and `Read`.
2. For applications with both frontend and backend code, identify and assess both sides.
3. If the stack is not clear, gather repository evidence before drawing conclusions. State what is unknown rather than assuming a framework or deployment model.

## Step 2: Load the relevant guidance

1. Check `references/` for matching language and framework documents. Read every reference that applies to the scope; read both frontend and backend references for full-stack applications.
2. If no reference applies, use established platform practices. When an unfamiliar detail materially affects the recommendation, consult official documentation with `WebSearch` and verify against the project's actual versions and configuration.
3. Apply guidance as context, not as a substitute for examining the code or understanding the project's trust boundaries.

## Step 3: Apply the appropriate operating mode

### Secure-by-default implementation

- Follow the applicable requirements and prefer platform protections and maintained libraries over custom security mechanisms.
- Avoid introducing risky input-to-sink flows, including unsafe HTML or template rendering, unvalidated redirects, injection, unsafe file access, arbitrary outbound requests, and weak cryptography.
- Keep fixes minimal and compatible with the application's behavior. Explain material security tradeoffs.

### Passive review while editing

- Notice serious security issues in touched or closely related code, even when the task is not an audit.
- Raise critical, high-impact, or otherwise clear issues with concise evidence and a safe remediation. Do not turn unrelated observations into unsolicited broad audits.

### Requested audit or report

1. Inspect relevant entrypoints and deployment configuration, then follow untrusted data from its source to security-sensitive sinks.
2. Check whether protections exist in application code, framework middleware, configuration, or deployment infrastructure.
3. Report confirmed findings with evidence. If a protection may exist outside the inspected scope, label it as unverified rather than absent.
4. Prioritize findings by severity and impact. Include actionable fixes and practical mitigations.

## Step 4: Ground findings in evidence

For each finding, include:

- **Rule or category**
- **Severity:** Critical, High, Medium, or Low
- **Location:** file, function or route, and line numbers
- **Evidence:** the relevant code or configuration
- **Impact:** what can happen and under what trust assumptions
- **Fix:** the smallest safe correction
- **Mitigation:** additional defense in depth when a direct fix is not immediately feasible
- **Uncertainty:** what must be checked when the code does not establish the full runtime behavior

Do not claim exploitability without tracing attacker influence to a sensitive operation. Distinguish confirmed issues from hypotheses and deployment questions.

## Step 5: Write reports and handle fixes

- Write a requested report as Markdown in a docs directory (default `~/docs/<project>/`; configurable), using `security_best_practices_report.md` unless the user gives another destination.
- Start with a short executive summary, then group findings by severity. Give critical findings a one-sentence impact statement and include line numbers for code references.
- Summarize the result directly to the user and name the report location.
- If a report identifies findings that need changes, let the user review the report before beginning fixes. Address one finding at a time and run the relevant tests or checks.

<interaction>AskUserQuestion(questions=[{header:"Fixes",question:"Would you like me to start fixing one finding at a time?",options:[{label:"Start fixes",description:"Begin with the highest-priority finding."},{label:"Review only",description:"Leave the findings in the report for now."}]}])</interaction>

If a critical issue is discovered during ordinary work, explain its impact and ask whether to fix it before making a separate security change.

## General guidance

- Never request, expose, log, or commit secrets. Redact secret-bearing values in examples and findings.
- Do not weaken authentication, authorization, input validation, CSRF defenses, TLS verification, cookie protections, or output encoding to make a failing flow appear to work.
- Treat data crossing trust boundaries as untrusted unless evidence shows otherwise. Confirm the data source, sink, validation, and applicable controls.
- Avoid reporting missing TLS solely from application source when TLS may terminate at an edge proxy. Verify the deployment path first.
- Apply `Secure` cookie attributes only where HTTPS is in use; account for local HTTP development separately.
- Recommend HSTS only when the deployment owner understands its scope and operational consequences.
- Do not automatically upgrade dependencies or make broad security changes outside the requested scope. Report material upgrade needs and explain their impact.

## Error Handling

- If the stack or deployment context is incomplete, state the evidence collected and the remaining uncertainty.
- If no applicable reference exists, say so and use current official guidance where necessary.
- If a suspected issue cannot be confirmed, label it as a question to verify instead of presenting it as a confirmed vulnerability.
- If the requested report destination is unavailable, explain the issue and use a configurable docs directory only when that does not conflict with the user's instructions.
