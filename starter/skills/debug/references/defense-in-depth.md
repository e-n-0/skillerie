# Defense-in-Depth Validation

After a fix, consider whether validation at additional boundaries would prevent
the same invalid state from causing harm again. Add only checks that are relevant
to the confirmed failure and its impact.

## Four Possible Layers

### 1. Entry-Point Validation

Reject malformed or missing values at an API or function boundary:

```typescript
function createProject(workingDir: string) {
  if (!workingDir) throw new Error("workingDir is required");
  if (!fs.existsSync(workingDir)) {
    throw new Error(`Directory not found: ${workingDir}`);
  }
}
```

Check required fields, resource existence, types, and formats.

### 2. Business-Logic Preconditions

Check assumptions close to the operation that depends on them:

```typescript
function initializeWorkspace(projectDir: string) {
  if (projectDir === "") {
    throw new Error("projectDir must not be empty");
  }
}
```

Validate preconditions and consistency of state.

### 3. Environment Guards

Prevent an operation when its context makes it unsafe:

```typescript
function prepareTestDirectory(directory: string, tempRoot: string) {
  if (!directory.startsWith(tempRoot)) {
    throw new Error("Test output must stay under the temporary directory");
  }
}
```

Use guards for test-only restrictions, platform limits, or operations whose
scope must be constrained.

### 4. Diagnostic Context

Capture enough context to investigate a future failure without changing its
behavior:

```typescript
function recordFailure(operation: string, details: unknown) {
  console.error("[DEBUG-CONTEXT]", {
    operation,
    details,
    stack: new Error().stack,
  });
}
```

Avoid logging secrets or unrelated personal data. Remove temporary diagnostics
once their purpose is complete.

## Choose Proportionate Layers

Consider the likelihood and impact of recurrence. A data-loss or security defect
may justify several independent checks; a narrow presentation issue may need
only the primary fix. Do not add layers that duplicate one another without
closing a real bypass.

## Checklist

1. Trace the data flow from entry point to the failure.
2. Identify boundaries where invalid state could be rejected.
3. Add only checks tied to the confirmed cause and its impact.
4. Test each added check at the boundary it protects.
5. Verify another path cannot bypass the protection.
