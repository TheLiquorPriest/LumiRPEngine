// The framing line as RPH sends it (PlanGates-4-fix1 item 8; plan §10.2 l.1160): the text of
// `.prompts/prompt-frame.md` that applies to the chat, read by RPE's own guidance reader (`src/app/guidance.ts`, which reads the
// levels as RPH does, its part's `render()` through RPH's one template renderer), since RPH's root no longer exports its guidance
// reader (RPH `0bab2e2`), never parsed or rendered a second time here. RPH
// sends `joined([template(frame)?.render().text ?? ""])` (RPH `src/harness/turn.ts:405-407`), and its
// `joined` trims each text's end and drops one left empty (`turn.ts:109-114`): that trimming, and the
// rule that an empty frame is not sent, are the only steps taken here.
//
// Where a provider will not take a system message in place, RPH's model layer sends it as a marked note:
// RPH's own `.prompts/system-note.md`, read from its shipped folder with no chat in view and rendered
// with the message's text (RPH `src/harness/index.ts:45-66`, `src/harness/shipped.ts:21-25`). `noteOf`
// renders that file through the same guidance reader, from the installed `rp-harness`'s own
// shipped folder (`SHIPPED_GUIDANCE`, from `rp-harness/helpers`); the one step taken here is RPH's own: the file's last line break
// is not part of the template (`shipped.ts:24`).
//
// Each file is handed to RPH's loader through a file port holding only that one file, at a level of its
// own, so nothing else of a tree can change what RPH makes of it.

import type { FileRead, FilesPort, Found, Layer, Refused, Scope } from "rp-harness/contract";
import { SHIPPED_GUIDANCE } from "rp-harness/helpers";
import { loadGuidance, type TemplatePart } from "../../../src/app/guidance";
import { sha256 } from "./record";

const SCOPE: Scope = { user: "floor", chat: "floor", session: "floor" };
const FOLDER = ".prompts";

/** A file's lines as RPH counts them: a final line break ends the last line and does not start another. */
function lineCount(text: string): number {
  if (text === "") return 0;
  const parts = text.split("\n").length;
  return text.endsWith("\n") ? parts - 1 : parts;
}

/** A file port that holds one file of `.prompts/`, `<name>.md`, with `text`. */
function oneFile(name: string, text: string): FilesPort {
  const path = `${FOLDER}/${name}.md`;
  const layer: Layer = { level: "chat", mount: "", folders: { prompts: FOLDER } };
  const bytes = new TextEncoder().encode(text).length;
  const lines = lineCount(text);
  return {
    layers: async () => [layer],
    places: async () => {
      throw new Error("the one-file port holds no places");
    },
    read: async (_scope, asked): Promise<FileRead> => (asked === path ? { status: "read", path, level: "chat", kind: "yours", text, start: 1, end: lines, lines, bytes, hash: sha256(text), modified: 0 } : { status: "missing", path: asked }),
    find: async (_scope, query): Promise<Found | Refused> => ({ status: "found", hits: query.by === "list" && query.path === FOLDER ? [{ path, type: "file", level: "chat", kind: "yours", bytes }] : [] }),
    write: async (_scope, asked) => ({ status: "refused", path: asked, reason: "outside", writable: [] }),
  };
}

/** The template part RPH's guidance code makes of a `.prompts/` file of this text; or why it makes none it would render. */
async function partOf(name: string, text: string): Promise<{ part: TemplatePart } | { none: string }> {
  const part = await loadGuidance(oneFile(name, text), SCOPE).part(name);
  if (part === undefined) return { none: `RPH's guidance code makes no ${name} part of the file (a header it refuses, or the part switched off)` };
  if (part.format !== "template") return { none: `RPH reads ${name}.md as a "${part.format}" part, which it never renders` };
  return { part };
}

/** The framing line RPH sends for a `prompt-frame.md` of this text, header and all; or why RPH sends none. */
export async function renderFrame(text: string): Promise<{ text: string } | { none: string }> {
  const found = await partOf("prompt-frame", text);
  if ("none" in found) return found;
  const rendered = found.part.render().text.trimEnd();
  return rendered.trim() === "" ? { none: "the file renders empty, so RPH sends no frame" } : { text: rendered };
}

/** A system message's text as RPH's model layer marks it when sent in place as a note: RPH's own `system-note.md`, rendered with the text. */
export async function noteOf(text: string): Promise<{ text: string } | { none: string }> {
  const file = await Bun.file(`${SHIPPED_GUIDANCE}${FOLDER}/system-note.md`).text();
  const found = await partOf("system-note", file.endsWith("\n") ? file.slice(0, -1) : file);
  return "none" in found ? found : { text: found.part.render({ text }).text };
}
