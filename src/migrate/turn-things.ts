// What today's build kept beside a chat's replies that belongs to a turn of RPE (STANDALONE-PLAN §15.2, "What you asked for through a panel",
// "Review cards and stored chips; staged changes", "Approvals and jobs"; §10.10): each request he made through a panel goes onto the turn
// that answered it, in the turn lane's `request` table, as the request he made; each stored chip and review card goes onto its turn in the
// `chip` table as today's build kept it, with its items and statuses; a change staged for his next message waits there as a held request that
// goes with it; and the tools he approved for a chat go onto the turn that was running then, as history. The migration may not import the turn
// lane, so these rows are written into its tables as its own writers write them (`carryRequest`, `src/turn/requests.ts`; the `chip` table,
// `src/turn/tables.ts`): where the run was not given the lane's tables, none is written and the report says so. A chat's earlier carried rows go
// first, so a later run replaces what an earlier one put and nothing else.

import type { Database } from "bun:sqlite";
import { isRecord, type JsonObject } from "../shared/json";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import type { UserStore } from "../store";
import { docKey, pathTurns } from "./history";
import { textHash } from "./lumiverse-db";
import type { Today } from "./today";

/** What a run did with these things. */
export interface TurnThingsCarried {
  /** False: the run was not given the turn lane's tables, and none of these was written. */
  tables: boolean;
  /** Panel requests put onto the turn that answered each. */
  requests: number;
  /** Requests on a message whose reply has no turn here (never played, or a chat's shared turn the chat it was made from carries): in the backup only. */
  requestsUnplaced: { chat: string; message: string; why: string }[];
  /** Stored chips and review cards put onto their turns. */
  chips: number;
  /** Of those, the ones on no turn (their message has none): kept with the chat. */
  chipsLoose: number;
  /** Changes staged for the next message, now waiting as held requests. */
  staged: number;
  /** Tools approved for a chat, kept as history on a turn. */
  approvals: number;
}

const FROM = ["palette", "map", "panel", "chip", "send-now", "command"] as const;

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

const tableThere = (db: Database, name: string): boolean => db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== null;

/** The held request a chat's staged change of the previous build is carried as. */
const stagedId = (chat: string): string => `carried:${chat}:staged`;

/**
 * Whether a chat's carried staged change waits no longer: a turn that still stands took it with his next message, or he dropped it (its
 * request is gone). It waits while its request is held, or while the turn that took it was dropped (the request waits again).
 */
export function stagedTaken(db: Database, user: string, chat: string): boolean {
  if (!tableThere(db, "request")) return false;
  const row = db.query<{ turn: string | null; status: string | null }, [string, string]>("SELECT r.turn, t.status FROM request r LEFT JOIN turn t ON t.user = r.user AND t.id = r.turn WHERE r.user = ? AND r.id = ?").get(user, stagedId(chat));
  return row === null || (row.turn !== null && row.status !== null && row.status !== "dropped");
}

/**
 * Carries these things of `chats` (the chats this run imported or replaced) into the turn lane's tables, inside one transaction.
 * `s` is the user's store holding the imported turns, which says what turn each reply is tied to.
 */
export async function carryTurnThings(input: { today: Today; db: Database; s: UserStore; chats: readonly string[]; now: number }): Promise<TurnThingsCarried> {
  const { today, db, s, now } = input;
  const out: TurnThingsCarried = { tables: tableThere(db, "request") && tableThere(db, "chip"), requests: 0, requestsUnplaced: [], chips: 0, chipsLoose: 0, staged: 0, approvals: 0 };
  if (!out.tables) return out;
  const user = s.id;
  const panels = today.db.engineMessages(LEDGER_NAMESPACE).filter((m) => m.isUser && isRecord(m.metadata[LEDGER_NAMESPACE]) && typeof m.metadata[LEDGER_NAMESPACE].action === "string");
  /** Everything read before anything is written, so the write is one transaction that cannot fail half way for want of a file. */
  const wrote: (() => void)[] = [];
  for (const chat of [...input.chats].sort()) {
    const { messages, swipes } = today.db.messages(chat);
    const index = new Map(messages.map((m, i) => [m.id as string, i]));
    /** The turn a reply's swipe was played as: the one tied to the hash of that swipe's text, else the first made for the message; null where it has none, and for a turn of the chat this one was branched from, which that chat carries. */
    const turnOf = (message: string, swipe: number): string | null => {
      const turns = s.swipes(chat, message);
      const m = messages[index.get(message) ?? -1];
      const hash = m === undefined || m.swipes[swipe] === undefined ? null : textHash(m.swipes[swipe] as string);
      const turn = turns.find((t) => hash !== null && t.hash === hash) ?? turns[0];
      return turn === undefined || turn.chat !== chat ? null : turn.id;
    };
    /** When a swipe was written, in milliseconds as the turn lane's tables keep a time (Lumiverse dates a swipe in seconds); 0 for one with no date. */
    const dateOf = (message: string, swipe: number): number => (swipes.get(message)?.dates[swipe] ?? 0) * 1000;

    wrote.push(() => {
      db.run("DELETE FROM chip WHERE user = ? AND chat = ? AND source = 'import'", [user, chat]);
      db.run("DELETE FROM request WHERE user = ? AND chat = ? AND id LIKE 'carried:%'", [user, chat]);
    });

    // What he asked through a panel, on his own message: onto the turn that answered it, as the request he made. A command played at once is a message of its own; one staged and sent with his words went with that message.
    for (const m of panels.filter((p) => p.chatId === chat)) {
      const head = m.metadata[LEDGER_NAMESPACE] as JsonObject;
      const at = index.get(m.id);
      const reply = at === undefined ? undefined : messages[at + 1];
      if (reply === undefined || reply.isUser) {
        out.requestsUnplaced.push({ chat, message: m.id, why: "no reply followed it" });
        continue;
      }
      const turn = turnOf(reply.id, 0);
      if (turn === null) {
        out.requestsUnplaced.push({ chat, message: m.id, why: s.swipes(chat, reply.id).length === 0 ? "the reply it asked for has no turn: it was never played" : "the turn is the chat it was branched from's, which carries it" });
        continue;
      }
      const staged = head.staged === true;
      const source = text(head.source);
      const asked = { action: text(head.action), values: isRecord(head.params) ? head.params : {}, from: FROM.find((f) => f === source) ?? "panel", what: text(head.text) ?? (text(head.action) as string), on: null };
      const id = `carried:${chat}:${m.id}`;
      const when = dateOf(m.id, 0) || dateOf(reply.id, 0);
      wrote.push(() => db.run("INSERT OR REPLACE INTO request (user, id, chat, kind, asked, played, message, turn, at) VALUES (?, ?, ?, 'panel', ?, ?, ?, ?, ?)", [user, id, chat, JSON.stringify(asked), staged ? 0 : 1, staged ? null : m.id, turn, when]));
      out.requests++;
    }

    // Each stored chip and review card, on the turn its message and swipe were played as, with what it held: its items and their statuses.
    const chips = await today.userView.json(`runs/${chat}/chips.json`);
    for (const chip of Array.isArray(chips) ? chips : []) {
      if (!isRecord(chip) || text(chip.id) === null || text(chip.kind) === null || text(chip.messageId) === null) continue;
      const message = chip.messageId as string;
      const at = index.get(message);
      const swipe = typeof chip.swipeId === "number" ? chip.swipeId : (messages[at ?? -1]?.swipeId ?? 0);
      // A chip on his own message belongs to the turn that answered it.
      const onReply = at !== undefined && messages[at]?.isUser === true ? messages[at + 1] : messages[at ?? -1];
      const turn = onReply === undefined || onReply.isUser ? null : turnOf(onReply.id, onReply === messages[at ?? -1] ? swipe : 0);
      const id = `carried:${chat}:${chip.id as string}`;
      wrote.push(() => db.run("INSERT OR REPLACE INTO chip (user, id, chat, turn, kind, data, at, source) VALUES (?, ?, ?, ?, ?, ?, ?, 'import')", [user, id, chat, turn, chip.kind as string, JSON.stringify(chip), dateOf(message, swipe)]));
      out.chips++;
      if (turn === null) out.chipsLoose++;
    }

    // A change staged for the next message waits as a held request that goes with it.
    const staged = await today.userView.json(`runs/${chat}/staged.json`);
    if (isRecord(staged) && text(staged.action) !== null) {
      const source = text(staged.source);
      const asked = { action: staged.action as string, values: isRecord(staged.request) ? staged.request : {}, from: FROM.find((f) => f === source) ?? "panel", what: text(staged.label) ?? (staged.action as string), on: null };
      wrote.push(() => db.run("INSERT OR REPLACE INTO request (user, id, chat, kind, asked, played, message, turn, at) VALUES (?, ?, ?, 'panel', ?, 0, NULL, NULL, ?)", [user, stagedId(chat), chat, JSON.stringify(asked), now]));
      out.staged++;
    }

    // The tools he approved for this chat, each on the turn that was running when he said so: the last whose reply is dated by then, else the first.
    const kept = await today.userView.json(`harness/docs/chats/${docKey(chat)}/approvals.json`);
    if (isRecord(kept) && Array.isArray(kept.tools)) {
      const turns = pathTurns(db, s, chat).map((p) => p.turn);
      const times = isRecord(kept.at) ? kept.at : {};
      for (const tool of kept.tools) {
        if (typeof tool !== "string") continue;
        const at = typeof times[tool] === "number" ? times[tool] : null;
        const turn = (at === null ? undefined : turns.findLast((t) => t.date !== null && t.date * 1000 <= at)) ?? turns[0];
        wrote.push(() => db.run("INSERT OR REPLACE INTO chip (user, id, chat, turn, kind, data, at, source) VALUES (?, ?, ?, ?, 'approval', ?, ?, 'import')", [user, `carried:${chat}:approval:${tool}`, chat, turn?.id ?? null, JSON.stringify({ tool, approvedFor: "chat" }), at ?? 0]));
        out.approvals++;
      }
    }
  }
  db.transaction(() => {
    for (const write of wrote) write();
  })();
  return out;
}
