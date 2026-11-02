// The condense tool (DESIGN §4.6, "Context, cache and notes"): an agent condenses a long source (a
// workspace file, a turn's transcript among them, or a lore entry) into a short workspace note with
// one call of its own model, so it, a later turn or another role reads the note, or is pointed at it,
// instead of the whole source. The note opens with its source and the source's hash, so whoever reads
// it later can tell whether it is still current. Working a turn the note is staged as any workspace
// write is (`propose`), landing when the turn commits and read meanwhile by the turn's later runs.
// Offered only to an agent that can make the call (`ToolEnv.summarize`): a turn's roles, and the main
// agent through its own tool (`main-agent.ts`), which shares `condenseSource`.

import { RUNTIME_TEXT } from "../../../shared/agent-prompts";
import { WRITE_NOTE } from "../../../shared/agent-tools-write";
import { blobHash } from "../../../shared/stores";
import type { ToolOutcome } from "../runtime";
import { loreText } from "./lore";
import { propose } from "./propose";
import type { ToolReadView } from "./read-view";
import type { ToolDefinition } from "./registry";
import { needText, objectSchema, text, textArg } from "./schema";

/** Condenses `text` with the agent's own model, following `instructions`: one call with no tools; the condensed text, or why not. */
export type Summarize = (instructions: string, text: string, signal: AbortSignal) => Promise<{ text: string } | { failed: string }>;

export const CONDENSE = "condense";

/** Where a note goes when the call names none: under notes/condensed/, named for its source. */
const NOTES = "notes/condensed/";

/** What a workspace path's name can't hold: a source's name names its note with each such run as `-`. */
const NOT_IN_NAME = /[^\p{L}\p{N}._-]+/gu;

/** A source's name and text as the view reads it: a workspace file by its path, else a lore entry by any id the lore tools take; null for neither. */
async function sourceOf(view: ToolReadView, ref: string): Promise<{ name: string; text: string } | null> {
  const file = (await view.workspace()).find((f) => f.path === ref);
  if (file) {
    const body = await view.blob(file.hash);
    return body === null ? null : { name: ref, text: body };
  }
  const lore = await loreText(view, ref);
  return lore ? { name: lore.id, text: `${lore.title}\n${lore.text}` } : null;
}

/** `ref` condensed into its note's path and text (see the header), or the note the agent is answered with. */
export async function condenseSource(view: ToolReadView, input: { ref: string; note: string | null; focus: string; summarize: Summarize; signal: AbortSignal }): Promise<{ path: string; text: string; chars: number } | ToolOutcome> {
  const source = await sourceOf(view, input.ref);
  if (!source) return view.refuse(WRITE_NOTE.noSource, { source: input.ref });
  const done = await input.summarize(view.text(RUNTIME_TEXT.condenseAsk, { source: source.name, focus: input.focus }), source.text, input.signal);
  if ("failed" in done) return view.refuse(WRITE_NOTE.condenseFailed, { source: source.name, reason: done.failed });
  const path = input.note ?? `${NOTES}${source.name.replace(NOT_IN_NAME, "-").replace(/^-+|-+$/g, "") || "source"}.md`;
  return { path, text: view.text(RUNTIME_TEXT.condenseNote, { source: source.name, hash: blobHash(source.text).slice(0, 12), text: done.text }), chars: source.text.length };
}

export const CONDENSE_TOOLS: readonly ToolDefinition[] = [
  {
    name: CONDENSE,
    family: "workspace",
    tier: "gm",
    summarizes: true,
    parameters: () => objectSchema({ source: text(), note: text(), focus: text() }, ["source"]),
    async run(args, env) {
      const view = await env.reader.view();
      const ref = needText(view, CONDENSE, args, "source");
      if (typeof ref !== "string") return ref;
      if (!env.summarize) return view.refuse(WRITE_NOTE.noWriter);
      const made = await condenseSource(view, { ref, note: textArg(args, "note"), focus: textArg(args, "focus") ?? "", summarize: env.summarize, signal: env.signal });
      if (!("path" in made)) return made;
      const out = await propose(view, env.writer, { kind: "ws_write", path: made.path, text: made.text });
      return out.error ? out : view.answer({ note: made.path, chars: { source: made.chars, note: made.text.length }, ...(JSON.parse(out.text) as object) });
    },
  },
];
