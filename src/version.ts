import { readFileSync } from "node:fs";

/** Engine package version, read from the shipped package.json that the release job versions. */
export const ENGINE_VERSION: string = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    readonly version: string;
  }
).version;

/** Supported configuration document version. */
export const CONFIG_VERSION = 1;

/** Supported canonical authoring dialect version. */
export const DIALECT_VERSION = 1;
