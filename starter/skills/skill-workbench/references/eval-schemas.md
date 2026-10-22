# Skill evaluation data

Use JSON files for portable evaluation cases and results. Keep examples synthetic and
make each expectation observable.

## `evals.json`

```json
{
  "skill_name": "example-skill",
  "evals": [
    {
      "id": 1,
      "prompt": "Create a short checklist for validating a generated file.",
      "expected_output": "A checklist with observable validation steps.",
      "files": ["evals/files/sample.txt"],
      "expectations": [
        "The output checks the generated file exists.",
        "The output describes how to respond when validation fails."
      ]
    }
  ]
}
```

| Field                     | Type         | Meaning                                  |
| ------------------------- | ------------ | ---------------------------------------- |
| `skill_name`              | string       | Skill name from frontmatter              |
| `evals[].id`              | integer      | Unique case identifier                   |
| `evals[].prompt`          | string       | Input prompt                             |
| `evals[].expected_output` | string       | Human-readable success description       |
| `evals[].files`           | string array | Optional files relative to the eval root |
| `evals[].expectations`    | string array | Statements a reviewer can verify         |

## `grading.json`

```json
{
  "expectations": [
    {
      "text": "The output checks the generated file exists.",
      "passed": true,
      "evidence": "The checklist includes an existence check."
    }
  ],
  "summary": {
    "passed": 1,
    "failed": 0,
    "total": 1,
    "pass_rate": 1.0
  },
  "claims": [
    {
      "claim": "The checklist includes a recovery step.",
      "type": "quality",
      "verified": true,
      "evidence": "The final item describes what to do after a failed check."
    }
  ]
}
```

Keep `text`, `passed`, and `evidence` as the expectation field names. Evidence should
identify the output or observed behavior supporting the verdict.

## Benchmark results

A benchmark can compare runs with and without a skill. Record the case, configuration,
run number, pass rate, elapsed time, token count when available, and errors. Summarize
the difference without presenting a small sample as a universal result.
