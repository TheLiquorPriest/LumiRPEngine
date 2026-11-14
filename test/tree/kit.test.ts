// RPE's file port against the files part of RPH's contract kit: the kit's seed laid in RPE's real
// tree (the shipped level laid out from a shipped folder, the chat placed under its character).

import { runKitPart } from "rp-harness/testing/kit";
import { layTree } from "./fixtures";

runKitPart("RPE's file tree", "files", async (seed, place) => {
  const tree = await layTree(seed, place);
  return { files: tree.port, close: () => tree.close() };
});
