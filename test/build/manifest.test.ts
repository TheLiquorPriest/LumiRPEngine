// The manifest Lumiverse installs the extension by. It asks for exactly the permissions the extension
// checks it was granted: Lumiverse grants nothing a manifest doesn't ask for, so one asked for too few
// would keep the extension's blocking notice up for good, and one too many is a grant nothing uses. It
// keeps the identifier the extension's code goes by, under which Lumiverse keeps the extension's storage
// and RPE its registration. And it names the files the build makes.

import { expect, test } from "bun:test";
import { OUT } from "../../scripts/build";
import manifest from "../../spindle.json";
import { EXTENSION_IDENTIFIER } from "../../src/adapter/lumiverse/pipe-wire";
import { NEEDS } from "../../src/ext/permissions";

test("asks for exactly the permissions the extension checks it was granted, each once", () => {
  expect(manifest.permissions.toSorted()).toEqual(NEEDS.map((need) => need.permission).toSorted());
  expect(new Set(manifest.permissions).size).toBe(manifest.permissions.length);
});

test("goes by the identifier the extension's code goes by", () => {
  expect(manifest.identifier).toBe(EXTENSION_IDENTIFIER);
});

test("names the extension's two files as the build makes them", () => {
  expect([manifest.entry_backend, manifest.entry_frontend]).toEqual([`dist/${OUT.backend}`, `dist/${OUT.frontend}`]);
});
