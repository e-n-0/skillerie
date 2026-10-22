import { Ajv } from "ajv";
import type { ExternalRevision } from "../core/types.js";

const validate = new Ajv({ allErrors: true }).compile<readonly ExternalRevision[]>({
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["url", "sha", "path"],
    properties: {
      url: { type: "string", minLength: 1 },
      ref: { type: "string", minLength: 1 },
      sha: { type: "string", pattern: "^[a-fA-F0-9]{40}$" },
      path: { type: "string" },
    },
  },
});

/** Parse persisted revisions once at the storage boundary. */
export function parseExternalRevisions(value: unknown): readonly ExternalRevision[] {
  if (validate(value)) return value;
  throw new TypeError("Invalid external revision state.");
}
