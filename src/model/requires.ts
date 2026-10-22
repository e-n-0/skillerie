import type {
  Environment,
  HarnessId,
  Requires,
  RequiresCheck,
  RequiresResult,
} from "../core/types.js";

/** Captured probes only: evaluation never consults process state. */
export interface RequiresContext {
  readonly env: Environment;
  readonly os: "darwin" | "linux";
  readonly harness: HarnessId;
  readonly availableBins: ReadonlySet<string>;
  readonly force?: boolean;
}

export function evaluateRequires(
  requires: Requires | undefined,
  context: RequiresContext,
): RequiresResult {
  const checks: RequiresCheck[] = [];
  for (const kind of ["bin", "env", "os", "harness"] as const) {
    const value = requires?.[kind];
    const names = typeof value === "string" ? [value] : (value ?? []);
    for (const name of names) {
      let satisfied: boolean;
      switch (kind) {
        case "bin":
          satisfied = context.availableBins.has(name);
          break;
        case "env":
          satisfied = Boolean(context.env[name]);
          break;
        case "os":
          satisfied = context.os === name;
          break;
        case "harness":
          satisfied = context.harness === name;
          break;
        default:
          return unreachable(kind);
      }
      checks.push({ kind, name, satisfied });
    }
  }
  return {
    satisfied: context.force ?? checks.every((check) => check.satisfied),
    checks,
    ...(context.force === undefined ? {} : { forced: context.force }),
  };
}

function unreachable(value: never): never {
  throw new TypeError(`Unknown requirement kind: ${String(value)}`);
}
