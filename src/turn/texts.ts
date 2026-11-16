// The guidance files in force for a scope as the engine's, the cast's and the story's tools and the
// map read them (`GuidanceFiles` in `src/iface`), for the tools the harness is handed and for the
// world state's map in the briefing; what of a part could not be read is logged as it is read.

import { loadGuidance } from "./guidance";
import type { FilesPort, Log, Scope } from "rp-harness/contract";
import { type GuidanceFiles, Lines, toolText } from "../iface";
import { splitFile } from "../iface/texts";

/**
 * The files as they are in force for a scope: RPH's guidance finds the nearest level's file of the
 * name, passing over one switched off, and its text is read as the agents would read it. Every tool
 * file and every `format: lines` part the host's tools are worded by is read here, so what of it
 * cannot be read is logged here, the one place, once for this load of the files: those lines are
 * left out where they are read, and the rest stand.
 */
export function guidanceTexts(files: FilesPort, scope: Scope, log: Log): GuidanceFiles {
  const guidance = loadGuidance(files, scope);
  const logged = new Set<string>();
  const problems = (kind: "tools" | "prompts", path: string, text: string): readonly string[] => {
    if (kind === "tools") {
      const { problem } = toolText(text, path);
      return problem === undefined ? [] : [problem];
    }
    try {
      if (splitFile(text, path).header.format !== "lines") return [];
    } catch (error) {
      return [error instanceof Error ? error.message : String(error)];
    }
    return Lines.parse(text, path).problems;
  };
  return {
    async read(kind, name) {
      const part = kind === "tools" ? await guidance.tool(name) : await guidance.part(name);
      if (part === undefined) return undefined;
      const read = await files.read(scope, part.source.path);
      if (read.status !== "read") return undefined;
      if (!logged.has(part.source.path)) {
        logged.add(part.source.path);
        for (const problem of problems(kind, part.source.path, read.text)) log.warn("Part of a guidance file could not be read; what could not be read is left out.", { problem });
      }
      return read.text;
    },
  };
}
