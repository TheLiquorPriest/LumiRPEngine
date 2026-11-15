// What the model was sent (STANDALONE-PLAN §17.1 l.1764; PlanGates-4, PlanGates-4-fix1 items 8 and 9):
// "The Author's first request, as recorded at the model layer, contains every message Lumiverse sent
// that the window kept, in the same order with the same roles, right after the opening block." Two
// records of one RPE turn are laid side by side: the request RPH kept for the lead's first call (its
// `trace.requests` file) and the prompt Lumiverse stored beside the reply. Each message missing, extra,
// out of order, sent with another role, or sent though the window left it out is named, so a failing
// turn says what went wrong and where. Pure: the floor's script reads both records and the chat's rows,
// and calls this.
//
// How the two texts compare. RPH keeps each message as its role and its text: a system message's text
// is its content and sections, any other message's its text parts joined by a line break (rp-harness
// `src/harness/requests.ts:5-8`, `:22-24`; pi-ai `dist/utils/text.js:2-18`). Lumiverse stores each
// message's content with its text parts joined by nothing, a picture or any other part giving no text
// (`src/services/generate.service.ts:4451-4459`), and stores the messages it sent, after the
// interceptors and its post-processing (`src/services/generate.service.ts:1237-1256`, `:2898`).
//
// Everything the comparison normalises or does not judge, and nothing more:
// - Line breaks are set aside only inside a joined message: a stored user message found to stand for
//   more than one of the chat's rows may differ from the request's by line breaks alone. Every other
//   message's text, any role, must be the same.
// - The framing line that introduces the prompt (plan §10.2 l.1160; R-101 as corrected) is accepted in
//   exactly one place: immediately before Lumiverse's first message, right after the opening block, as a
//   system message of the text RPH renders, or as RPH's marked note of that text where the provider
//   refuses a system message there. Anywhere else it fails and is named. Its text is compared with the
//   ends of both texts trimmed, as RPH's own `joined` trims it.
// - The opening block's content is not judged: the request's leading system message that is neither
//   Lumiverse's nor the framing line is taken as the opening block.
// - A message after the last of Lumiverse's passes only when the kept request names it as RPH's own
//   block (the session's carry, the briefing: its `block`); any other is an extra and fails.
// - A stored message whose content is not text is named "not text: not compared", never taken as empty,
//   and leaves the turn not judged unless something else fails it; a request message with no text (pi's
//   text of a message of pictures alone) is taken as one such message's, as many as there are.
// - With the hold on, the turn is judged only when the caller gives the story record's reach for it.
//
// Where the prompt starts. The opening block is the request's leading system message: pi folds the
// agent's instructions and its tools into one (pi-ai `dist/utils/transcript.js:6-27`; rp-harness
// `src/loop/runner.ts:201`), and RPH keeps the call's messages with it (`src/loop/runner.ts:379`). The
// framing line stands right after it, where RPH places it (rp-harness `src/harness/turn.ts:405-410`).
//
// Chat history and the window. RPE keeps the latest X of the chat's messages (plan §4.2 l.229), and with
// a step S the window holds X to X+S messages, both ends, the turn that would hold X+S+1 cut back to X
// (READINGS R-95): the script holds RPE to that reading, never to RPE's own code. The extension normally
// leaves the older messages out before Lumiverse sends, so the stored prompt holds just what was sent;
// when RPE made the cut itself on receipt (l.225, l.230) the stored prompt holds older history that the
// request rightly lacks. The chat's rows tell those from a real miss: a stored message that is a row's
// text is chat history; rows are counted back from the newest one the stored prompt holds (so the
// reply's own row, read after the reply, counts for nothing); a hidden row is neither in the prompt nor
// counted (R-21; `src/services/prompt-assembly.service.ts:3273`). Lumiverse joins the consecutive user
// messages of the history into one, their texts parted by a blank line, keeping the first one's id and
// number (`src/services/prompt-assembly.service.ts:3456-3461`, `:6754-6843`, the join at `:6788`, the
// number at `:6806-6818`): such a message stands for every row it joined, each counting toward X, and
// since it goes by its first row's number the window keeps it only when that row is inside. A history
// message whose text Lumiverse changed on the way (a macro, a name in front, a summary in its place:
// `src/services/prompt-assembly.service.ts:3286-3326`) is not recognised as its row, so it is held to be
// owed: the check can fail on it, never pass on it wrongly. With the hold on (§4.2 l.235), a message does
// not leave until the story record covers it, for at most the cap more: the window reaches back to the
// oldest row the record does not cover (its reach), never past the cap.

/** A message of the request RPH kept for a model call: pi's role (`system`, `user`, `assistant`, `toolResult`), its text, and the RPH block the file names it as, where it names one. */
export interface RequestMessage {
  role: string;
  text: string;
  block?: string | null;
}

/** A message of the prompt Lumiverse stored with the reply (`GET /api/v1/generate/breakdown/:messageId`, field `messages`; `src/routes/generate.routes.ts:175-181`): its role and its content, null where the content is not text. */
export interface StoredMessage {
  role: string;
  content: string | null;
}

/** One of the chat's saved rows: its role as Lumiverse gives a saved message (`src/utils/message-role.ts:4-5`), its text, and whether it is hidden (`extra.hidden`). */
export interface ChatRow {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  hidden: boolean;
}

export interface SentInput {
  /** The lead's first request as RPH kept it, its messages in order. */
  request: readonly RequestMessage[];
  /** The prompt Lumiverse stored with the reply, in order. */
  stored: readonly StoredMessage[];
  /** The chat's saved rows in order from its first message; the reply's own row may be among them. Without them, nothing is taken as left out by the window. */
  rows?: readonly ChatRow[];
  /** RPE's `history.window` for the chat: the latest this many messages are kept. Null or absent keeps every one. */
  keep?: number | null;
  /** RPE's `history.step`: the window holds `keep` to `keep` plus this, both ends (R-95). Null or absent: off. */
  step?: number | null;
  /** RPE's `history.hold.cap` when `history.hold.on` is set: the window may reach back this many messages more. Null or absent: the hold is off. */
  hold?: number | null;
  /** With the hold on: how many of the chat's visible rows, from its first, the story record covers for the turn. Null or absent: not given, and the turn is not judged. */
  reach?: number | null;
  /** The framing line's text as RPH renders it (`frame.ts`), and as RPH's model layer marks it when sent as a note. */
  framing?: string | null;
  framingNote?: string | null;
}

/** A message named in a verdict. */
export interface Named {
  /** Its place in its own list, from 1: the stored prompt's for a stored message; the request's, the opening block being 1, for a sent one. */
  place: number;
  role: string;
  /** The first 80 characters of its text. */
  text: string;
  /** The chat rows it stands for, oldest first, when it is chat history: more than one for a joined message. */
  rows?: string[];
}

/** A stored message, and where the request has it. */
export interface Moved {
  stored: Named;
  sent: Named;
}

/** A stored message found to be chat history. */
export interface HistoryMessage {
  /** Its place in the stored prompt, from 1. */
  place: number;
  /** The rows it stands for, oldest first. */
  rows: string[];
  /** Kept by the window, and so owed to the request; false: the window left it out. */
  kept: boolean;
}

export interface SentVerdict {
  /** Judged, and nothing wrong. */
  pass: boolean;
  /** Something is wrong: it fails whatever could not be judged. */
  faulty: boolean;
  /** Why it could not be judged whole; empty when it could. */
  unjudged: string[];
  /** One line for the floor's table, in plain words. */
  words: string;
  /** The request leads with an opening block: a system message that is neither one Lumiverse sent nor the framing line. */
  opening: boolean;
  /** The framing line stood immediately before the prompt (looked for only when its text is given). */
  framed: boolean;
  /** Lumiverse's prompt starts right after the opening block, and after the framing line when there is one. */
  startsAfterOpening: boolean;
  /** Why it does not, in plain words; null when it does. */
  startWhy: string | null;
  /** Stored messages the window kept that the request does not have. */
  missing: Named[];
  /** Request messages among Lumiverse's that are not Lumiverse's. */
  extra: Named[];
  /** The framing line anywhere but immediately before the prompt. */
  framingAt: Named[];
  /** Request messages after Lumiverse's last that the kept request does not name as RPH's own. */
  unnamed: Named[];
  /** Stored messages the request has out of their order. */
  reordered: Moved[];
  /** Stored messages the request has in their place, with another role. */
  roles: Moved[];
  /** Stored messages the window left out that the request has all the same. */
  beyond: Moved[];
  /** Stored messages the window left out, with the rows they stand for. */
  leftOut: Named[];
  /** Stored messages whose content is not text: not compared. */
  notText: Named[];
  /** Every stored message found to be chat history, with the rows it stands for and whether the window kept it. */
  history: HistoryMessage[];
  /** How many stored messages the window kept: the ones the request must hold. */
  owed: number;
  /** How many of those the request holds in their order, with their roles. */
  inOrder: number;
}

/** The planner's ask: each named message shown by "the first 80 characters of its text". */
const EXCERPT = 80;

/** What Lumiverse puts between two queued user messages it joins (`src/services/prompt-assembly.service.ts:6788`). */
const JOIN = "\n\n";

/** A stretch of a list, both ends inside it. */
interface Stretch {
  from: number;
  to: number;
}

/** The rows a stored message stands for: the stretch of the visible rows, and their ids. */
interface RowsOf extends Stretch {
  ids: string[];
}

/** What the window does with a stored message: owes it, leaves it out, may hold it (the hold on, no reach given), or cannot say (its content is not text). */
type Keeping = "kept" | "band" | "out" | "untext";

function listed<T>(map: Map<string, T[]>, key: string): T[] {
  let list = map.get(key);
  if (list === undefined) {
    list = [];
    map.set(key, list);
  }
  return list;
}

/** The first characters of a text, counted by code point so no character is cut in two. */
function excerpt(text: string): string {
  let out = "";
  let count = 0;
  for (const ch of text) {
    if (count === EXCERPT) break;
    out += ch;
    count++;
  }
  return out;
}

/** Whether `stored` is `sent` with some of its line breaks taken out. */
function lessBreaks(sent: string, stored: string): boolean {
  if (sent.length < stored.length) return false;
  let j = 0;
  for (let i = 0; i < sent.length; i++) {
    if (j < stored.length && sent.charCodeAt(i) === stored.charCodeAt(j)) j++;
    else if (sent.charCodeAt(i) !== 10) return false;
  }
  return j === stored.length;
}

/** Whether a sent message's text is a stored message's content: the same, or for a joined user message the same but for line breaks. */
function sameText(message: RequestMessage, content: string, joined: boolean): boolean {
  return message.text === content || (joined && message.role === "user" && lessBreaks(message.text, content));
}

/** A text with its line breaks taken out: two texts the same by `sameText` are the same by this. */
const unbroken = (text: string): string => text.replaceAll("\n", "");

/**
 * The most items of a first list matched to stretches of a second, both lists' order kept and no two
 * stretches overlapping; `options[k]` are the stretches item k may stand for. A longest common
 * subsequence, found from the matches alone (Hunt and Szymanski's way), so a long chat costs only its
 * matches. Among chains as long, the one whose stretches end earliest.
 */
function longestChain(options: readonly (readonly Stretch[])[]): (Stretch | undefined)[] {
  interface Link {
    k: number;
    stretch: Stretch;
    prev: Link | undefined;
  }
  // ends[n] is the smallest end of any chain of n + 1 items found so far, and tails[n] that chain's last link.
  const ends: number[] = [];
  const tails: Link[] = [];
  options.forEach((list, k) => {
    // The latest start first: an item's own stretches then never chain onto each other.
    for (const stretch of [...list].sort((a, b) => b.from - a.from)) {
      let lo = 0;
      let hi = ends.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((ends[mid] as number) < stretch.from) lo = mid + 1;
        else hi = mid;
      }
      const link: Link = { k, stretch, prev: lo > 0 ? tails[lo - 1] : undefined };
      if (lo === ends.length) {
        ends.push(stretch.to);
        tails.push(link);
      } else if (stretch.to < (ends[lo] as number)) {
        ends[lo] = stretch.to;
        tails[lo] = link;
      }
    }
  });
  const out: (Stretch | undefined)[] = options.map(() => undefined);
  for (let link = tails.at(-1); link !== undefined; link = link.prev) out[link.k] = link.stretch;
  return out;
}

/** The last of the user rows from `first` on whose texts, joined as Lumiverse joins queued messages, make `content`; `cut` is where the first row's text ends in it. */
function joinedTo(content: string, visible: readonly ChatRow[], first: number, cut: number): number | undefined {
  let at = cut;
  for (let j = first + 1; j < visible.length && visible[j]?.role === "user"; j++) {
    if (!content.startsWith(JOIN, at)) return undefined;
    at += JOIN.length;
    const text = (visible[j] as ChatRow).content;
    if (!content.startsWith(text, at)) return undefined;
    at += text.length;
    if (at === content.length) return j;
  }
  return undefined;
}

/** For each stored message, the visible rows it stands for when it is chat history. */
function historyOf(stored: readonly StoredMessage[], rows: readonly ChatRow[]): (RowsOf | undefined)[] {
  const visible = rows.filter((row) => !row.hidden);
  const last = visible.length - 1;
  const byText = new Map<string, number[]>();
  const userLengths = new Set<number>();
  visible.forEach((row, i) => {
    listed(byText, `${row.role}\u0000${row.content}`).push(i);
    if (row.role === "user") userLengths.add(row.content.length);
  });
  const options = stored.map((message): Stretch[] => {
    const content = message.content;
    // An empty text, or one that is not text, names no row.
    if (content === null || content === "") return [];
    const found = (byText.get(`${message.role}\u0000${content}`) ?? []).map((i) => ({ from: i, to: i }));
    if (message.role !== "user") return found;
    // A joined message starts with its first row's text and a blank line: each blank line in it is tried as that end.
    for (let cut = content.indexOf(JOIN); cut !== -1; cut = content.indexOf(JOIN, cut + 1)) {
      if (!userLengths.has(cut)) continue;
      for (const first of byText.get(`user\u0000${content.slice(0, cut)}`) ?? []) {
        const to = joinedTo(content, visible, first, cut);
        if (to !== undefined) found.push({ from: first, to });
      }
    }
    return found;
  });
  // Among matchings as long, the one on the newest rows, since a prompt holds the latest of a chat: the
  // chain is found with both lists turned round, then turned back.
  const turned = longestChain([...options].reverse().map((list) => list.map(({ from, to }) => ({ from: last - to, to: last - from }))));
  return stored.map((_, k) => {
    const stretch = turned[stored.length - 1 - k];
    if (stretch === undefined) return undefined;
    const from = last - stretch.to;
    const to = last - stretch.from;
    return { from, to, ids: visible.slice(from, to + 1).map((row) => row.id) };
  });
}

function whole(value: number | null | undefined, least: number, what: string): void {
  if (value != null && !(Number.isInteger(value) && value >= least)) throw new RangeError(`The history window's ${what} must be a whole number of at least ${least}; it is ${value}.`);
}

/**
 * The place, among the visible rows, of the first one the window keeps out of `count`: the latest
 * `keep`; with a step, R-95's window, which holds `keep` to `keep + step` messages, both ends, and is
 * cut back to `keep` by the message that would make it `keep + step + 1`.
 */
export function windowStart(count: number, keep: number, step: number | null): number {
  if (count <= keep) return 0;
  return step === null ? count - keep : count - (keep + ((count - keep) % (step + 1)));
}

/** What the window does with each stored message, by the rows it stands for; and the ones kept only by the step, to name where RPE's window departs from R-95. */
function keepingOf(stored: readonly StoredMessage[], found: readonly (RowsOf | undefined)[], input: SentInput): { keeping: Keeping[]; byStep: Set<number> } {
  const keeping: Keeping[] = stored.map((m) => (m.content === null ? "untext" : "kept"));
  const byStep = new Set<number>();
  const keep = input.keep;
  if (keep == null) return { keeping, byStep };
  let newest = -1;
  for (const rows of found) if (rows !== undefined && rows.to > newest) newest = rows.to;
  if (newest < 0) return { keeping, byStep };
  const count = newest + 1;
  const first = windowStart(count, keep, input.step ?? null);
  const hold = input.hold ?? null;
  const reach = input.reach ?? null;
  // The hold reaches back to the oldest row the record does not cover, at most `hold` rows before the window.
  const from = hold === null ? first : reach === null ? null : Math.max(first - hold, Math.min(first, reach));
  found.forEach((rows, k) => {
    if (rows === undefined || keeping[k] === "untext") return;
    if (from === null) keeping[k] = rows.from >= first ? "kept" : rows.from >= first - (hold as number) ? "band" : "out";
    else keeping[k] = rows.from >= from ? "kept" : "out";
    if (keeping[k] === "kept" && rows.from >= first && rows.from < count - keep) byStep.add(k);
  });
  return { keeping, byStep };
}

const quoted = (named: Named): string => `${named.role} "${named.text.replace(/\s+/g, " ").trim()}"`;

function wordsOf(v: Omit<SentVerdict, "words">, why: { keep: number | null; step: number | null; byStep: ReadonlySet<number> }): string {
  if (v.pass) {
    const all = `All ${v.owed} message${v.owed === 1 ? "" : "s"} Lumiverse sent that the window kept ${v.owed === 1 ? "is" : "are"} in the Author's first request, in order, with ${v.owed === 1 ? "its role" : "their roles"}, right after the opening block${v.framed ? " and its framing line" : ""}`;
    return v.leftOut.length === 0 ? all : `${all}; the window left out ${v.leftOut.length} older message${v.leftOut.length === 1 ? "" : "s"}`;
  }
  const notJudged = v.unjudged.length > 0 ? `not judged: ${v.unjudged.join("; ")}` : "";
  if (!v.faulty) return `Not judged: ${v.unjudged.join("; ")}`;
  const step = (m: Named) => (why.step !== null && why.byStep.has(m.place - 1) ? ` (R-95: a window of ${why.keep} with a step of ${why.step} holds it; RPE's window departs from that reading)` : "");
  const faults = [
    ...(v.startWhy === null ? [] : [v.startWhy]),
    ...v.missing.map((m) => `missing: stored ${m.place}, ${quoted(m)}${step(m)}`),
    ...v.extra.map((m) => `extra: sent ${m.place}, ${quoted(m)}`),
    ...v.framingAt.map((m) => `the framing line, sent ${m.place}, is not immediately before the prompt`),
    ...v.unnamed.map((m) => `extra after the prompt: sent ${m.place}, ${quoted(m)}, which the kept request does not name as RPH's own`),
    ...v.reordered.map(({ stored, sent }) => `out of order: stored ${stored.place}, ${quoted(stored)}, sent ${sent.place}${sent.role === stored.role ? "" : ` as ${sent.role}`}`),
    ...v.roles.map(({ stored, sent }) => `another role: stored ${stored.place}, ${quoted(stored)}, sent ${sent.place} as ${sent.role}`),
    ...v.beyond.map(({ stored, sent }) => `sent though the window left it out: stored ${stored.place}, ${quoted(stored)}, sent ${sent.place}`),
  ];
  return `Not as Lumiverse sent it: ${faults.join("; ")}${notJudged === "" ? "" : `; ${notJudged}`}`;
}

/** One RPE turn: the lead's first request against the prompt Lumiverse stored with the reply. */
export function compareSent(input: SentInput): SentVerdict {
  const { request: sent, stored } = input;
  whole(input.keep, 1, "size");
  whole(input.step, 1, "step");
  whole(input.hold, 0, "hold");
  whole(input.reach, 0, "reach");
  // An empty frame part puts no framing line in the request (rp-harness `src/harness/turn.ts:406-407`).
  const framing = input.framing?.trim() || undefined;
  const note = input.framingNote?.trim() || undefined;
  const isFraming = (m: RequestMessage | undefined): boolean => m !== undefined && ((framing !== undefined && m.role === "system" && m.text.trim() === framing) || (note !== undefined && m.text.trim() === note));

  const found = input.rows === undefined ? stored.map(() => undefined) : historyOf(stored, input.rows);
  const joined = (k: number): boolean => (found[k]?.ids.length ?? 0) > 1;
  const textOf = (k: number): string => (stored[k] as StoredMessage).content ?? "";

  // Where Lumiverse's prompt should start: after the opening block, and the framing line if one is there.
  const lead = sent[0];
  const leadIsLumiverses = lead !== undefined && stored.some((s, k) => s.content !== null && s.role === lead.role && sameText(lead, s.content, joined(k)));
  const opening = lead !== undefined && lead.role === "system" && !isFraming(lead) && !leadIsLumiverses;
  let start = opening ? 1 : 0;
  const framed = isFraming(sent[start]);
  if (framed) start++;

  const { keeping, byStep } = keepingOf(stored, found, input);
  const unjudged: string[] = [];
  const holdOn = input.hold != null;
  if (holdOn && input.reach == null) unjudged.push("the hold is on, and no reach of the story record was given for the turn, so which older messages it keeps is not known");

  const storedNamed = (k: number): Named => {
    const rows = found[k]?.ids;
    return { place: k + 1, role: (stored[k] as StoredMessage).role, text: (stored[k] as StoredMessage).content === null ? "not text" : excerpt(textOf(k)), ...(rows === undefined ? {} : { rows }) };
  };
  const sentNamed = (j: number): Named => {
    const message = sent[j] as RequestMessage;
    return { place: j + 1, role: message.role, text: excerpt(message.text) };
  };
  const notText = stored.flatMap((_, k) => (keeping[k] === "untext" ? [storedNamed(k)] : []));
  if (notText.length > 0) unjudged.push(`not text: not compared: stored ${notText.map((m) => `${m.place} (${m.role})`).join(", ")}`);

  // Lumiverse's messages the request owes, matched in order to the request's after its head, by role
  // and text.
  const owed = stored.flatMap((_, k) => (keeping[k] === "kept" ? [k] : []));
  const byRole = new Map<string, number[]>();
  const byText = new Map<string, number[]>();
  for (let j = start; j < sent.length; j++) {
    const message = sent[j] as RequestMessage;
    const text = unbroken(message.text);
    listed(byRole, `${message.role}\u0000${text}`).push(j);
    listed(byText, text).push(j);
  }
  const chain = longestChain(
    owed.map((k) => {
      const message = stored[k] as StoredMessage;
      return (byRole.get(`${message.role}\u0000${unbroken(textOf(k))}`) ?? []).filter((j) => sameText(sent[j] as RequestMessage, textOf(k), joined(k))).map((j) => ({ from: j, to: j }));
    }),
  );
  const at = chain.map((stretch) => stretch?.from);
  const inOrder = at.filter((j) => j !== undefined).length;
  const claimed = new Set<number>();
  for (const j of at) if (j !== undefined) claimed.add(j);
  /** The first request message after `lo` and before `hi` not yet accounted for whose text is stored message k's. */
  const partner = (k: number, lo: number, hi: number): number | undefined => (byText.get(unbroken(textOf(k))) ?? []).find((j) => j > lo && j < hi && !claimed.has(j) && sameText(sent[j] as RequestMessage, textOf(k), joined(k)));

  // A message the order left unmatched is in its place with another role when its text stands between
  // its matched neighbours: with its own role there, the order would have matched it.
  const roles: Moved[] = [];
  const next: number[] = [];
  let after = sent.length;
  for (let e = owed.length - 1; e >= 0; e--) {
    next[e] = after;
    const j = at[e];
    if (j !== undefined) after = j;
  }
  let before = start - 1;
  owed.forEach((k, e) => {
    const matched = at[e];
    if (matched !== undefined) {
      before = matched;
      return;
    }
    const j = partner(k, before, next[e] as number);
    if (j === undefined) return;
    claimed.add(j);
    at[e] = j;
    before = j;
    roles.push({ stored: storedNamed(k), sent: sentNamed(j) });
  });

  // Lumiverse's messages run from the prompt's start to the last one sent in its place; RPH's own blocks follow.
  let end = start - 1;
  for (const j of at) if (j !== undefined && j > end) end = j;

  const reordered: Moved[] = [];
  const missing: Named[] = [];
  owed.forEach((k, e) => {
    if (at[e] !== undefined) return;
    const j = partner(k, start - 1, sent.length);
    if (j === undefined) missing.push(storedNamed(k));
    else {
      claimed.add(j);
      reordered.push({ stored: storedNamed(k), sent: sentNamed(j) });
    }
  });

  const beyond: Moved[] = [];
  const leftOut: Named[] = [];
  keeping.forEach((k, i) => {
    if (k === "band") {
      // Held or not, only the story record knows: it is neither owed nor sent wrongly.
      const j = partner(i, start - 1, sent.length);
      if (j !== undefined) claimed.add(j);
      return;
    }
    if (k !== "out") return;
    const j = partner(i, start - 1, sent.length);
    if (j === undefined) leftOut.push(storedNamed(i));
    else {
      claimed.add(j);
      beyond.push({ stored: storedNamed(i), sent: sentNamed(j) });
    }
  });

  // A message of pictures alone leaves no text on either side: as many textless request messages as stored messages that are not text are theirs, not compared.
  let textless = notText.length;
  for (let j = start; j < sent.length && textless > 0; j++) {
    if (claimed.has(j) || (sent[j] as RequestMessage).text.trim() !== "") continue;
    claimed.add(j);
    textless--;
  }

  const extra: Named[] = [];
  const framingAt: Named[] = [];
  const unnamed: Named[] = [];
  for (let j = 0; j < sent.length; j++) {
    if (claimed.has(j) || j === 0 || (framed && j === start - 1)) continue;
    const message = sent[j] as RequestMessage;
    if (isFraming(message)) framingAt.push(sentNamed(j));
    else if (j < start) continue;
    else if (j <= end) extra.push(sentNamed(j));
    else if (typeof message.block !== "string" || message.block === "") unnamed.push(sentNamed(j));
  }

  let startWhy: string | null = null;
  if (stored.length === 0) startWhy = "Lumiverse's stored prompt holds no message";
  else if (lead === undefined) startWhy = "the request holds no message";
  else if (!opening) {
    startWhy = `the request has no opening block: it starts with ${isFraming(lead) ? "the framing line" : leadIsLumiverses ? `a message Lumiverse sent, ${quoted(sentNamed(0))}` : `sent 1, ${quoted(sentNamed(0))}`}`;
  } else if (owed.length > 0 && !claimed.has(start)) {
    startWhy = sent[start] === undefined ? "nothing follows the opening block" : `sent ${start + 1}, ${quoted(sentNamed(start))}, stands between the opening block and the prompt`;
  }

  const history = found.flatMap((rows, k) => (rows === undefined ? [] : [{ place: k + 1, rows: rows.ids, kept: keeping[k] === "kept" }]));
  const faulty = startWhy !== null || missing.length > 0 || extra.length > 0 || framingAt.length > 0 || unnamed.length > 0 || reordered.length > 0 || roles.length > 0 || beyond.length > 0;
  const verdict = { pass: !faulty && unjudged.length === 0, faulty, unjudged, opening, framed, startsAfterOpening: startWhy === null, startWhy, missing, extra, framingAt, unnamed, reordered, roles, beyond, leftOut, notText, history, owed: owed.length, inOrder };
  return { ...verdict, words: wordsOf(verdict, { keep: input.keep ?? null, step: input.step ?? null, byStep }) };
}

/** One RPE turn of a run, compared or not. */
export interface TurnSent {
  turn: string;
  /** Its verdict; null when it could not be compared. */
  verdict: SentVerdict | null;
  /** Why it could not be compared; null when it was. */
  why: string | null;
}

/** The floor's row from every RPE turn of a run. */
export interface SentFold {
  verdict: "pass" | "fail" | "not judged";
  measured: string;
  /** Each failing turn with what was wrong in it, then each turn that could not be judged, with why. */
  notes: string[];
  /** Why the row is not judged; empty when it is judged. */
  why: string[];
}

/**
 * The row over every RPE turn: each must pass. One that failed fails the row, whatever else; a turn
 * that could not be compared, or not judged whole, leaves the row unjudged rather than passed, and so
 * does a run with none.
 */
export function sentFold(turns: readonly TurnSent[]): SentFold {
  const failing = turns.flatMap((t) => (t.verdict !== null && t.verdict.faulty ? [{ turn: t.turn, words: t.verdict.words }] : []));
  const unread = turns.flatMap((t) => (t.verdict === null ? [{ turn: t.turn, why: t.why ?? "no reason was given" }] : !t.verdict.faulty && !t.verdict.pass ? [{ turn: t.turn, why: t.verdict.unjudged.join("; ") }] : []));
  const passed = turns.length - unread.length - failing.length;
  const verdict = failing.length > 0 ? "fail" : unread.length > 0 || turns.length === 0 ? "not judged" : "pass";
  const measured =
    turns.length === 0
      ? "no RPE turn to compare"
      : `${passed} of ${turns.length} RPE turn${turns.length === 1 ? "" : "s"} held every message Lumiverse sent that the window kept, in order, with their roles, right after the opening block${unread.length > 0 ? `; ${unread.length} could not be judged` : ""}`;
  const notes = [...failing.map((t) => `turn ${t.turn}: ${t.words}`), ...unread.map((t) => `turn ${t.turn} could not be judged: ${t.why}`), ...(turns.length === 0 ? ["the run gave no RPE turn to compare"] : [])];
  const why = verdict !== "not judged" ? [] : turns.length === 0 ? ["the run gave no RPE turn to compare"] : [...new Set(unread.map((t) => t.why))].map((w) => `${unread.filter((t) => t.why === w).length} RPE turn(s): ${w}`);
  return { verdict, measured, notes, why };
}
