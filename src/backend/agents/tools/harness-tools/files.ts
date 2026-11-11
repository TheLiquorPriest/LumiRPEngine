// A mind's own files, and its old notes folded into its summary (HARNESS-SLICE3: "Character").
// Both are a person's own mind's to do, so every tool here stands behind the mind tools' gate
// (`ownMind`): an agent started as a character, for the one person it is.
//
// - `mind_files`, `mind_file_read` and `mind_file_write` reach the files that person keeps from
//   turn to turn, in their one folder of the chat's workspace (`mindFolder`). The folder comes from
//   who the agent is and the name is plain, so no call reaches another mind's files. `core.md` is
//   the user's: a mind reads it and never writes it. The workspace is the harness's
//   (`ToolEnv.files`): a write is written there at once, not staged with the turn, and where the
//   harness gave no workspace the tools say so. A file and its name are no longer than the player
//   allows (`settings.agents.harnessLimits`).
// - `mind_consolidate` stands in for the classic memory step's consolidation, which asks a model
//   call of the engine's own to fold a person's due notes into their summary. Here their own agent
//   rewrites the summary (`mind_view` shows it the notes due) and the tool stages the engine's
//   `minds.consolidated` event for exactly those notes (`notesToFold`).
//
// Both are the change type "Characters' minds" (`mind`). The fold is staged under it, as every
// change of the turn is. A file is no event: the turn has nothing of it to stage, and a review
// card's Apply could make nothing of it. So `mind_file_write` holds itself to the mode before it
// writes: Never refuses it, and Confirm refuses it too, with why (a file can't wait on the card).

import { WRITE_NOTE } from "../../../../shared/agent-tools-write";
import { hashJson } from "../../../../shared/hash";
import { HARNESS_FAMILY, HARNESS_NOTE } from "../../../../shared/harness-texts";
import { FILES_NOTE, FILES_TOOL } from "../../../../shared/harness-texts-files";
import type { EntityId } from "../../../../shared/ids";
import type { JsonObject } from "../../../../shared/json";
import type { LedgerEvent } from "../../../../shared/ledger";
import { effectiveMemory, MINDS_EVENTS, type MindCuts } from "../../../../shared/minds";
import { AGENT_CHANGE_LABEL } from "../../../../shared/settings";
import { authorLines } from "../../../../engine/player-events";
import { capCounted } from "../../../../packs/minds/core/edit";
import { notesToFold } from "../../../minds";
import { effectiveMode } from "../../../settings-store";
import type { ToolOutcome } from "../../runtime";
import type { HarnessFiles } from "../harness-ports";
import type { HarnessTurn } from "../harness-turn";
import { missing, refusedAnswer } from "../propose";
import type { ToolReadView } from "../read-view";
import type { ToolEnv } from "../registry";
import { needText, objectSchema, text, textArg } from "../schema";
import { type HarnessToolDefinition, stageChange } from "./kit";
import { cutNote, fits, MIND_FILE_NAME, mindFiles, mindFolder, ownMind } from "./minds";

/** The file that says who a person is at heart (the owner's design of a mind's files): the user's to write, whatever case a file system reads its name in. */
const CORE = "core.md";

/** The person the calling agent is, in the turn it works in (`ownMind`), with the workspace their files are in; or the answer that says why the call can't go on: the gate's, or that this chat has no workspace. */
async function ownFiles(view: ToolReadView, env: ToolEnv, tool: string, args: JsonObject): Promise<{ turn: HarnessTurn; who: EntityId; files: HarnessFiles } | ToolOutcome> {
  const own = await ownMind(view, env, tool, args);
  if (!("who" in own)) return own;
  return env.files ? { ...own, files: env.files } : view.refuse(FILES_NOTE.noWorkspace);
}

/** The call's `file` as a name a mind's file may have, no longer than the player allows; or the answer that says what a name may be. */
function fileNamed(view: ToolReadView, turn: HarnessTurn, tool: string, args: JsonObject): string | ToolOutcome {
  const said = needText(view, tool, args, "file");
  if (typeof said !== "string") return said;
  const longest = turn.settings.agents.harnessLimits.mindFileNameChars;
  // A name past the longest is answered with its length: it isn't said back whole.
  if (said.length > longest) return view.refuse(FILES_NOTE.nameLong, { size: said.length.toLocaleString("en-US"), max: longest.toLocaleString("en-US"), tool });
  return MIND_FILE_NAME.test(said) ? said : view.refuse(FILES_NOTE.badName, { file: said, tool });
}

export const FILE_TOOLS: readonly HarnessToolDefinition[] = [
  {
    name: FILES_TOOL.mindFiles,
    family: HARNESS_FAMILY.mind,
    tier: "read",
    parameters: () => objectSchema({ who: text() }, ["who"]),
    async run(args, env) {
      const view = await env.reader.view();
      const own = await ownFiles(view, env, FILES_TOOL.mindFiles, args);
      if (!("files" in own)) return own;
      const kept = await mindFiles(own.files, own.who, own.turn.settings.agents.harnessLimits.mindFileNameChars);
      return view.answer({ files: kept.map((f) => ({ file: f.file, size: f.size })), note: view.text(kept.length > 0 ? FILES_NOTE.filesNext : FILES_NOTE.noFiles) });
    },
  },
  {
    name: FILES_TOOL.mindFileRead,
    family: HARNESS_FAMILY.mind,
    tier: "read",
    parameters: () => objectSchema({ who: text(), file: text() }, ["who", "file"]),
    async run(args, env) {
      const view = await env.reader.view();
      const own = await ownFiles(view, env, FILES_TOOL.mindFileRead, args);
      if (!("files" in own)) return own;
      const file = fileNamed(view, own.turn, FILES_TOOL.mindFileRead, args);
      if (typeof file !== "string") return file;
      const found = await own.files.read(mindFolder(own.who) + file);
      if (found) return view.answer({ file, text: found.text, size: found.text.length, version: found.version });
      const kept = await mindFiles(own.files, own.who, own.turn.settings.agents.harnessLimits.mindFileNameChars);
      return kept.length > 0 ? view.refuse(FILES_NOTE.noFile, { file, files: kept.map((f) => f.file).join(", ") }) : view.refuse(FILES_NOTE.noFileYet, { file });
    },
  },
  {
    name: FILES_TOOL.mindFileWrite,
    family: HARNESS_FAMILY.mind,
    tier: "write",
    parameters: () => objectSchema({ who: text(), file: text(), text: text(), version: text() }, ["who", "file", "text"]),
    async run(args, env) {
      const view = await env.reader.view();
      const own = await ownFiles(view, env, FILES_TOOL.mindFileWrite, args);
      if (!("files" in own)) return own;
      const { turn, who, files } = own;
      const file = fileNamed(view, turn, FILES_TOOL.mindFileWrite, args);
      if (typeof file !== "string") return file;
      if (file.toLowerCase() === CORE) return view.refuse(FILES_NOTE.coreIsUsers, { name: view.name(who) });
      // An empty text is a file emptied, which a mind may mean; only a text left out is no write.
      if (typeof args.text !== "string") return missing(view, FILES_TOOL.mindFileWrite, "text");
      const longest = turn.settings.agents.harnessLimits.mindFileChars;
      if (args.text.length > longest) return view.refuse(FILES_NOTE.fileLong, { file, size: args.text.length.toLocaleString("en-US"), max: longest.toLocaleString("en-US") });
      // The mode of characters' minds, as the turn's gate reads it for a type that learns none: the player's own setting, else the shipped mode (see the header for why it is asked here).
      const { mode } = effectiveMode(turn.settings, { v: 1, connections: {} }, null, "mind");
      if (mode !== "auto") return refusedAnswer({ refused: true, code: `mode_${mode}`, reason: mode === "never" ? view.text(WRITE_NOTE.never, { type: AGENT_CHANGE_LABEL.mind }) : view.text(FILES_NOTE.fileAsks, { type: AGENT_CHANGE_LABEL.mind, file }) });
      const path = mindFolder(who) + file;
      const given = textArg(args, "version");
      const wrote = await files.write(path, args.text, given ?? (await files.read(path))?.version ?? null);
      if (!("refused" in wrote)) return view.answer({ written: { file, size: args.text.length, version: wrote.version }, note: view.text(FILES_NOTE.written) });
      // The file standing at another version than the one the call named is the one refusal a mind fixes by reading again; any other is the workspace's own to word.
      const now = wrote.refused.version;
      if (given === null || now === given) return view.refuse(FILES_NOTE.writeRefused, { file, reason: wrote.refused.reason });
      return now === null ? view.refuse(FILES_NOTE.staleNew, { file, given }) : view.refuse(FILES_NOTE.stale, { file, given, version: now });
    },
  },
  {
    name: FILES_TOOL.mindConsolidate,
    family: HARNESS_FAMILY.mind,
    tier: "write",
    parameters: () => objectSchema({ who: text(), summary: text() }, ["who", "summary"]),
    async run(args, env) {
      const view = await env.reader.view();
      const own = await ownMind(view, env, FILES_TOOL.mindConsolidate, args);
      if (!("who" in own)) return own;
      const { turn, who } = own;
      const said = needText(view, FILES_TOOL.mindConsolidate, args, "summary");
      if (typeof said !== "string") return said;
      const { registry: reg, world, state } = view;
      const memory = effectiveMemory(world, turn.settings.minds);
      if (!memory.consolidate.enabled) return view.refuse(FILES_NOTE.foldOff);
      const fold = notesToFold(state, who, state.clock, memory);
      if (fold.length === 0) return view.refuse(FILES_NOTE.nothingDue);
      const cuts: MindCuts = {};
      const summary = capCounted(said, turn.settings.minds.lengths.summary, cuts, "summary");
      const event: LedgerEvent = { type: MINDS_EVENTS.consolidated, data: { entity: who, at: state.clock, notes: fold.map((n) => n.id), summary } };
      const fit = fits(view, event);
      if ("reason" in fit) return view.refuse(HARNESS_NOTE.eventRefused, { reason: fit.reason, tool: FILES_TOOL.mindConsolidate });
      const staged = await stageChange(view, turn, { key: hashJson(["lre.harness.consolidate", event.data]), changeType: "mind", events: [event], lines: authorLines(reg, world, fit.after.state, [event], 1) });
      if ("refused" in staged) return staged.refused;
      return view.answer({ consolidated: { who: view.entity(who), notes: fold.length, lands: staged.lands }, ...cutNote(view, cuts) });
    },
  },
];
