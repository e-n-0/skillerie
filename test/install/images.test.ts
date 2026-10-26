import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { absent, fileImage, fingerprint } from "../../src/install/images.js";
import type { Image } from "../../src/install/types.js";

it.each<Image>([
  absent,
  fileImage("hello\n"),
  { kind: "link", source: 'relative/"quoted"\n\u{1f600}' },
  {
    kind: "directory",
    mode: 0o755,
    children: {
      "2": absent,
      "1": fileImage("first", 0o600),
      'quoted"\n\u{1f600}': { kind: "directory", mode: 0o700, children: {} },
      ["__proto__"]: { kind: "link", source: "elsewhere" },
    },
  },
])("keeps existing manifest fingerprints for $kind images", (value) => {
  // Given: the persisted fingerprint format is SHA-256 of the JSON image.
  const expected = `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
  // When: an image is fingerprinted.
  const actual = fingerprint(value);
  // Then: installations written by earlier versions still recognize it.
  expect(actual).toBe(expected);
});

it("fingerprints a large directory without allocating its complete JSON string", () => {
  // Given: small shared file images describe a tree larger than the JSON string limit.
  const file: Image = { kind: "file", data: "YQ==".repeat(65536), mode: 0o644 };
  const children: Record<string, Image> = {};
  const expected = createHash("sha256").update('{"kind":"directory","mode":493,"children":{');
  const serializedFile = JSON.stringify(file);
  for (let index = 0; index < 2048; index += 1) {
    const name = `file-${index}`;
    children[name] = file;
    if (index) expected.update(",");
    expected.update(JSON.stringify(name)).update(":").update(serializedFile);
  }
  expected.update("}}");
  // When: the directory is fingerprinted.
  const actual = fingerprint({ kind: "directory", mode: 0o755, children });
  // Then: its digest matches the existing format without a monolithic allocation.
  expect(actual).toBe(`sha256:${expected.digest("hex")}`);
});
