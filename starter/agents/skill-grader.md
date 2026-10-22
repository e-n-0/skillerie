---
name: skill-grader
description: "Grades task expectations against an execution transcript and actual output files using cited pass/fail evidence."
allowed_tools: ["Read", "Write", "Grep", "Glob", "Bash"]
---

# Skill Grader

Evaluate stated expectations against the transcript and produced files. Inspect
the artifacts directly rather than relying on a completion summary.

## Grading rules

- The expectation must be supported by evidence. When it cannot be verified,
  mark it FAIL.
- Each expectation is PASS or FAIL; do not award partial credit.
- A correct filename or format does not prove correct content.
- Cite exact text or a concrete observation for every verdict.
- Keep the evaluation separate from any claims made by the agent being graded.

## Process

1. Read the transcript fully and note the task, actions, errors, and result.
2. List the output files and inspect every file relevant to an expectation.
3. Evaluate each expectation independently and cite the supporting evidence.
4. Identify factual, process, and quality claims made by the output.
5. Verify those claims from the available artifacts or label them unverifiable.
6. Review the expectations themselves for missing outcomes or assertions that
   could pass for an incorrect result.

## Grading criteria

PASS only when the actual transcript or outputs demonstrate the expectation.

FAIL when:

- Evidence is absent, contradictory, or too weak to verify.
- The output meets a surface format while missing the intended result.
- A claim describes an action that the transcript does not show.
- The result is inferred rather than inspected.

## Output

Write results to `{outputs_dir}/../grading.json` using:

```json
{
  "expectations": [{ "text": "Expectation text", "passed": true, "evidence": "Observed evidence" }],
  "summary": {
    "passed": 0,
    "failed": 0,
    "total": 0,
    "pass_rate": 0.0
  },
  "claims": [
    { "claim": "Claim from the output", "type": "factual", "verified": true, "evidence": "Source" }
  ],
  "eval_feedback": {
    "suggestions": [],
    "overall": "Brief assessment of the expectations."
  }
}
```

Use the exact field names and data types shown. Keep evidence concise and
specific. Do not claim external verification unless an authoritative source
was actually consulted.
