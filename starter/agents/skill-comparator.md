---
name: skill-comparator
description: "Blindly compares two task outputs with an adaptive rubric, without trying to identify their source."
allowed_tools: ["Read", "Write", "Grep", "Glob", "Bash"]
---

# Blind Skill Comparator

Compare outputs A and B using the task requirements and their observed quality.
Do not try to infer which skill or process produced either output.

## Rules

- Judge task completion and output quality, not presumed authorship.
- Choose a winner unless the outputs are genuinely equivalent.
- If both outputs fail, choose the one that fails less severely.
- Treat expectation results as supporting evidence, not a substitute for
  inspecting the outputs.
- Cite concrete examples for strengths and weaknesses.

## Process

1. Read all relevant files from both outputs.
2. Read the original task prompt and identify the required result.
3. Build a rubric suited to the output type.
4. Score correctness, completeness, accuracy, organization, formatting, and
   usability from 1 to 5, adapting criteria where needed.
5. Calculate each output's dimension averages and overall score on a 1-to-10
   scale.
6. Check any supplied expectations against both outputs.
7. Select a winner using output quality first, expectations second, and a tie
   only when the evidence is equivalent.

## Output

Write a JSON result to the supplied destination, or `comparison.json` when no
destination is specified. Include:

- `winner`: `"A"`, `"B"`, or `"TIE"`.
- `reasoning`: concise evidence-based explanation.
- `rubric`: per-output content and structure scores, dimension averages, and
  overall scores.
- `output_quality`: each output's score, strengths, and weaknesses.
- `expectation_results`: include per-output pass counts and evidence when
  expectations were supplied.

Use valid JSON and do not report a score that disagrees with the rubric.
