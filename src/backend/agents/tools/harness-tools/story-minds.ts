// The mind tools (DEPTH2-PLAN §5): `mind_read`, `mind_write` and `mind_digested`, and `mind_seed`,
// which gives the author what the engine already holds of a person to write who they are from. A
// mind is files in the chat's workspace (`backend/story/minds.ts`); who the caller is comes from the
// call's `as`, checked there, and a character reaches its own mind alone.
//
// - `mind_read`: a character's agent reads its own mind (never a supporting character's profile);
//   the author and the game master read anyone's, each file with its version.
// - `mind_write`: a character's agent writes its own now, memory, beliefs, people and plans files,
//   in its voice; the author writes a principal's `core.md` and a supporting character's
//   `profile.md`, and nothing else of a mind; the game master writes none; `outline.md` is written
//   only while the story is prepared. Written at once, each as the caller's own versioned write, and
//   held to the player's mode for characters' minds: a file can't wait on the review card, so
//   Confirm refuses it as Never does.
// - `mind_digested`: a character marks its feed taken in up to a beat it read (`markDigested`).
// - Inside a turn (a scene or the direct line, whose story record is staged with the turn) a
//   character's own run writes no file of its mind and marks nothing taken in: that is the work of
//   the run after the reply. A run after the reply, a preparing run and a reliving run write as ever.
// - `mind_seed`: the person's record, the older engine's mind of them and what they knew, read with
//   the old engines' own read tools, and their mind's files as they stand. It writes nothing.

import { WRITE_NOTE } from "../../../../shared/agent-tools-write";
import { HARNESS_AGENT, HARNESS_FAMILY, HARNESS_NOTE } from "../../../../shared/harness-texts";
import { MINDS_NOTE, MINDS_TOOL } from "../../../../shared/harness-texts-minds";
import type { JsonObject } from "../../../../shared/json";
import { AGENT_CHANGE_LABEL, MIND_FILE_IDS, type MindFileId, type UserSettings } from "../../../../shared/settings";
import { castOn } from "../../../../engine/story/record";
import { renderPrompt } from "../../../prompts";
import { effectiveMode } from "../../../settings-store";
import { castFor, markDigested } from "../../../story/cast";
import { appendTo, baseOf, CHARACTER_FILES, characterSelf, fileNamed, filesOf, mindCall, mindEntity, mindPath, PRINCIPAL_FILES, readMind, standingIn, standingWords, whoNamed } from "../../../story/minds";
import type { ToolOutcome } from "../../runtime";
import type { HarnessFile } from "../harness-ports";
import { boolArg, missing, refusedAnswer } from "../propose";
import { READ_TOOLS } from "../read";
import type { ToolReadView } from "../read-view";
import { argGiven, needText, objectSchema, text } from "../schema";
import type { HarnessToolDefinition } from "./kit";

const count = (n: number): string => n.toLocaleString("en-US");

/** One file as `mind_read` and `mind_seed` show it: its head (name, version, size and room), then its text; or that it holds nothing yet. */
function shown(view: ToolReadView, id: MindFileId, file: HarnessFile | null, max: number): string {
  if (!file) return `### ${view.text(MINDS_NOTE.fileEmpty, { file: `${id}.md`, max: count(max) })}`;
  return `### ${view.text(MINDS_NOTE.fileHead, { file: `${id}.md`, version: file.version, size: count(file.text.length), max: count(max) })}\n${file.text}`;
}

/** How long a person's name, their standing and a file's version may run in a read's heads, for its bound: far longer than any. */
const HEAD_ROOM = 200;

/**
 * The most `mind_read` gives under `settings`: every file full to its size, each under its head,
 * after the read's own head. A mind is read whole, so LumiAH gives up to this whole (its
 * `wholeChars`); what is past it reaches the reader clipped, the rest kept for scratch_read.
 */
function mindReadChars(settings: UserSettings): number {
  const { texts } = settings.prompts;
  const max = settings.story.minds.chars;
  const long = "x".repeat(HEAD_ROOM);
  const head = renderPrompt(MINDS_NOTE.readHead, texts, { name: long, standing: long }).length;
  // Each file: "### ", its head, a line break, its text, and the blank line before the next.
  return MIND_FILE_IDS.reduce((sum, id) => sum + 7 + renderPrompt(MINDS_NOTE.fileHead, texts, { file: `${id}.md`, version: long, size: count(max[id]), max: count(max[id]) }).length + max[id], head);
}

/** The old engines' read tools by name: `mind_seed` reads a person with them, as the game master's tools read one. */
const READS: ReadonlyMap<string, (typeof READ_TOOLS)[number]> = new Map(READ_TOOLS.map((t) => [t.name, t]));

export const MIND_FILE_TOOLS: readonly HarnessToolDefinition[] = [
  {
    name: MINDS_TOOL.read,
    family: HARNESS_FAMILY.mind,
    tier: "read",
    parameters: () => objectSchema({ who: text(), file: text(MIND_FILE_IDS.map((f) => `${f}.md`)) }),
    wholeChars: mindReadChars,
    async run(args, env) {
      const view = await env.reader.view();
      const call = await mindCall(view, env, MINDS_TOOL.read, args);
      if (!("who" in call)) return call;
      if (!env.files) return view.refuse(MINDS_NOTE.noWorkspace);
      const { caller, who, standing, turn } = call;
      const entity = mindEntity(view, who);
      const name = view.name(entity);
      const one = argGiven(args, "file") ? fileNamed(view, MINDS_TOOL.read, args) : null;
      if (one !== null && typeof one !== "string") return one;
      // A character's agent reads who it is and its own files; a supporting character's profile is the author's note on them, never theirs.
      if (caller === "self" && one === "profile") return view.refuse(MINDS_NOTE.profileNotYours);
      const ids = one !== null ? [one] : caller === "self" ? PRINCIPAL_FILES : MIND_FILE_IDS;
      const read = await readMind(env.files, entity, ids);
      // The author and the game master see the files someone of this standing keeps, written or not, and any other that is written (kept from another standing).
      const kept = filesOf(standing);
      const parts = one !== null || caller === "self" ? read : read.filter((r) => r.file !== null || kept.includes(r.id));
      if (parts.length === 0) return view.refuse(MINDS_NOTE.extraNoMind, { name });
      const max = turn.settings.story.minds.chars;
      // A mind is prose its reader reads as it is: sent as text, not as a JSON answer.
      return { text: [view.text(MINDS_NOTE.readHead, { name, standing: standingWords(view, standing) }), ...parts.map((r) => shown(view, r.id, r.file, max[r.id]))].join("\n\n") };
    },
  },
  {
    name: MINDS_TOOL.write,
    family: HARNESS_FAMILY.mind,
    tier: "write",
    parameters: () => objectSchema({ who: text(), file: text(MIND_FILE_IDS.map((f) => `${f}.md`)), text: text(), append: { type: "boolean" }, version: text() }, ["file", "text"]),
    async run(args, env) {
      const view = await env.reader.view();
      const call = await mindCall(view, env, MINDS_TOOL.write, args);
      if (!("who" in call)) return call;
      const { caller, who, standing, turn } = call;
      if (caller === "self" && env.turn?.story?.staged === true) return view.refuse(MINDS_NOTE.afterReply);
      if (caller === "gm") return view.refuse(MINDS_NOTE.gmReadsOnly);
      if (!env.files) return view.refuse(MINDS_NOTE.noWorkspace);
      const file = fileNamed(view, MINDS_TOOL.write, args);
      if (typeof file !== "string") return file;
      const entity = mindEntity(view, who);
      const name = view.name(entity);
      const named = `${file}.md`;
      if (file === "outline") return view.refuse(MINDS_NOTE.outlineWritten);
      if (caller === "self") {
        if (file === "core") return view.refuse(MINDS_NOTE.coreNotYours);
        if (file === "profile") return view.refuse(MINDS_NOTE.profileNotYours);
      } else {
        // The author knows what no one person does: a mind's own files are its person's alone, and the author keeps only who they are and a supporting character's profile.
        if (CHARACTER_FILES.includes(file)) return view.refuse(MINDS_NOTE.charactersOwn, { file: named, name });
        if (standing === "player" && !turn.settings.story.minds.playerMind) return view.refuse(MINDS_NOTE.playerNoMind, { name });
        if (file === "core" && standing !== "principal" && standing !== "player") return view.refuse(MINDS_NOTE.coreForPrincipal, { name, standing: standingWords(view, standing) });
        if (file === "profile" && standing !== "supporting") return view.refuse(MINDS_NOTE.profileForSupporting, { name, standing: standingWords(view, standing) });
      }
      // An empty text is a file emptied, which a mind may mean; only a text left out is no write.
      if (typeof args.text !== "string") return missing(view, MINDS_TOOL.write, "text");
      // The player's mode for characters' minds, as the turn's gate reads it on the harness, where a type the player didn't set lands. A file is no event the review card could make: Confirm refuses it as Never does.
      const { mode } = effectiveMode(turn.settings, { v: 1, connections: {} }, null, "mind", undefined, "harness");
      if (mode !== "auto") return refusedAnswer({ refused: true, code: `mode_${mode}`, reason: mode === "never" ? view.text(WRITE_NOTE.never, { type: AGENT_CHANGE_LABEL.mind }) : view.text(MINDS_NOTE.fileAsks, { type: AGENT_CHANGE_LABEL.mind, file: named }) });
      const path = mindPath(entity, file);
      const max = turn.settings.story.minds.chars[file];
      if (boolArg(args, "append") === true) {
        const added = await appendTo(env.files, path, args.text, max);
        if ("long" in added) return view.refuse(MINDS_NOTE.appendLong, { file: named, size: count(added.long), max: count(max) });
        if ("refused" in added) return view.refuse(MINDS_NOTE.writeRefused, { file: named, reason: added.refused.reason });
        return view.answer({ written: { file: named, size: added.size, version: added.version }, note: view.text(MINDS_NOTE.written) });
      }
      if (args.text.length > max) return view.refuse(MINDS_NOTE.fileLong, { file: named, size: count(args.text.length), max: count(max) });
      const { given, base } = await baseOf(env.files, path, args);
      const wrote = await env.files.write(path, args.text, base);
      if (!("refused" in wrote)) return view.answer({ written: { file: named, size: args.text.length, version: wrote.version }, note: view.text(MINDS_NOTE.written) });
      // The file standing at another version than the one the call named is the one refusal a mind fixes by reading again; any other is the workspace's own to word.
      const now = wrote.refused.version;
      if (given === null || now === given) return view.refuse(MINDS_NOTE.writeRefused, { file: named, reason: wrote.refused.reason });
      return now === null ? view.refuse(MINDS_NOTE.staleNew, { file: named, given }) : view.refuse(MINDS_NOTE.stale, { file: named, given, version: now });
    },
  },
  {
    name: MINDS_TOOL.digested,
    family: HARNESS_FAMILY.mind,
    tier: "write",
    parameters: () => objectSchema({ to: text() }, ["to"]),
    async run(args, env) {
      const view = await env.reader.view();
      const self = await characterSelf(view, env, MINDS_TOOL.digested);
      if (!("who" in self)) return self;
      if (env.turn?.story?.staged === true) return view.refuse(MINDS_NOTE.afterReply);
      const to = needText(view, MINDS_TOOL.digested, args, "to");
      if (typeof to !== "string") return to;
      const read = await env.turn?.story?.read();
      if (!read) return view.refuse(MINDS_NOTE.noStory);
      const beats = read.path.beats;
      const at = beats.findIndex((b) => b.beat.id === to);
      if (at < 0) return view.refuse(MINDS_NOTE.toUnknown, { to });
      // A mark never moves back: what was taken in stays taken in.
      const done = castOn(read.path, self.who)?.digestedTo;
      if (done !== undefined && at <= beats.findIndex((b) => b.beat.id === done)) return view.refuse(MINDS_NOTE.toDone, { to });
      const kept = await markDigested(env, self.who, to);
      if ("refused" in kept) return view.refuse({ none: MINDS_NOTE.noStory, closed: MINDS_NOTE.turnOver, off_path: HARNESS_NOTE.offPath, no_basis: HARNESS_NOTE.noBasis }[kept.refused]);
      return view.answer({ digested: { to }, note: view.text(MINDS_NOTE.digested) });
    },
  },
  {
    name: MINDS_TOOL.seed,
    family: "minds",
    tier: "read",
    parameters: () => objectSchema({ who: text() }, ["who"]),
    async run(args, env) {
      const view = await env.reader.view();
      const turn = env.turn;
      if (!turn) return view.refuse(HARNESS_NOTE.noTurn);
      if (env.agent.role !== HARNESS_AGENT.author && env.agent.role !== HARNESS_AGENT.gm) return view.refuse(MINDS_NOTE.notYours, { tool: MINDS_TOOL.seed });
      const said = needText(view, MINDS_TOOL.seed, args, "who");
      if (typeof said !== "string") return said;
      const who = whoNamed(view, said);
      if (typeof who !== "string") return who;
      const entity = mindEntity(view, who);
      const standing = standingIn((await castFor(env)) ?? [], who);
      // What the engine holds of them, as the game master's own read tools give it to this caller: its view, its secret marks.
      const person: JsonObject = { person: entity };
      const reads = await Promise.all(["people_sheet", "minds_read", "knowledge_what_knows"].map(async (name): Promise<ToolOutcome | null> => (await READS.get(name)?.run(person, env)) ?? null));
      const [sheet, mind, knows] = reads.map((out) => out?.text ?? "");
      const parts = [view.text(MINDS_NOTE.seedHead, { name: view.name(entity), standing: standingWords(view, standing) }), `${view.text(MINDS_NOTE.seedSheet)}\n${sheet}`, `${view.text(MINDS_NOTE.seedMind)}\n${mind}`, `${view.text(MINDS_NOTE.seedKnows)}\n${knows}`];
      if (env.files) {
        const max = turn.settings.story.minds.chars;
        const written = (await readMind(env.files, entity, MIND_FILE_IDS)).filter((r) => r.file !== null);
        const files = written.length > 0 ? written : [{ id: "core" as const, file: null }];
        parts.push([view.text(MINDS_NOTE.seedFiles), ...files.map((r) => shown(view, r.id, r.file, max[r.id]))].join("\n\n"));
      }
      return { text: parts.join("\n\n") };
    },
  },
];
