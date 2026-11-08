// `lre.depth` (DEPTH-PLAN §7; `shared/depth-views.ts`): what GM → Minds, GM → Depth's Notebook,
// Archive, Turn, Drafts and Treatments read, and the player's own acts there. The minds are the
// Character Engine's (`character-engine.ts`: the list, a mind with its beliefs beside the truth from
// the GM's links, the player's edit, an interview, the switch of player character, a catch-up or
// reflection now); the notebook is the author's (`depth/notebook.ts`), an edit of it one GM edit with
// its Undo, as `lre.edit` writes; the archive is the chat's raw index (`archive-index.ts`), its
// people, places and story times worded in the world's calendar; the turn is one reply's scene
// (`depth/scene/scene-view.ts`); the drafts are the world beyond view's (`depth/drafts-view.ts`), and
// the treatments the budget's (`depth/treatments-view.ts`). Nothing is withheld from the player
// (§1.4, D-9).

import { calendarOf, clockOfPhrase, clockOfStamp, formatClock } from "../engine/calendar";
import { own } from "../engine/pack-kit";
import type { ArchiveQuery } from "../shared/archive";
import type { DepthArchiveQuery, DepthArchiveResult, DepthResult } from "../shared/depth-views";
import type { ChatId, EntityId, UserId } from "../shared/ids";
import type { LandResult } from "../shared/layer";
import { mindPath, mindWriteEvent } from "../shared/character-engine";
import type { FixOp } from "../shared/ledger";
import type { DepthRequest } from "../shared/protocol";
import type { WorldDoc } from "../shared/world";
import type { WorldState } from "../engine/state";
import { catchUpNow, interviewMind, MindRefused, mindEdit, mindsView, mindView, PLAY_AS_OFF, portFor, reflectNow } from "./character-engine";
import { notebookEditOps, notebookView } from "./depth/notebook";
import { beliefLinks, linkTruths } from "./depth/truth-link";
import { DraftRefused, draftsView, dropDraft, notePress, redraft, settleNow } from "./depth/drafts-view";
import { chatNumbers } from "./depth/chat-numbers";
import { sceneView } from "./depth/scene/scene-view";
import { treatmentsView } from "./depth/treatments-view";
import type { Runtime } from "./runtime";

/** A request the views refuse, in words the player reads; the dispatcher answers it as the request's error. */
export class DepthRefused extends Error {
  constructor(
    readonly code: "bad_request" | "validation",
    message: string,
  ) {
    super(message);
  }
}

/** Hits one Archive page shows. */
export const ARCHIVE_PAGE = 8;

/** What the dispatcher lends the views: the chat's head, and one GM edit with its Undo. */
export interface DepthHost {
  head(chatId: ChatId, userId: UserId): Promise<{ state: Readonly<WorldState>; world: WorldDoc }>;
  edit(chatId: ChatId, userId: UserId, ops: FixOp[]): Promise<{ pending: boolean; undo: string | null }>;
}

/**
 * An Archive search as the index takes it: people and places by id, story times read by the world's
 * calendar (a stamp as the archive words them, or a phrase from the chat's clock now); `unread` says
 * back each time it couldn't read, which the search goes without.
 */
export function archiveQueryOf(q: DepthArchiveQuery, world: WorldDoc, state: Readonly<WorldState>): { query: ArchiveQuery; unread: string[] } {
  const cal = calendarOf(world);
  const unread: string[] = [];
  const timeOf = (said: string | undefined): number | undefined => {
    const t = said?.trim() ?? "";
    if (t === "") return undefined;
    const at = clockOfStamp(cal, t) ?? clockOfPhrase(cal, state.clock, t);
    if (at === null) unread.push(t);
    return at ?? undefined;
  };
  const from = timeOf(q.from);
  const to = timeOf(q.to);
  const text = q.text?.trim() ?? "";
  return {
    query: {
      ...(text !== "" ? { text } : {}),
      ...(q.who ? { who: q.who } : {}),
      ...(q.place ? { place: q.place } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
      offset: Math.max(0, Math.floor(q.offset ?? 0)),
      limit: ARCHIVE_PAGE,
    },
    unread,
  };
}

async function archive(rt: Runtime, host: DepthHost, chatId: ChatId, userId: UserId, q: DepthArchiveQuery): Promise<DepthArchiveResult> {
  const { world, state } = await host.head(chatId, userId);
  const { query, unread } = archiveQueryOf(q, world, state);
  const found = await rt.archive.search(chatId, userId, query);
  const cal = calendarOf(world);
  const nameOf = (id: string): string => own(state.entities, id)?.name ?? own(world.places, id)?.name ?? id;
  const offset = query.offset ?? 0;
  const seen = offset + found.hits.length;
  // Each hit by the number the chat shows it with (`chatNumbers`), else its place on the chain.
  const numbers = await chatNumbers(rt.host, chatId, userId);
  return {
    hits: found.hits.map((h) => ({ messageId: h.messageId, index: numbers.get(h.messageId) ?? h.index, isUser: h.isUser, swipeId: h.swipeId, at: h.storyTime === null ? null : formatClock(cal, h.storyTime), places: h.places.map(nameOf), people: h.people.map(nameOf), snippet: h.snippet, beats: h.beats.length })),
    next: found.hits.length > 0 && seen < found.total ? seen : null,
    unread,
  };
}

/**
 * The GM links what a GM → Minds press just wrote (§4.4, §5.1), as the poll's jobs are linked: where
 * an entry it landed now wrote `who`'s beliefs, the truth link reads them at that entry's basis, keyed
 * by the press. One held behind a reply being written, or one that wrote no belief, gives it nothing
 * new (an interview folds only its story of itself, which the GM doesn't link). A link that fails is
 * logged; the press stands.
 */
async function linkWrote(rt: Runtime, chatId: ChatId, userId: UserId, who: EntityId, press: string, landed: readonly LandResult[]): Promise<void> {
  const beliefs = mindPath(who, "beliefs");
  const entry = landed.flatMap((l) => (l.status === "landed" && l.existing !== true && l.entry.events.some((e) => mindWriteEvent(e)?.path === beliefs) ? [l.entry] : [])).at(-1);
  if (!entry) return;
  try {
    const r = await linkTruths(rt, chatId, userId, entry.basis, { who: [who], beats: [], key: ["gm", press, who], model: portFor(rt, userId) });
    for (const line of r.refused) rt.host.log("info", `[LumiRPEngine] chat ${chatId}, the GM's truth-link of ${who}'s ${press}: ${line}`, userId);
  } catch (error) {
    rt.host.log("warn", `[LumiRPEngine] chat ${chatId}, the GM's truth-link of ${who}'s ${press} didn't go through: ${error instanceof Error ? error.message : String(error)}`, userId);
  }
}

/** `lre.depth`'s answer; a refusal the player should read comes back as the request's error, in its own words. */
export async function depthRequest(rt: Runtime, host: DepthHost, r: DepthRequest, userId: UserId): Promise<DepthResult> {
  const chatId = r.chatId;
  try {
    switch (r.op) {
      case "minds":
        return { minds: await mindsView(rt, chatId, userId) };
      case "mind": {
        const mind = await mindView(rt, chatId, userId, r.who);
        // The GM's links, out of world: the mind's beliefs beside the truth.
        return { mind: mind.beliefs.length > 0 ? mind : { ...mind, beliefs: await beliefLinks(rt, chatId, userId, r.who) } };
      }
      case "mind_edit": {
        const done = await mindEdit(rt, chatId, userId, r.who, r.path, r.text);
        return { undo: done.undo, ...(done.pending ? { pending: true } : {}) };
      }
      case "interview":
        if (r.question.trim() === "") throw new DepthRefused("bad_request", "Ask a question.");
        return { interview: await interviewMind(rt, chatId, userId, r.who, r.question.trim(), r.neutral === true) };
      case "pov":
        throw new DepthRefused("validation", PLAY_AS_OFF);
      // Made while a reply is written, what it lived lands once the reply is kept: it lived nothing yet.
      case "catch_up": {
        const caught = await catchUpNow(rt, chatId, userId, r.who);
        await linkWrote(rt, chatId, userId, r.who, "catch_up", caught.entries);
        return { lived: caught.lived, ...(caught.entries.some((e) => e.status === "held") ? { pending: true } : {}) };
      }
      case "reflect": {
        const reflected = await reflectNow(rt, chatId, userId, r.who);
        await linkWrote(rt, chatId, userId, r.who, "reflect", reflected ? [reflected] : []);
        return reflected?.status === "held" ? { pending: true } : {};
      }
      case "notebook":
        return { notebook: await notebookView(rt, chatId, userId) };
      case "notebook_edit": {
        let ops: FixOp[];
        try {
          ops = await notebookEditOps(rt, userId, r.path, r.text);
        } catch (error) {
          throw new DepthRefused("bad_request", error instanceof Error ? error.message : String(error));
        }
        const done = await host.edit(chatId, userId, ops);
        return { undo: done.undo, ...(done.pending ? { pending: true } : {}) };
      }
      case "archive":
        return { archive: await archive(rt, host, chatId, userId, r) };
      case "scene":
        return { scene: await sceneView(rt, await host.head(chatId, userId), chatId, userId, r.message), dryRun: rt.loopback.dryRunOf(chatId, userId) };
      case "drafts":
        return { drafts: await draftsView(rt, chatId, userId) };
      case "draft_drop": {
        const done = await dropDraft(rt, chatId, userId, r.draft);
        return { said: ["Dropped."], ...(done.status === "held" ? { pending: true } : {}) };
      }
      case "draft_settle":
      case "draft_redraft": {
        // The author's reading (and a redraft's episode) can run for minutes: it goes on in the background, and what became of it is kept for the draft's page, which the view reads again once it lands.
        const op = r.op === "draft_settle" ? "settle" : "redraft";
        const doing = op === "settle" ? "The author is reading it against everything since its time" : "The author is drafting it again";
        notePress(chatId, userId, r.draft, { op, state: "running", lines: [`${doing}.`] });
        const job = op === "settle" ? settleNow(rt, chatId, userId, r.draft) : redraft(rt, chatId, userId, r.draft);
        void job
          .then((lines) => {
            for (const line of lines) rt.host.log("info", `[LumiRPEngine] chat ${chatId}, draft ${r.draft}: ${line}`, userId);
            notePress(chatId, userId, r.draft, { op, state: "done", lines: lines.length > 0 ? lines : ["Nothing changed: the author left it as it was."] });
          })
          .catch((error: unknown) => {
            const why = error instanceof Error ? error.message : String(error);
            rt.host.log("warn", `[LumiRPEngine] chat ${chatId}, draft ${r.draft}: ${why}`, userId);
            notePress(chatId, userId, r.draft, { op, state: "failed", lines: [why] });
          })
          .finally(() => rt.push.changed(chatId, userId));
        return { said: [`${doing}; its page in GM → Depth → Drafts shows what became of it.`] };
      }
      case "treatments":
        return { treatments: await treatmentsView(rt, chatId, userId) };
    }
  } catch (error) {
    if (error instanceof MindRefused || error instanceof DraftRefused) throw new DepthRefused("validation", error.message);
    throw error;
  }
  throw new DepthRefused("bad_request", "op must be minds, mind, mind_edit, interview, pov, catch_up, reflect, notebook, notebook_edit, archive, scene, drafts, draft_settle, draft_drop, draft_redraft or treatments");
}
