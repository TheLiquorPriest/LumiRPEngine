// The guidance files in force for a scope as the engine's, the cast's and the story's tools and the
// map read them (`GuidanceFiles` in `src/iface`), for the tools the harness is handed and for the
// world state's map in the briefing.

import { loadGuidance } from "rp-harness";
import type { FilesPort, Scope } from "rp-harness/contract";
import type { GuidanceFiles } from "../iface";

/**
 * The files as they are in force for a scope: RPH's guidance finds the nearest level's file of the
 * name, passing over one switched off, and its text is read as the agents would read it.
 */
export function guidanceTexts(files: FilesPort, scope: Scope): GuidanceFiles {
  const guidance = loadGuidance(files, scope);
  return {
    async read(kind, name) {
      const part = kind === "tools" ? await guidance.tool(name) : await guidance.part(name);
      if (part === undefined) return undefined;
      const read = await files.read(scope, part.source.path);
      return read.status === "read" ? read.text : undefined;
    },
  };
}
