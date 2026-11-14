// The build's check that a bundle holds the same code wherever it is built: a file Bun took from
// outside the repository fails the build. The one exception is a harness linked from a checkout beside
// the repository, of which a bundle may take its sources, its shipped files and the packages it
// installed for itself, and nothing else.

import { describe, expect, test } from "bun:test";
import { allowedRoots, outsideOf } from "../../scripts/build";

const REPO = "/work/extensions/engine";
const HARNESS = "/work/extensions/harness";

describe("where a bundle may take its files from", () => {
  test("a linked harness's sources, shipped files and own packages, and nothing else outside the repository", () => {
    const inputs = [
      "src/app/main.ts",
      "node_modules/preact/dist/preact.mjs",
      "../harness/src/index.ts",
      "../harness/guidance/.prompts/notices.md",
      "../harness/node_modules/@earendil-works/pi-ai/dist/index.js",
      // Bun found it in the node_modules of the checkout the repository sits in.
      "../../node_modules/supports-color/index.js",
      "../harness/test/support.ts",
      "../harness-old/src/index.ts",
    ];
    expect(outsideOf(inputs, REPO, allowedRoots(REPO, HARNESS))).toEqual(["/work/node_modules/supports-color/index.js", "/work/extensions/harness/test/support.ts", "/work/extensions/harness-old/src/index.ts"]);
  });

  test("nothing outside the repository when the harness is installed inside it", () => {
    const inputs = ["node_modules/rp-harness/src/index.ts", "../harness/src/index.ts"];
    expect(outsideOf(inputs, REPO, allowedRoots(REPO, `${REPO}/node_modules/rp-harness`))).toEqual(["/work/extensions/harness/src/index.ts"]);
  });
});
