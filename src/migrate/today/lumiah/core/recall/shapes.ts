// Carried unchanged from LumiAH (MIT; notice in THIRD-PARTY-NOTICES.md), src/core/recall/shapes.ts at commit 6a38779a5e33fe563f0c8c617640343473617569.

// What §24 hands the trace and the page (DESIGN §24.1, §24.3, §24.5, §24.7): plain JSON, so each can
// be an event of the trace or the answer to a request over the link. The tools' answers are text and
// are not here.

// ---------------------------------------------------------------- what the prompt held (§24.1)

/** How an entry got into the prompt, as Lumiverse says: a key that matched (which, only where Lumiverse names it), a vector match (its score where Lumiverse gave one), always on (its book sends it every time), or unknown where Lumiverse says nothing of it. Nothing here is worked out from the chat. */
export type HeldWhy = { by: "key"; key: string | null } | { by: "vector"; score: number | null } | { by: "constant" } | { by: "unknown" };

/** A lore entry the prompt holds. */
export interface HeldEntry {
  entryId: string;
  /** Null for an entry of no book that applies to the chat. */
  bookId: string | null;
  title: string;
  /** The length of its text in the prompt, in characters, and as tokens estimated. */
  chars: number;
  tokens: number;
  why: HeldWhy;
  /** The message of the request that holds it, counted from 1; null where a preset's macro put it inside a block, so it has no message of its own. */
  message: number | null;
}

/** A lore entry the prompt doesn't hold, as the index lists it. */
export interface ListedEntry {
  entryId: string;
  bookId: string;
  title: string;
  keys: string[];
  chars: number;
}

/** Something that stands in the prompt for chat messages it doesn't hold: the chat's book (§23), or a block of the preset that carries Lumiverse's summary or its memories. */
export interface HistoryStandIn {
  kind: "book" | "summary" | "memories";
  name: string;
}

/** What the prompt of one generation held of the lore and of the chat. */
export interface PromptHeld {
  lore: HeldEntry[];
  /** The other entries, in the order the main agent was shown them, and how many more there are that it wasn't. */
  index: { listed: ListedEntry[]; more: number };
  history: {
    /** The runs of chat messages the prompt holds word for word, each from its first message's number to its last's. */
    held: [number, number][];
    /** The runs it doesn't. */
    missing: [number, number][];
    stands: HistoryStandIn[];
  };
}

// ---------------------------------------------------------------- the lore the writer sees (§24.3)

/** An entry added to the writer's request, or taken out of it. */
export interface LoreChanged {
  entryId: string;
  bookId: string;
  title: string;
  chars: number;
}

/** What `write_reply` did to the lore the writer sees: for the trace, on the call's result. */
export interface LoreChange {
  added: LoreChanged[];
  dropped: LoreChanged[];
  /** What it was asked and didn't do: the entry (the reference as given, where it names none) and why, in words for the main agent. */
  refused: { entryId: string; reason: string }[];
}

// ---------------------------------------------------------------- the Lore page

/** How an entry stood at the chat's last turn. */
export type LoreState = "in_prompt" | "added" | "dropped" | "not_in_prompt" | "off";

export interface LoreRow {
  entryId: string;
  /** The id the tools show and take. */
  short: string;
  bookId: string;
  title: string;
  keys: string[];
  secondaryKeys: string[];
  chars: number;
  tokens: number;
  enabled: boolean;
  constant: boolean;
  vectorized: boolean;
  state: LoreState;
  why?: HeldWhy;
}

export interface LoreListing {
  books: { id: string; name: string; description: string; entries: number }[];
  entries: LoreRow[];
  /** The turn the states are of; null: no turn of the chat has been answered yet, so no entry is `in_prompt`, `added` or `dropped`. */
  last: { generationId: string; at: number } | null;
}

/** A lore entry a search found, as the page shows it. */
export interface LoreHitView {
  entryId: string;
  short: string;
  bookId: string;
  book: string;
  title: string;
  chars: number;
  state: LoreState;
  constant: boolean;
  score: number;
  /** How it matched: by its words, by its meaning, or both. */
  by: ("word" | "meaning")[];
  /** Where its words matched. */
  fields: ("title" | "key" | "text")[];
  /** The words of the query it holds. */
  words: string[];
  /** How close its meaning is to the query's, from -1 to 1, where it matched by meaning. */
  similarity?: number;
  /** Its best lines, each by its number in the entry's text. */
  lines: { line: number; text: string }[];
}

export interface LoreSearchView {
  queries: { query: string; total: number; hits: LoreHitView[] }[];
  /** Whether matches by meaning were merged in: `off` by the setting, `none` without an embedding connection. */
  meaning: "on" | "off" | "none";
}

// ---------------------------------------------------------------- search by meaning (§24.5)

/** How much of a chat and its lore is embedded, and what it cost. */
export interface EmbedStatus {
  /** The user's embedding connection; null: they have none, and search is by word. */
  connection: { id: string; name: string; model: string; dimensions: number | null } | null;
  /** The setting: off, nothing is embedded even with a connection. */
  enabled: boolean;
  lore: { embedded: number; total: number };
  messages: { embedded: number; total: number };
  /** Texts still to embed. */
  pending: number;
  /** What those texts come to in tokens, as estimated; a text two owners share is counted once. Worked out with the setting off too: it is what switching it on would send. */
  pendingTokens: number;
  /** Texts are being embedded now. */
  working: boolean;
  /** The last 24 hours, against the cap (tokens; null: no cap). `cost` in US dollars; null where no price is set. */
  today: { texts: number; tokens: number; cost: number | null; cap: number | null };
  /** Everything embedded for this user since the count began. */
  all: { texts: number; tokens: number; cost: number | null };
}

// ---------------------------------------------------------------- the chronicle (§24.7)

/**
 * A line of the chronicle with a citation that doesn't hold. `why` says what was compared, not what
 * happened to the chat: `changed`, the chat has a message at the cited number and it doesn't read as
 * cited; `gone`, the chat has no message at that number. Either way no single other message reads
 * as cited: none does, or several do.
 */
export interface ChronicleFailure {
  /** The file, as agents write its path (`learned/chronicle/facts.md`). */
  path: string;
  /** The line's number in the file, from 1. */
  line: number;
  text: string;
  /** The citation that failed, as written. */
  citation: string;
  /** The message number it cites. */
  index: number;
  why: "gone" | "changed";
}

/** A citation whose number is wrong: the message at it doesn't read as cited, and exactly one other message of the chat does, at `now`. `chronicle_check` writes that number into the file. */
export interface ChronicleMoved {
  path: string;
  line: number;
  citation: string;
  index: number;
  now: number;
}

/** The chronicle against the chat as it stands. The check proves that a cited message exists and reads as cited; it never proves that the message supports the line. */
export interface ChronicleCheck {
  /** Each file: its length, its lines, how many of them cite a message, and how many fail (a citation that doesn't hold, or no citation at all). */
  files: { path: string; chars: number; lines: number; cited: number; failed: number }[];
  failures: ChronicleFailure[];
  moved: ChronicleMoved[];
  /** Lines that say something and cite no message, list item or prose: they fail as well. */
  uncited: { path: string; line: number; text: string }[];
}

/** A cited message, read by its citation. `why`, where the citation doesn't hold as written, says what was compared: `moved`, exactly one other message reads as cited, at `now`; `changed`, the message at the cited number reads otherwise; `gone`, the chat has no message at that number. */
export interface CitedMessage {
  index: number;
  ok: boolean;
  why?: "gone" | "changed" | "moved";
  /** The number of the one message that reads as cited, where the cited number is wrong. */
  now?: number;
  message: { index: number; role: string; name: string; at: number | null; text: string } | null;
}

// ---------------------------------------------------------------- learning a story (§22)

/**
 * What learning the rest of a chat's story is expected to take: a plain reckoning from the messages
 * no line of the outline covers yet and two factors that are settings (`recall.chronicle.estimate`).
 * All zeros where nothing is left to learn; before any learning the rest is the whole chat.
 */
export interface StoryEstimate {
  /** The messages no outline line covers, and their length together in characters. */
  messages: number;
  chars: number;
  /** The stretches they are read in, as Settings cut them. */
  stretches: number;
  /** The prompt tokens of every model call of the job, the readers' among them. */
  promptTokens: number;
  /** How many of those are expected to be read again from a provider's cache. 0: the reckoning assumes no cache, so it errs high. */
  cachedTokens: number;
  /** The tokens written. */
  writtenTokens: number;
  /** The prompt tokens as limits count them (`spend.cachedWeight` for the cached part): what a job's prompt allowance is sized from. */
  weighedTokens: number;
  /** The rounds of tool calls, the readers' among them. */
  toolTurns: number;
  /** The cost in US dollars at the user's price for the model the chronicler runs on; null where that model has no price. */
  usd: number | null;
}

/** How far the learning of a chat's story has come, and what the page offers to start one with. */
export interface StoryStatus {
  /** The plan of the learning, as agents write its path (`learned/chronicle/plan.md`), once the file is there; null before. */
  plan: string | null;
  /** How many messages the chat has that count as the story (§24.4): those it leaves out are nothing to learn. */
  messages: number;
  /** How many of them the chronicle's outline spans. */
  covered: number;
  /** What learning the rest is expected to take. */
  estimate: StoryEstimate;
  /** What the page fills in before the user starts one: the objective's words (a text the user can replace) and the agent definition that does it. */
  suggested: { task: string; agent: string };
  /** Why the story can't be learned in this chat, in plain words: LumiAH's own agents don't keep its chronicle (`chronicleRefusal`). Null where it can. */
  refused: string | null;
}
