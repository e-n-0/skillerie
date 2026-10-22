import type { Diagnostic } from "../core/types.js";

interface Version {
  readonly parts: readonly [number, number, number];
  readonly prerelease: readonly string[];
  readonly precision: number;
}

function version(text: string): Version | undefined {
  const match =
    /^v?(0|[1-9]\d*|[xX*])(?:\.(0|[1-9]\d*|[xX*]))?(?:\.(0|[1-9]\d*|[xX*]))?(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(
      text,
    );
  if (!match) return undefined;
  const fields = [match[1], match[2], match[3]];
  const firstWildcard = fields.findIndex((field) => field === undefined || /^[xX*]$/.test(field));
  const precision = firstWildcard < 0 ? 3 : firstWildcard;
  if (fields.slice(precision).some((field) => field !== undefined && !/^[xX*]$/.test(field)))
    return undefined;
  const prerelease = match[4]?.split(".") ?? [];
  if (
    (prerelease.length > 0 && precision !== 3) ||
    prerelease.some((field) => /^\d+$/.test(field) && /^0\d/.test(field))
  )
    return undefined;
  return {
    parts: [Number(fields[0]) || 0, Number(fields[1]) || 0, Number(fields[2]) || 0],
    prerelease,
    precision,
  };
}

function compare(left: Version, right: Version): number {
  for (const index of [0, 1, 2] as const) {
    const difference = left.parts[index] - right.parts[index];
    if (difference) return Math.sign(difference);
  }
  if (!left.prerelease.length) return right.prerelease.length ? 1 : 0;
  if (!right.prerelease.length) return -1;
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index++) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;
    const numericA = /^\d+$/.test(a);
    const numericB = /^\d+$/.test(b);
    if (numericA && numericB) return Math.sign(Number(a) - Number(b));
    if (numericA !== numericB) return numericA ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

function upperBound(target: Version, index: 0 | 1 | 2): Version {
  return {
    parts: [
      target.parts[0] + (index === 0 ? 1 : 0),
      index === 0 ? 0 : target.parts[1] + (index === 1 ? 1 : 0),
      index < 2 ? 0 : target.parts[2] + 1,
    ],
    precision: 3,
    prerelease: [],
  };
}

function comparator(token: string): ((current: Version) => boolean) | undefined {
  const match = /^(>=|<=|>|<|=|\^|~)?(.+)$/.exec(token);
  const text = match?.[2];
  const target = text === undefined ? undefined : version(text);
  if (!target) return undefined;
  const operator = match?.[1] ?? "=";
  const upper = upperBound(target, target.precision <= 1 ? 0 : 1);
  switch (operator) {
    case "^": {
      if (target.precision === 0) return () => true;
      const index =
        target.parts[0] > 0 || target.precision <= 1
          ? 0
          : target.parts[1] > 0 || target.precision === 2
            ? 1
            : 2;
      return (current) =>
        compare(current, target) >= 0 && compare(current, upperBound(target, index)) < 0;
    }
    case "~":
      return (current) =>
        target.precision === 0 || (compare(current, target) >= 0 && compare(current, upper) < 0);
    case "=":
      return (current) =>
        target.precision === 0 ||
        (target.precision === 3
          ? compare(current, target) === 0
          : compare(current, target) >= 0 && compare(current, upper) < 0);
    case ">=":
      return (current) => target.precision === 0 || compare(current, target) >= 0;
    case "<=":
      return (current) =>
        target.precision === 0 ||
        (target.precision < 3 ? compare(current, upper) < 0 : compare(current, target) <= 0);
    case ">":
      return (current) =>
        target.precision !== 0 &&
        (target.precision < 3 ? compare(current, upper) >= 0 : compare(current, target) > 0);
    case "<":
      return (current) => target.precision !== 0 && compare(current, target) < 0;
    default:
      return undefined;
  }
}

/** Local range support avoids introducing a runtime dependency for one engine pin. */
export function checkEngineVersion(
  pin: string | undefined,
  current: string,
  file: string,
): readonly Diagnostic[] {
  if (pin === undefined) return [];
  const running = version(current);
  const groups = pin.split("||").map((group) => {
    const hyphen = /^\s*(\S+)\s+-\s+(\S+)\s*$/.exec(group);
    const normalized = hyphen
      ? `>=${hyphen[1] ?? ""} <=${hyphen[2] ?? ""}`
      : group.trim().replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1");
    const tokens = normalized === "" ? ["*"] : normalized.split(/\s+/);
    return {
      tokens,
      checks: tokens.map(comparator),
    };
  });
  const valid =
    running?.precision === 3 &&
    groups.every((group) => group.checks.every((check) => check !== undefined));
  const matches =
    valid &&
    groups.some((group) => {
      if (running.prerelease.length) {
        const permitsPrerelease = group.tokens.some((token) => {
          const target = version(token.replace(/^(>=|<=|>|<|=|\^|~)/, ""));
          return (
            target?.prerelease.length &&
            target.parts.every((part, index) => part === running.parts[index])
          );
        });
        if (!permitsPrerelease) return false;
      }
      return group.checks.every((check) => check?.(running));
    });
  if (matches) return [];
  return [
    {
      severity: "error",
      code: valid ? "engine.incompatible" : "engine.range",
      message: valid
        ? `Engine ${current} does not satisfy ${pin}; install a compatible skillerie version.`
        : `Invalid engine version range: ${pin}.`,
      file,
      jsonPath: "/engine",
    },
  ];
}
