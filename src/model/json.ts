import type { JsonObject, JsonValue } from "../core/types.js";

/** Reject cycles and values that canonical JSON cannot represent. */
export function isJsonValue(value: unknown, ancestors = new Set<unknown>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return false;
  ancestors.add(value);
  const values: readonly unknown[] = Array.isArray(value) ? value : Object.values(value);
  const valid = values.every((item) => isJsonValue(item, ancestors));
  ancestors.delete(value);
  return valid;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) && isJsonValue(value);
}

export function pointerToken(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
