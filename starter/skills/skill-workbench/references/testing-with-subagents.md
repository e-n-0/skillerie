# Testing skills with subagents

Treat skill testing as a behavioral check. A skill can be well written and still leave
an agent unsure about the next action.

## Baseline and comparison

1. Choose a realistic prompt that exercises the skill's main promise.
2. Run it without the skill and record observable mistakes or omissions.
3. Run the same prompt with the skill loaded.
4. Compare both results against the same success criteria.
5. Revise general gaps and repeat when the result shows a meaningful failure.

Use a `Task` subagent when available. Keep the prompt, inputs, and evaluation criteria
identical between runs. If separate runs execute concurrently, ensure each has isolated
output files and cannot overwrite the other's evidence.

## Choose the test for the skill

| Skill type | Scenario                                                 |
| ---------- | -------------------------------------------------------- |
| Workflow   | Apply the steps to a new but representative request      |
| Discipline | Include realistic pressure to skip a required step       |
| Pattern    | Test recognition, application, and a counterexample      |
| Reference  | Ask for information the support file is meant to provide |

Include likely edge cases, not just the easiest success path. For a file-oriented skill,
use synthetic fixtures under a temporary directory or `/home/alice/project/`.

## Read evidence

Review the full transcript when available. Look for skipped steps, unnecessary work,
misread instructions, unsupported claims, and details that should not have been changed.
Record the observed result rather than inferring success from the final answer alone.

When timing or token data is supplied by the runner, record it with the run. Do not invent
metrics or compare runs that used different prompts or inputs.

## Refine

If the with-skill run fails:

- Identify whether the instruction was missing, buried, ambiguous, or ignored.
- Fix the general cause instead of encoding the test prompt into the skill.
- Repeat the scenario after changing the skill.
- Stop when the skill meets its success criteria or additional revisions stop improving
  the result, and report any unresolved gap.
