# Reliable instructions for high-stakes workflows

Some workflows need explicit instructions because skipping a step has a real cost.
Use firm language for objective requirements and explain the reason behind decisions
that still require judgment.

## Useful techniques

| Technique          | Use                                                    |
| ------------------ | ------------------------------------------------------ |
| Clear requirements | State required actions without ambiguous exceptions    |
| Commitment         | Announce the workflow and track required checks        |
| Sequence           | Put checks immediately after the action they validate  |
| Shared convention  | Name the repository pattern that the workflow follows  |
| Rationale          | Explain why a step protects the user's intended result |

## Close likely workarounds

If a test reveals a recurring way to skip a requirement, add a concise counter to the
skill. For example, explain whether a failed check can be waived, deferred, or reported
as unresolved. Do not add rules for imagined edge cases with no bearing on the task.

## Match tone to purpose

| Skill type                     | Guidance                                                |
| ------------------------------ | ------------------------------------------------------- |
| Validation or required process | Use direct language and define observable completion    |
| Workflow with judgment         | Explain purpose and leave reasonable choices open       |
| Reference material             | Use neutral, factual prose                              |
| Collaboration                  | Describe the shared outcome and each participant's role |

Do not use guilt, artificial urgency, flattery, or pressure. Strong wording is appropriate
only when it serves a real user requirement.
