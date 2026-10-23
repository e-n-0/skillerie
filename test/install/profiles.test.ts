import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { install } from "../../src/install/index.js";
import { readManifest } from "../../src/install/storage.js";
import { fixture } from "./helpers.js";

it("round-trips the profile when an installation records one", async () => {
  // Given: an installation explicitly selects personal.
  const f = await fixture();
  // When: the installer writes its ownership manifest.
  await install({ ...f.options, profile: "personal" });
  // Then: the persisted and parsed manifests both retain the selection.
  const stored: unknown = JSON.parse(
    await readFile(join(f.harnessHome, ".skillerie/manifest.json"), "utf8"),
  );
  expect(stored).toHaveProperty("profile", "personal");
  expect(await readManifest(f.harnessHome)).toHaveProperty("profile", "personal");
});

it("omits the profile key when an installation has no profile", async () => {
  // Given: ordinary install options contain no profile selection.
  const f = await fixture();
  // When: the installer writes and reads ownership metadata.
  const result = await install(f.options);
  const parsed = await readManifest(f.harnessHome);
  // Then: old manifests keep the same field set, including after parsing.
  const stored: unknown = JSON.parse(
    await readFile(join(f.harnessHome, ".skillerie/manifest.json"), "utf8"),
  );
  expect(result.manifest).not.toHaveProperty("profile");
  expect(stored).not.toHaveProperty("profile");
  expect(parsed).not.toHaveProperty("profile");
});

it.each([null, 42, false, ["personal"], { name: "personal" }])(
  "rejects a non-string profile %j when reading a manifest",
  async (profile) => {
    // Given: persisted ownership metadata has an invalid optional profile field.
    const f = await fixture();
    const installed = await install(f.options);
    await writeFile(
      join(f.harnessHome, ".skillerie/manifest.json"),
      JSON.stringify({ ...installed.manifest, profile }),
    );
    // When: the manifest parser crosses the storage boundary.
    const result = readManifest(f.harnessHome);
    // Then: invalid values are rejected rather than dropped or coerced.
    await expect(result).rejects.toMatchObject({ code: "state.invalid" });
  },
);
