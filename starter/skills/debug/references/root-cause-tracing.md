# Root Cause Tracing

Use backward tracing to move from a visible failure to the input or decision that
first created the invalid state. Keep observations distinct from explanations.

## The Five-Step Process

### 1. Observe the Symptom

Record what happened, the exact error and stack trace, and the relevant inputs.
Include enough context to distinguish the reported problem from nearby failures.

### 2. Find the Immediate Cause

Identify the statement that directly produces the failure:

```text
Failure at profile.ts:42: Cannot read property 'name' of undefined
Immediate cause: account.name is evaluated while account is undefined
```

Verify the statement and the values at the failure point.

### 3. Trace One Level Up

Find the caller and inspect the values it passed:

```text
profile.ts:42 <- router.ts:18 calls getProfile("alice")
getProfile("alice") <- lookup returns no account
```

Do not assume the argument is valid just because it has the expected shape.

### 4. Continue Through the Call Chain

Follow the value through each caller, conversion, and data boundary. Use the
reproduction loop or a focused debugger to inspect the actual value at each step.

### 5. Find the Original Trigger

Continue until the earliest incorrect value, state transition, or assumption is
identified. Confirm that changing this trigger changes the observed symptom.
That evidence, rather than a plausible narrative, establishes the root cause.

## Instrumentation

When code inspection is insufficient, add temporary diagnostic output around the
suspect boundary:

```typescript
function inspectValue(value: unknown) {
  console.error("[DEBUG-TRACE]", {
    value,
    stack: new Error().stack,
  });
}
```

Use a unique marker and remove the instrumentation after testing. Prefer a
debugger when it gives the same evidence without modifying code.

## Test Pollution

When a test passes alone but fails in a suite, look for another test that leaves
shared state behind. Narrow the search by running subsets with the failing test,
then inspect global mutations, mocks that were not restored, records that were
not cleaned up, environment changes, and filesystem artifacts.

## Failure Classification

Classify the failure to guide evidence gathering:

| Category       | Examples                                         | Investigation direction                                   |
| -------------- | ------------------------------------------------ | --------------------------------------------------------- |
| Code           | Incorrect condition, algorithm, or boundary      | Trace inputs and decisions to the source.                 |
| Configuration  | Missing or invalid setting                       | Trace how configuration is loaded and validated.          |
| Dependency     | Missing package or incompatible interface        | Check versions, lockfiles, and documented behavior.       |
| Infrastructure | Resource exhaustion or intermittent connectivity | Verify the environment and resource constraints.          |
| Intermittent   | Outcome varies between controlled runs           | Inspect shared state, event ordering, and concurrency.    |
| Data           | Unexpected value, encoding, or schema            | Trace where the value originated and validate boundaries. |

Confirm an intermittent or environment-dependent failure with a controlled
reproduction before investing in a detailed theory.

## Principle

Fix the original cause, add proportional validation where invalid state can
re-enter, and verify the result with the reproduction that exposed the issue.
