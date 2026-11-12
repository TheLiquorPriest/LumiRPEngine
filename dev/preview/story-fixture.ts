// The story engine's pages in the preview (`?engine=harness`): a made-up story in Maple Falls for
// Harness → Cast, Record and Notebook, the prepared start on Play → Now with its live view
// (`lre.prepare`, `lre.prepareLive`), and the chat's workspace as LumiAH's backend answers it
// (`lah.ws.list`, `read`, `write`), all held in memory, so a pin, a file saved, Go ahead, a depth,
// words to the author or Pause change what the next read gives. `&prepare=offer|planning|revising|
// waiting|running|paused|done|cancelled|failed|unreachable` (default offer) is where the prepared
// start begins: each is reached as the product reaches it, the player's presses and the work's steps
// played through first; while it works, each read moves it on a step, as the author, the historian
// and the principals would.

import { HARNESS_AGENT } from "../../src/shared/harness-texts";
import type { CastStanding } from "../../src/shared/ledger";
import type { Beat, Draft } from "../../src/shared/ledger";
import { PREPARE_STAGES, type PrepareGoing, type PrepareLiveView, type PreparePrincipalLine, type PrepareRole, type PrepareRunLine, type PrepareRunState, type PrepareStage, type PrepareStageState, type PrepareStretchLine, type PrepareTrailEntry } from "../../src/shared/prepare-live";
import { PREPARE_DEPTHS, type BeatView, type BudgetUseView, type CastRowView, type CastView, type PrepareAsk, type PrepareDepth, type PreparePlan, type PrepareSaidView, type PrepareState, type PrepareStretchView, type PrepareView, type ReachedItem, type ReachedView, type RecordView, type StoryAnswer, type StoryAsk, type StoryAt, type StoryNames, type StoryTime } from "../../src/shared/story-pages";

/** The preview's clock now: Tue 15 Sep 2026, 7:42 AM (the HUD's). */
const NOW = 1902;

const NAMES: StoryNames = { player: "Sam Rivera", npc_rosie: "Rosie Alvarez", npc_dev: "Dev Patel", npc_mara: "Mara Kim", npc_teo: "Teo Brandt", diner: "Rosie's Diner", town_hall: "Town Hall", lakeside: "The Lakeside" };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Story time in words, as the engine says it: minute 0 is Mon 14 Sep 2026, midnight. */
function time(at: number): StoryTime {
  const day = Math.floor(at / 1440);
  const minute = at - day * 1440;
  const hour = Math.floor(minute / 60);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return { at, text: `${WEEKDAYS[day % 7]} ${14 + day} Sep 2026, ${h12}:${String(minute % 60).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}` };
}

/** The beats of the story so far, by the reply whose turn wrote them. */
const RECORDS: { at: StoryAt; beats: Beat[] }[] = [
  {
    at: { messageId: "m2", swipeId: 0 },
    beats: [
      { id: "b0", turn: "t2", at: 1830, where: "diner", by: "player", kind: "do", what: "Sam comes in for the early shift, soaked through.", surface: "Sam comes in soaked.", exposure: [{ who: "npc_rosie", reach: "whole" }], decidedBy: { agent: "historian" }, past: { from: "m1", to: "m2" } },
      { id: "b1", turn: "t2", at: 1836, where: "diner", by: "npc_rosie", kind: "say", what: "Rosie tells Sam to dry off before he touches a plate.", surface: "Rosie tells Sam to dry off.", quotes: ["Towel first, plates after."], to: ["player"], exposure: [{ who: "player", reach: "whole" }], decidedBy: { agent: "character", as: "npc_rosie" } },
    ],
  },
  {
    at: { messageId: "m4", swipeId: 0 },
    beats: [
      { id: "b2", turn: "t4", at: 1890, where: "diner", by: "npc_rosie", kind: "say", what: "Rosie tells Sam the diner may close by winter unless the rent is paid, and that she's afraid to tell the others.", surface: "Rosie, low, tells Sam the diner may close by winter.", quotes: ["If the rent isn't paid by November, we close."], to: ["player"], exposure: [{ who: "player", reach: "whole" }, { who: "npc_dev", reach: "part", got: "Rosie saying something about November, very low." }], decidedBy: { agent: "character", as: "npc_rosie" } },
      { id: "b3", turn: "t4", at: 1893, where: "diner", by: "npc_dev", kind: "do", what: "Dev slides twenty dollars across the counter to Sam, out of Rosie's sight.", surface: "Dev slides something across the counter to Sam.", exposure: [{ who: "player", reach: "whole" }], decidedBy: { agent: "author" } },
      { id: "b4", turn: "t4", at: 1895, where: "diner", by: "player", kind: "say", what: "Sam promises Rosie he'll take Friday's double shift.", surface: "Sam promises Rosie he'll take Friday's double shift.", quotes: ["I'll take the double on Friday."], to: ["npc_rosie"], exposure: [{ who: "npc_rosie", reach: "whole" }, { who: "npc_dev", reach: "whole" }], decidedBy: { agent: "author" } },
      { id: "b5", turn: "t4", at: 1896, where: "diner", by: "npc_rosie", kind: "inner", what: "Rosie wonders if Mara will ever pay back what she borrowed in the spring.", surface: "", exposure: [], decidedBy: { agent: "character", as: "npc_rosie" } },
      { id: "b6", turn: "t4", at: 1898, where: "diner", by: "world", kind: "happen", what: "Rain floods the back step and water seeps under the storeroom door.", surface: "Water seeps under the storeroom door.", exposure: [{ who: "npc_rosie", reach: "whole" }, { who: "player", reach: "told", got: "Rosie says the storeroom is flooding.", from: "npc_rosie" }], decidedBy: { agent: "game_master" } },
      { id: "b7", turn: "t4", at: 1900, where: "diner", by: "npc_dev", kind: "say", what: "Dev says he lost his job at the garage.", surface: "Dev says he lost his job.", quotes: ["They let me go yesterday."], exposure: [{ who: "player", reach: "whole" }], decidedBy: { agent: "author" }, struck: "Dev still works at the garage: the author set it right after your note." },
    ],
  },
];

const DRAFTS: Draft[] = [
  { id: "d1", what: "Mara goes to the Town Hall to ask the landlord's agent for more time on the diner's rent.", tier: 2, who: ["npc_mara"], where: ["town_hall"], when: 2600, basis: { messageId: "m4", swipeId: 0 }, state: "open", notes: "Before Friday's double shift, so Sam can hear of it." },
  { id: "d2", what: "Teo's band plays the Lakeside on Saturday night.", tier: 4, who: ["npc_teo"], where: ["lakeside"], when: 1700, basis: { messageId: "m2", swipeId: 0 }, state: "settled" },
  { id: "d3", what: "Rosie's sister visits with news from the city.", tier: 3, who: ["npc_rosie"], when: 2000, basis: { messageId: "m3", swipeId: 1 }, state: "stale", notes: "Its morning left the story's path when the reply was swiped." },
];

/** File text as each page starts, by path. */
const FILES: Record<string, { text: string; by: "user" | "author" | "character"; ago: number }> = {
  "minds/npc_rosie/core.md": { text: "# Rosie Alvarez\n\nRuns Rosie's Diner, as her mother did. Proud, tired, generous to a fault. Lent Mara money in the spring.", by: "author", ago: 86_400_000 },
  "minds/npc_rosie/now.md": { text: "The storeroom is flooding and the rent is due in November. Sam said he'd take the double. Good kid.", by: "character", ago: 300_000 },
  "minds/npc_rosie/memory.md": { text: "- Sam came in soaked this morning. Told him: towel first.\n- Told Sam about the rent. Didn't mean to.", by: "character", ago: 300_000 },
  "minds/npc_rosie/beliefs.md": { text: "- The diner can be saved if the summer crowd comes back.\n- Mara will pay me back when she can.", by: "character", ago: 3_600_000 },
  "minds/npc_rosie/people.md": { text: "Sam: reliable, quieter than he lets on.\nDev: sweet, never has a dollar.\nMara: owes me, and knows it.", by: "character", ago: 3_600_000 },
  "minds/npc_rosie/plans.md": { text: "Call the landlord's agent before Friday.", by: "character", ago: 300_000 },
  "minds/npc_rosie/outline.md": { text: "The spring before: Mara borrowed $600 for her car. Rosie never asked for it back.", by: "author", ago: 172_800_000 },
  "minds/npc_mara/core.md": { text: "# Mara Kim\n\nWorks nights at the hospital. Owes Rosie money she can't repay yet.", by: "author", ago: 86_400_000 },
  "minds/npc_mara/now.md": { text: "Off shift. Thinking about the money.", by: "character", ago: 7_200_000 },
  "minds/npc_dev/profile.md": { text: "Sam's roommate. Works at the garage. Kind, broke, always hungry.", by: "author", ago: 86_400_000 },
  "minds/pov/core.md": { text: "# Sam Rivera\n\nNew in Maple Falls. Waits tables at Rosie's.", by: "user", ago: 259_200_000 },
  "minds/pov/now.md": { text: "Wet socks. Twenty bucks from Dev. A double on Friday.", by: "character", ago: 600_000 },
  "author/notebook.md": { text: "# Notebook\n\nThe story is about a diner that may not see winter, and the people who'd lose it.\n\n- Rosie carries the rent alone. Next: does she tell the others?\n- Mara's debt to Rosie is a fuse.", by: "author", ago: 240_000 },
  "author/threads.md": { text: "# Threads\n\n- The rent (building)\n- Mara's debt (planted)\n- Sam's double shift (just begun)", by: "author", ago: 240_000 },
  "author/questions.md": { text: "# Open questions\n\n- Will Rosie ask Mara for the money?", by: "author", ago: 240_000 },
  "author/arcs.md": { text: "# Arcs\n\nRosie: from carrying it alone to asking for help.", by: "author", ago: 1_200_000 },
  "author/scene.md": { text: "# The scene\n\nRosie's Diner, early morning, rain. Rosie at the counter, Dev eating, Sam drying off.", by: "author", ago: 240_000 },
};

type Stored = { text: string; at: number; by: "user" | "author" | "character"; hash: string };

let hashes = 0;
const hashOf = () => `h${(hashes += 1).toString(36)}`;

/** The preview's story and its workspace, in memory. */
export class StoryPreview {
  private cast: { entity: string; standing: CastStanding; why?: string; pinned?: boolean; digestedTo?: string }[] = [
    { entity: "player", standing: "principal", digestedTo: "b4" },
    { entity: "npc_rosie", standing: "principal", why: "She runs the diner and holds Sam's job in her hands; her fear about the rent drives the morning.", digestedTo: "b1" },
    { entity: "npc_mara", standing: "principal", why: "She owes Rosie money and hasn't said so: the story turns on what she does about it.", pinned: true },
    { entity: "npc_dev", standing: "supporting", why: "Sam's roommate: always near, but his choices don't steer the story yet." },
    { entity: "npc_teo", standing: "extra", why: "Plays in the band at the Lakeside; seen, never heard yet." },
  ];
  private readonly files = new Map<string, Stored>();
  private readonly prepare: PreparePreview;

  constructor(prepare: PrepareState | "offer") {
    const now = Date.now();
    for (const [path, f] of Object.entries(FILES)) this.files.set(path, { text: f.text, at: now - f.ago, by: f.by, hash: hashOf() });
    // The author keeps its plan in the chat's area as it writes it, so Notebook shows the plan the card does.
    this.prepare = new PreparePreview(prepare, (text, at) => this.files.set("author/prepare.md", { text, at, by: "author", hash: hashOf() }));
  }

  /** The answer to one of the story pages' requests, or to LumiAH's workspace's; undefined for anything else. */
  answer(payload: unknown): unknown {
    if (typeof payload !== "object" || payload === null || !("type" in payload) || !("reqId" in payload)) return undefined;
    const { type, reqId } = payload as { type: string; reqId: string };
    if (type === "lre.story" || type === "lre.prepare") {
      const ask = payload as unknown as { op: string };
      try {
        const body = type === "lre.story" ? this.story(ask as StoryAsk) : this.prepare.ask(ask as PrepareAsk);
        return { lre: 1, type: "lre.result", reqId, request: type, body };
      } catch (error) {
        // A press the preparation refuses carries the code the backend's refusal does.
        return { lre: 1, type: "lre.error", reqId, code: error instanceof Refused ? error.code : "conflict", message: error instanceof Error ? error.message : String(error) };
      }
    }
    if (type === "lre.prepareLive") return { lre: 1, type: "lre.result", reqId, request: type, body: this.prepare.live() };
    if (type === "lah.ws.list" || type === "lah.ws.read" || type === "lah.ws.write") return this.workspace(type, payload as unknown as Record<string, unknown>, reqId);
    return undefined;
  }

  // -------------------------------------------------------------- lre.story

  private story(ask: StoryAsk): StoryAnswer {
    switch (ask.op) {
      case "cast":
        return { cast: this.castView() };
      case "pin": {
        const held = this.cast.find((c) => c.entity === ask.entity);
        if (ask.standing === null) {
          if (!held?.pinned) throw new Error("There's no pin on them to lift.");
          delete held.pinned;
        } else if (held) {
          if (held.standing !== ask.standing) delete held.why;
          held.standing = ask.standing;
          held.pinned = true;
        } else this.cast.push({ entity: ask.entity, standing: ask.standing, pinned: true });
        return { cast: this.castView() };
      }
      case "reached":
        return { reached: this.reached(ask.entity) };
      case "record":
        return { record: this.record(ask.at) };
      case "budget":
        return { budget: this.budget() };
    }
  }

  private beats(): Beat[] {
    return RECORDS.flatMap((r) => r.beats);
  }

  /** What `who` is given of a beat, as the feed gives it; null where it didn't reach them. */
  private item(beat: Beat, who: string, digested: boolean): ReachedItem | null {
    if (beat.struck !== undefined) return null;
    const head = { beat: beat.id, time: time(beat.at), where: beat.where, digested };
    if (beat.by === who) return { ...head, reach: "own", kind: beat.kind, what: beat.what, ...(beat.quotes ? { quotes: beat.quotes } : {}) };
    const e = beat.kind === "inner" ? undefined : beat.exposure.find((x) => x.who === who);
    if (!e) return null;
    if (e.reach === "whole") return { ...head, reach: "whole", by: beat.by, surface: beat.surface, ...(beat.quotes ? { quotes: beat.quotes } : {}) };
    return { ...head, reach: e.reach, got: e.got ?? beat.surface, ...(e.from !== undefined ? { from: e.from } : {}) };
  }

  private castView(): CastView {
    const beats = this.beats();
    const rows: CastRowView[] = this.cast.map((c) => {
      const upTo = c.digestedTo === undefined ? -1 : beats.findIndex((b) => b.id === c.digestedTo);
      const thinks = c.entity === "player" || c.standing === "principal";
      const waiting = thinks ? beats.slice(upTo + 1).filter((b) => this.item(b, c.entity, false) !== null).length : 0;
      const beat = upTo >= 0 ? beats[upTo] : undefined;
      return { entity: c.entity, standing: c.standing, why: c.why ?? null, pinned: c.pinned === true, mind: c.standing === "extra" && c.entity !== "player" ? null : `minds/${c.entity === "player" ? "pov" : c.entity}/`, digested: beat ? { beat: beat.id, time: time(beat.at) } : null, waiting };
    });
    return { cast: rows, names: NAMES };
  }

  private reached(entity: string): ReachedView {
    const beats = this.beats();
    const held = this.cast.find((c) => c.entity === entity);
    const upTo = held?.digestedTo === undefined ? -1 : beats.findIndex((b) => b.id === held.digestedTo);
    const items = beats.map((b, i) => this.item(b, entity, i <= upTo)).filter((x): x is ReachedItem => x !== null);
    return { entity, items, more: 0, names: NAMES };
  }

  private record(asked: StoryAt | undefined): RecordView {
    const replies = RECORDS.map((r, i) => ({ ...r.at, beats: r.beats.length, time: r.beats[0] ? time(r.beats[0].at) : null, latest: i === RECORDS.length - 1 })).reverse();
    const at = asked ?? replies[0] ?? null;
    const held = at === null ? undefined : RECORDS.find((r) => r.at.messageId === at.messageId && r.at.swipeId === at.swipeId);
    const view = (b: Beat): BeatView => ({ id: b.id, kind: b.kind, time: time(b.at), where: b.where, by: b.by, what: b.what, surface: b.surface, quotes: b.quotes ?? [], to: b.to ?? [], exposure: b.exposure.map((e) => ({ who: e.who, reach: e.reach, got: e.got ?? null, from: e.from ?? null })), decidedBy: { agent: b.decidedBy.agent, as: b.decidedBy.as ?? null }, settles: b.settles ?? null, struck: b.struck ?? null, past: b.past !== undefined });
    return {
      at: at === null ? null : { messageId: at.messageId, swipeId: at.swipeId },
      beats: held ? held.beats.map(view) : [],
      replies,
      drafts: DRAFTS.map((d) => ({ id: d.id, what: d.what, tier: d.tier, who: d.who, where: d.where ?? [], time: time(d.when), state: d.state, notes: d.notes ?? null, basis: { messageId: d.basis.messageId, swipeId: d.basis.swipeId } })),
      names: NAMES,
    };
  }

  private budget(): BudgetUseView {
    const near = DRAFTS.filter((d) => d.state !== "dropped" && Math.abs(d.when - NOW) < 1440);
    return { now: time(NOW), used: { t1: near.filter((d) => d.tier === 1).length, t2: near.filter((d) => d.tier === 2).length, t3: near.filter((d) => d.tier === 3).length } };
  }

  // -------------------------------------------------------------- LumiAH's workspace

  private workspace(type: string, body: Record<string, unknown>, reqId: string): unknown {
    const result = (out: unknown) => ({ lah: 1, type: "lah.result", reqId, request: type, body: out });
    const error = (code: string, message: string) => ({ lah: 1, type: "lah.error", reqId, code, message });
    const file = (path: string, f: Stored) => ({ path, hash: f.hash, chars: f.text.length, at: f.at, by: f.by === "user" ? { who: "user" } : { who: "agent", id: `a-${f.by}`, role: f.by }, pins: path === "author/notebook.md" ? ["author"] : [] });
    const path = typeof body.path === "string" ? body.path : "";
    if (type === "lah.ws.list") {
      const files = [...this.files.entries()].map(([p, f]) => file(p, f));
      return result({ area: "chat", files, chars: files.reduce((n, f) => n + f.chars, 0), limits: { fileChars: 50_000, files: 400, areaChars: 2_000_000, pinChars: 16_000 }, agents: [{ id: "author", name: "Author" }], basis: { messageId: "m4", swipe: 0, index: 3 } });
    }
    const held = this.files.get(path);
    if (type === "lah.ws.read") return held ? result({ file: file(path, held), text: held.text, version: held.hash }) : error("not_found", `There's no file ${path} in this chat's area.`);
    const base = body.base === null ? null : String(body.base);
    if ((held?.hash ?? null) !== base) return error("conflict", "The file changed since it was read.");
    const stored: Stored = { text: typeof body.text === "string" ? body.text : "", at: Date.now(), by: "user", hash: hashOf() };
    this.files.set(path, stored);
    return result({ file: file(path, stored) });
  }

  /** Writes a file as an agent would, for `__lre.story.writeAsAgent(path, text)`: a page holding the file sees a conflict on its next save. */
  writeAsAgent(path: string, text: string): void {
    this.files.set(path, { text, at: Date.now(), by: "character", hash: hashOf() });
  }
}

// ---------------------------------------------------------------- the prepared start

/** The card's words, as the backend says them (`backend/story/prepare.ts`), so the preview reads as the product does. */
const PREP_WORDS = {
  offerHistory: "This chat has a history. Prepare the story, and the author catches up on it and gives the people it turns on minds of their own before the first reply.",
  noCore: "The story's preparation can't be reached: the agent runtime isn't running for this chat. Check LumiAH's page, then open this chat again.",
  running: "The story is being prepared already. Pause, steer or cancel it.",
  noPlan: "There is no plan yet: the author writes one first.",
  noWords: "Say something first.",
  noJob: "Nothing is preparing this story now.",
  done: "This story is prepared already.",
  badCap: "A cap is a whole number of tokens, or none.",
  held: "Held. Resume lets it go on.",
  stopped: "It stopped before it finished. Resume carries it on from its file.",
  cancelled: "Cancelled. What it prepared stays: carry it on from its file, tell the author what to change, or start over.",
  noPlanMade: "It ended before it wrote a plan.",
  scene: "The scene isn't set yet (author/scene.md).",
  notebook: "The author's notebook isn't written yet (author/notebook.md).",
  revising: "The author is revising its plan with what you said. The revised plan waits for your word.",
  revised: "The author revised the plan for what you said. It now waits for your word: go ahead with it, or tell the author more.",
  unanswered: "The author hasn't answered what you said yet. Its revised plan comes first, then your word on it.",
  saidAnswered: "The author revised the plan for this.",
  saidStart: "The author has this with the start, and answers it in its plan.",
  saidRevise: "The author is revising the plan with this.",
  saidTold: "The author was told, and revises the plan before it goes on.",
  saidKept: "Kept until the preparation is resumed. The author reads it first then.",
  saidWaiting: "Not answered yet: the run ended first. Carry the preparation on, and the author reads it first.",
  badDepth: "Pick one of the depths this plan offers.",
} as const;

/** A stretch of the chat's past as the preparation's file keeps it: who relives it, and who has. */
interface Stretch {
  id: string;
  from: number;
  to: number;
  why: string;
  who: string[];
  key: boolean;
  state: PrepareStretchView["state"];
  beats: number;
  through: number | null;
  relived: string[];
}

/** The plan the preview's author writes: the story, its principals, the stretches it would relive (the key moments marked, with the beats the historian records of each), what is filled from summaries, and the whole reckoned at each depth, the author's own work included. */
const PLAN: {
  story: string;
  principals: PreparePlan["principals"];
  stretches: readonly (Pick<Stretch, "id" | "from" | "to" | "why" | "who" | "key"> & { records: number })[];
  summaries: string;
  authorEstimate: number;
  call: NonNullable<PreparePlan["call"]>;
  ceiling: number;
  depths: Readonly<Record<PrepareDepth, number>>;
  recommended: PreparePlan["recommended"];
} = {
  story: "A small-town diner that may not see winter, and the people who'd lose it: Rosie, who carries the rent alone; Sam, new in town; Mara, who owes Rosie more than money.",
  principals: [
    { entity: "npc_rosie", why: "The diner is hers; every thread runs through her." },
    { entity: "npc_mara", why: "Her debt to Rosie is the story's fuse." },
  ],
  stretches: [
    { id: "s1", from: 1, to: 14, why: "Sam's first week: how Rosie came to trust him.", who: ["npc_rosie"], key: false, records: 9 },
    { id: "s2", from: 15, to: 30, why: "The spring loan: what Rosie and Mara each remember of it.", who: ["npc_rosie", "npc_mara"], key: true, records: 12 },
    { id: "s3", from: 31, to: 42, why: "Last night's argument at the Lakeside.", who: ["npc_mara"], key: true, records: 7 },
  ],
  summaries: "Teo's band and the town's festival are filled from the chat's summaries and the world's lore.",
  authorEstimate: 200_000,
  call: { tokens: 6_000, from: "job" },
  ceiling: 200_000,
  depths: { outline: 70_000, key: 215_000, all: 290_000 },
  recommended: { depth: "key", why: "The loan and last night's argument are what the story turns on; Sam's first week reads well enough in outline." },
};

/** The chat as the plan found it: its messages by number, and what its summaries cover. */
const CHAT = { messages: 42, first: 1, last: 42, covered: [{ from: 1, to: 30 }] };

/** What each step of the work spends, in tokens, and its model calls: the author reading while it plans, the historian opening and recording a stretch, a principal reliving one, a mind's file, the scene or the notebook, the close. */
const COST = { plan: [9_000, 2], open: [22_000, 4], record: [22_000, 4], relive: [14_000, 5], mind: [8_000, 3], scene: [6_000, 2], finish: [3_000, 1] } as const satisfies Record<string, readonly [number, number]>;

/** How often the live view asks again while a run is at work, in seconds: Settings → Story → Preparing's shipped dial. */
const WATCH_SECONDS = 5;

/** What the player says as the preview plays the prepared start through, and the author's answer to each. */
const ABOUT = "It's about Rosie keeping the diner open, and the money Mara owes her. Sam is new in town; Dev is just around.";
const TOLD = "Sam's first week matters less than the loan: don't spend on it.";
const KEPT = "Keep Teo out of it: his band is background.";
const ANSWERS = new Map([
  [ABOUT, "Rosie and Mara are the principals, as you said; Sam and Dev aren't. The spring loan and last night's argument are the key moments."],
  [TOLD, "Sam's first week stays out at the depth I recommend: only the spring loan and last night's argument are relived, the loan first."],
  [KEPT, "Teo stays background: his band is filled from the chat's summaries, and he relives nothing."],
]);
/** The author's answer to words the preview didn't script. */
const ANSWER_ANY = "I weighed the plan again with what you said: Rosie and Mara stay the principals, and the moments to relive stand as the plan shows them.";
/** Why the run stops where the preview starts it failed, in LumiAH's words. */
const FAILED_REASON = "The model call failed: the connection answered 429, rate limited. Try again in a few minutes.";

/** Something the player said, as the file keeps it: how it reached the author (with the start, by a run of its own, told to a run at work, kept for a held one), and its answer once given. */
type Said = { text: string; how: "start" | "revise" | "told" | "kept"; answer: string | null };

/** A run as LumiAH lists the chat's jobs: the author's (the player's job that keeps the preparation's file), or a principal's it started to relive a stretch. */
interface Job {
  id: string;
  agent: string;
  as: string | null;
  state: "running" | "paused" | "done" | "cancelled" | "failed";
  createdAt: number;
  endedAt: number | null;
  tokens: number;
  calls: number;
  reason: string | null;
  heldMs: number;
  heldSince: number | null;
}

/** A press the preparation can't do as asked, with the protocol's code, as the backend's `PrepareRefused`. */
class Refused extends Error {
  constructor(
    readonly code: "bad_request" | "not_found" | "conflict" | "unavailable",
    message: string,
  ) {
    super(message);
  }
}

/** Whether a stretch is within `depth`: every one at "all", the key ones at "key", none at "outline"; one open or recorded is always kept. */
const within = (s: Pick<Stretch, "key" | "state">, depth: PrepareDepth): boolean => s.state === "open" || s.state === "recorded" || depth === "all" || (depth === "key" && s.key);

const spend = (job: Job, [tokens, calls]: readonly [number, number]): void => {
  job.tokens += tokens;
  job.calls += calls;
};

const roleOf = (job: Job): PrepareRole => (job.agent === HARNESS_AGENT.author ? "author" : job.agent === HARNESS_AGENT.character ? "principal" : "other");

/** A run's state on the live view: one the view doesn't list (a run done) reads as failed, as the backend reads it. */
const runState = (state: Job["state"]): PrepareRunState => (state === "done" ? "failed" : state);

/**
 * The chat's prepared start, standing in for the preparation's file and LumiAH's jobs: each press
 * changes it as the backend's `preparePage` does, each read moves a run at work on a step, and the
 * card's view and the live view are shaped from it as `viewOf` and `prepareLive` shape theirs.
 */
class PreparePreview {
  private reachable = true;
  private planned = false;
  private stretches: Stretch[] = [];
  private word: { asked: boolean; approved: boolean; revised: boolean; for: number; depth: PrepareDepth | null; cap: number | null } = { asked: false, approved: false, revised: false, for: 0, depth: null, cap: null };
  private readonly said: Said[] = [];
  private readonly minds = new Map(PLAN.principals.map((p) => [p.entity, { core: false, outline: false }]));
  private scene = false;
  private notebook = false;
  private done = false;
  private readonly log: PrepareTrailEntry[] = [];
  private readonly jobs: Job[] = [];
  /** Reads since the latest run started: the first plan takes the author a couple. */
  private steps = 0;
  /** The clock while the start is played through; null: now. */
  private clock: number | null = null;
  private readonly onPlan: (text: string, at: number) => void;

  constructor(start: PrepareState | "offer", onPlan: (text: string, at: number) => void) {
    this.onPlan = onPlan;
    this.playTo(start);
  }

  // ------------------------------------------------------------ the presses

  /** `lre.prepare`: one press, then the prepared start as it stands; a run at work moves on a step after each read, so the next read shows it and the page opens on the state it was started in. */
  ask(ask: PrepareAsk): PrepareView {
    if (ask.op === "get") {
      const view = this.view();
      this.advance();
      return view;
    }
    if (!this.reachable) throw new Refused("unavailable", PREP_WORDS.noCore);
    const at = this.now();
    const active = this.active();
    const running = active?.state === "running" ? active : null;
    switch (ask.op) {
      case "start": {
        if (active) throw new Refused("conflict", PREP_WORDS.running);
        if (this.done) throw new Refused("conflict", PREP_WORDS.done);
        // What the player wrote first goes to the author as their word, and the plan answers it.
        const about = (ask.about ?? "").trim();
        if (about !== "") {
          this.said.push({ text: about, how: "start", answer: null });
          this.log.push({ at, what: "said", text: about });
        }
        this.run(at);
        break;
      }
      case "restart": {
        if (active) throw new Refused("conflict", PREP_WORDS.running);
        // Planned afresh: what was recorded stays, and so do what the player said and their cap; their word is asked again, and the scene and the notebook are owed again.
        this.stretches = this.stretches.filter((s) => s.state === "open" || s.state === "recorded");
        this.planned = false;
        this.word = { asked: false, approved: false, revised: false, for: 0, depth: null, cap: this.word.cap };
        this.done = false;
        this.scene = false;
        this.notebook = false;
        this.log.push({ at, what: "reopened" });
        this.run(at);
        break;
      }
      case "approve": {
        const picked = ask.depth === undefined ? null : (PREPARE_DEPTHS.find((d) => d === ask.depth) ?? null);
        if (ask.depth !== undefined && picked === null) throw new Refused("bad_request", PREP_WORDS.badDepth);
        if (!this.planned) throw new Refused("not_found", PREP_WORDS.noPlan);
        if (this.done) throw new Refused("conflict", PREP_WORDS.done);
        if (this.unanswered().length > 0) throw new Refused("conflict", PREP_WORDS.unanswered);
        if (picked !== null && !this.offered().includes(picked)) throw new Refused("bad_request", PREP_WORDS.badDepth);
        // Going ahead takes the depth the player picked, else the author's, and the whole is reckoned at it.
        const depth = picked ?? this.depth();
        this.word = { ...this.word, approved: true, revised: false, depth, for: Math.max(this.word.for, PLAN.authorEstimate, PLAN.depths[depth]) };
        this.log.push({ at, what: "approved", text: depth });
        // The run that wrote the plan ended to wait for this word: a new one carries the preparation on.
        if (active === null) this.run(at);
        break;
      }
      case "depth": {
        const depth = PREPARE_DEPTHS.find((d) => d === ask.depth);
        if (depth === undefined) throw new Refused("bad_request", PREP_WORDS.badDepth);
        if (!this.planned) throw new Refused("not_found", PREP_WORDS.noPlan);
        if (!this.offered().includes(depth)) throw new Refused("bad_request", PREP_WORDS.badDepth);
        if (this.unanswered().length > 0) throw new Refused("conflict", PREP_WORDS.unanswered);
        // Deeper adds stretches planned and not chosen, and opens a finished preparation again; shallower leaves what was recorded as it is.
        const deeper = this.stretches.some((s) => s.state === "planned" && within(s, depth) && !within(s, this.depth()));
        this.word = { ...this.word, depth, ...(this.word.approved ? { for: Math.max(this.word.for, PLAN.authorEstimate, PLAN.depths[depth]) } : {}) };
        if (deeper) this.done = false;
        this.log.push({ at, what: "depth", text: depth });
        if (deeper && this.word.approved && active === null) this.run(at);
        break;
      }
      case "steer": {
        const words = ask.text.trim();
        if (words === "") throw new Refused("bad_request", PREP_WORDS.noWords);
        // Told to a run at work; kept for a held one; else a run of its own revises the plan with them, or, with no plan yet, starts the preparation with them.
        const how: Said["how"] = running ? "told" : active ? "kept" : this.planned ? "revise" : "start";
        // Words never approve the plan: it waits for the player's word on it as the author revises it, whatever their ceiling.
        if (how !== "start") this.word = { ...this.word, asked: true, approved: false, revised: true };
        this.said.push({ text: words, how, answer: null });
        this.log.push({ at, what: "said", text: words });
        // A finished preparation is opened again: it finishes once the scene and the notebook are written since.
        if (this.done) {
          this.done = false;
          this.scene = false;
          this.notebook = false;
          this.log.push({ at, what: "reopened" });
        }
        if (how === "revise" || how === "start") this.run(at);
        break;
      }
      case "cap": {
        const { tokens } = ask;
        if (tokens !== null && !(Number.isSafeInteger(tokens) && tokens >= 0)) throw new Refused("bad_request", PREP_WORDS.badCap);
        if (!this.planned) throw new Refused("not_found", PREP_WORDS.noPlan);
        this.word = { ...this.word, cap: tokens };
        this.log.push({ at, what: "cap", ...(tokens !== null ? { count: tokens } : {}) });
        break;
      }
      case "pause": {
        if (active === null) throw new Refused("not_found", PREP_WORDS.noJob);
        for (const job of this.underWay())
          if (job.state === "running") {
            job.state = "paused";
            job.heldSince = at;
          }
        this.log.push({ at, what: "paused" });
        break;
      }
      case "resume": {
        if (active !== null) {
          for (const job of this.underWay())
            if (job.state === "paused") {
              job.heldMs += at - (job.heldSince ?? at);
              job.heldSince = null;
              job.state = "running";
            }
          // What the player said while it was held is told to it first, as it goes on.
          for (const s of this.said) if (s.answer === null && s.how === "kept") s.how = "told";
        } else {
          if (this.done) throw new Refused("not_found", PREP_WORDS.noJob);
          this.run(at);
        }
        this.log.push({ at, what: "resumed" });
        break;
      }
      case "cancel": {
        if (active === null) throw new Refused("not_found", PREP_WORDS.noJob);
        for (const job of this.underWay()) this.end(job, at, "cancelled");
        this.log.push({ at, what: "cancelled" });
        break;
      }
    }
    return this.view();
  }

  // ------------------------------------------------------------ the work

  /** One step since the last read: a principal at work relives a stretch; the author's run plans, answers what the player said with its plan written again, or moves the preparation on. */
  private advance(): void {
    if (!this.reachable) return;
    const at = this.now();
    const job = this.active();
    if (job?.state !== "running") {
      // A principal's run is a job of its own: it finishes its stretch whether or not the author's goes on.
      const reliver = this.jobs.find((j) => j.agent === HARNESS_AGENT.character && j.state === "running");
      if (reliver) this.relive(reliver, at);
      return;
    }
    this.steps += 1;
    if (!this.planned || this.unanswered().length > 0) {
      spend(job, COST.plan);
      if (this.planned || this.steps >= 2) this.writePlan(job, at);
      return;
    }
    if (!this.waits()) this.work(job, at);
  }

  /** The author writes its plan, or writes it again for what the player said, answering every word of theirs not yet answered; the player's word on it follows as `wordFor` has it. */
  private writePlan(job: Job, at: number): void {
    const open = this.unanswered();
    const revised = this.planned;
    const known = open.findLast((s) => ANSWERS.has(s.text));
    const answer = open.length === 0 ? null : ((known && ANSWERS.get(known.text)) ?? ANSWER_ANY);
    for (const s of open) s.answer = answer;
    if (!revised) {
      // A plan written afresh keeps what was recorded of the last.
      const kept = new Map(this.stretches.map((s) => [s.id, s]));
      this.stretches = PLAN.stretches.map((p) => kept.get(p.id) ?? { id: p.id, from: p.from, to: p.to, why: p.why, who: [...p.who], key: p.key, state: "planned", beats: 0, through: null, relived: [] });
      this.planned = true;
    }
    // Words other than those given with the start send the plan back to wait for the player's word, whatever their ceiling.
    if (open.some((s) => s.how !== "start")) this.word = { ...this.word, approved: false, revised: true };
    const estimate = this.estimate();
    const w = this.word;
    if (w.revised && !w.approved) this.word = { ...w, asked: true, approved: false, for: estimate, revised: true };
    else if (estimate <= PLAN.ceiling) this.word = { ...w, asked: false, approved: true, for: estimate, revised: false };
    else if (w.approved && w.asked && estimate <= w.for) this.word = { ...w, revised: false };
    else this.word = { ...w, asked: true, approved: false, for: estimate, revised: false };
    if (answer !== null) this.log.push({ at, what: "answered", text: answer });
    this.log.push({ at, what: revised ? "revised" : "planned", count: this.stretches.length });
    this.onPlan(planText(this.view()), at);
    // The run that wrote it ends where the plan waits for the player's word: their Go ahead starts the next.
    if (this.waits()) this.end(job, at, "done");
  }

  /** The author's run moves the preparation on: the historian records the stretch open, a principal relives one, the next stretch within the depth opens (or is dropped past the player's cap), else the minds, the scene and the notebook are written and the preparation closes. */
  private work(job: Job, at: number): void {
    const open = this.stretches.find((s) => s.state === "open");
    const reliver = this.jobs.find((j) => j.agent === HARNESS_AGENT.character && j.state === "running");
    const depth = this.depth();
    const next = this.stretches.find((s) => s.state === "planned" && within(s, depth));
    if (open) {
      open.state = "recorded";
      open.beats = PLAN.stretches.find((p) => p.id === open.id)?.records ?? open.beats;
      open.through = open.to;
      spend(job, COST.record);
      this.log.push({ at, what: "recorded", stretch: open.id, count: open.beats });
      this.startRelivers(at);
    } else if (reliver) this.relive(reliver, at);
    else if (next) {
      const cost = COST.open[0] + COST.record[0] + COST.relive[0] * next.who.length;
      if (this.word.cap !== null && this.spent() + cost > this.word.cap) {
        // No moment is relived past the player's cap: the author fills it from summaries instead.
        next.state = "dropped";
        this.log.push({ at, what: "dropped", stretch: next.id });
        return;
      }
      // The historian reads the stretch and records it as it goes: half of it by the next read.
      next.state = "open";
      next.beats = Math.floor((PLAN.stretches.find((p) => p.id === next.id)?.records ?? 0) / 2);
      next.through = next.from + Math.floor((next.to - next.from) / 2);
      spend(job, COST.open);
      this.log.push({ at, what: "opened", stretch: next.id });
    } else this.fillIn(job, at);
  }

  /** A principal's run takes in the first recorded stretch it hasn't, and ends; the next it owes starts it again. */
  private relive(job: Job, at: number): void {
    const who = job.as;
    const s = who === null ? undefined : this.stretches.find((x) => x.state === "recorded" && x.who.includes(who) && !x.relived.includes(who));
    if (s && who !== null) {
      s.relived.push(who);
      this.log.push({ at, what: "relived", stretch: s.id, who });
    }
    spend(job, COST.relive);
    this.end(job, at, "done");
    this.startRelivers(at);
  }

  /** A run for each principal a recorded stretch reached who hasn't taken it in and has none at work. */
  private startRelivers(at: number): void {
    for (const s of this.stretches) {
      if (s.state !== "recorded") continue;
      for (const who of s.who) {
        if (s.relived.includes(who) || this.underWay().some((j) => j.as === who)) continue;
        this.jobs.push(this.job(HARNESS_AGENT.character, who, at));
      }
    }
  }

  /** Past the reliving: each principal's outline and profile, the scene, the notebook, then the author closes the preparation. */
  private fillIn(job: Job, at: number): void {
    for (const p of PLAN.principals) {
      const mind = this.minds.get(p.entity);
      if (mind === undefined) continue;
      if (!mind.outline) {
        mind.outline = true;
        spend(job, COST.mind);
        this.log.push({ at, what: "outlined", who: p.entity });
        return;
      }
      if (!mind.core) {
        mind.core = true;
        spend(job, COST.mind);
        this.log.push({ at, what: "profiled", who: p.entity });
        return;
      }
    }
    if (!this.scene || !this.notebook) {
      if (this.scene) this.notebook = true;
      else this.scene = true;
      spend(job, COST.scene);
      return;
    }
    this.done = true;
    spend(job, COST.finish);
    this.log.push({ at, what: "finished" });
    this.end(job, at, "done");
  }

  private job(agent: string, as: string | null, at: number): Job {
    return { id: `job-${this.jobs.length + 1}`, agent, as, state: "running", createdAt: at, endedAt: null, tokens: 0, calls: 0, reason: null, heldMs: 0, heldSince: null };
  }

  /** A run of the author's starts or carries the preparation on from its file; the principals owed a recorded stretch start theirs once the plan stands. */
  private run(at: number): void {
    this.jobs.push(this.job(HARNESS_AGENT.author, null, at));
    this.steps = 0;
    if (this.planned && !this.waits() && this.unanswered().length === 0) this.startRelivers(at);
  }

  private end(job: Job, at: number, state: "done" | "cancelled" | "failed"): void {
    if (job.heldSince !== null) job.heldMs += at - job.heldSince;
    job.heldSince = null;
    job.state = state;
    job.endedAt = at;
  }

  // ------------------------------------------------------------ where it stands

  private now(): number {
    return this.clock ?? Date.now();
  }

  /** The author's latest run: where the card's state is read from. */
  private authorJob(): Job | null {
    return this.jobs.findLast((j) => j.agent === HARNESS_AGENT.author) ?? null;
  }

  private underWay(): Job[] {
    return this.jobs.filter((j) => j.state === "running" || j.state === "paused");
  }

  /** The author's run under way, at work or held; null where none is. */
  private active(): Job | null {
    const job = this.authorJob();
    return job !== null && (job.state === "running" || job.state === "paused") ? job : null;
  }

  /** The depth it goes to: the player's pick, else the author's recommendation. */
  private depth(): PrepareDepth {
    return this.word.depth ?? PLAN.recommended.depth;
  }

  /** The depths the plan offers: outlines only always; the key moments where some stretch is one; everything where there is a stretch. */
  private offered(): PrepareDepth[] {
    const live = this.stretches.filter((s) => s.state !== "dropped");
    return PREPARE_DEPTHS.filter((d) => d === "outline" || (d === "key" ? live.some((s) => s.key) : live.length > 0));
  }

  /** The whole reckoned at the depth it goes to, or the author's estimate where that is more. */
  private estimate(): number {
    return Math.max(PLAN.authorEstimate, PLAN.depths[this.depth()]);
  }

  private waits(): boolean {
    return !this.done && this.word.asked && !this.word.approved;
  }

  private unanswered(): Said[] {
    return this.said.filter((s) => s.answer === null);
  }

  /** Every run of it, as LumiAH counts them. */
  private spent(): number {
    return this.jobs.reduce((n, j) => n + j.tokens, 0);
  }

  private names(): StoryNames {
    return this.planned ? Object.fromEntries(PLAN.principals.map((p) => [p.entity, NAMES[p.entity] ?? p.entity])) : {};
  }

  /** Where it stands, as the card says it, from the file and the author's latest run (the backend's `pageState`). */
  private shown(): { state: PrepareState; note: string | null } {
    if (this.done) return { state: "done", note: null };
    const job = this.authorJob();
    const open = this.planned && this.unanswered().length > 0;
    const waitsWords = (): string => (this.word.revised ? PREP_WORDS.revised : `The plan is reckoned at ${this.estimate().toLocaleString("en-US")} tokens in all, the author's own work included, above your ceiling of ${PLAN.ceiling.toLocaleString("en-US")}. Approve it, steer it, or cap what the whole preparation may spend.`);
    if (job !== null && (job.state === "running" || job.state === "paused")) {
      if (job.state === "paused") return { state: "paused", note: PREP_WORDS.held };
      if (!this.planned) return { state: "planning", note: null };
      if (open) return { state: "revising", note: PREP_WORDS.revising };
      return this.waits() ? { state: "waiting", note: waitsWords() } : { state: "running", note: null };
    }
    if (!this.planned) {
      if (job === null) return { state: "none", note: null };
      return job.state === "cancelled" ? { state: "cancelled", note: PREP_WORDS.cancelled } : { state: "failed", note: job.reason ?? PREP_WORDS.noPlanMade };
    }
    if (this.waits() && !open) return { state: "waiting", note: waitsWords() };
    if (job?.state === "cancelled") return { state: "cancelled", note: PREP_WORDS.cancelled };
    if (job !== null && job.state !== "done") return { state: "failed", note: job.reason ?? PREP_WORDS.stopped };
    return { state: "paused", note: PREP_WORDS.stopped };
  }

  /** What became of each thing the player said: answered, or what is happening to it now. */
  private steered(shown: PrepareState): PrepareSaidView[] {
    return this.said.map((s) => {
      if (s.answer !== null) return { text: s.text, status: PREP_WORDS.saidAnswered, answer: s.answer };
      const working = shown === "planning" || shown === "revising" || shown === "running" || shown === "waiting";
      const status = shown === "paused" ? PREP_WORDS.saidKept : working ? (s.how === "start" ? PREP_WORDS.saidStart : s.how === "revise" ? PREP_WORDS.saidRevise : PREP_WORDS.saidTold) : PREP_WORDS.saidWaiting;
      return { text: s.text, status, answer: null };
    });
  }

  /** What isn't prepared yet, a line each: stretches within the depth not recorded, principals with moments recorded and not relived, outlines and cores not written, the scene and the notebook. */
  private notYet(): string[] {
    const depth = this.depth();
    const name = (id: string): string => NAMES[id] ?? id;
    const out = this.stretches.filter((s) => (s.state === "planned" || s.state === "open") && within(s, depth)).map((s) => `${s.id}, #${s.from} to #${s.to}: ${s.state === "open" ? "being recorded" : "not relived yet"}`);
    for (const p of PLAN.principals) if (this.stretches.some((s) => s.state === "recorded" && s.who.includes(p.entity) && !s.relived.includes(p.entity))) out.push(`${name(p.entity)}: moments recorded, not relived yet`);
    for (const p of PLAN.principals) {
      const mind = this.minds.get(p.entity);
      if (!mind?.core) out.push(`${name(p.entity)}: no core yet`);
      if (!mind?.outline) out.push(`${name(p.entity)}: nothing in outline yet`);
    }
    if (!this.scene) out.push(PREP_WORDS.scene);
    if (!this.notebook) out.push(PREP_WORDS.notebook);
    return out;
  }

  /** The card's view (the backend's `viewOf`). */
  view(): PrepareView {
    if (!this.reachable) return { offer: null, state: "unreachable", plan: null, estimate: null, spent: 0, cap: null, steered: [], notYet: [], note: PREP_WORDS.noCore, names: {} };
    const shown = this.shown();
    const depth = this.depth();
    return {
      offer: shown.state === "none" ? PREP_WORDS.offerHistory : null,
      state: shown.state,
      plan: this.planned
        ? {
            story: PLAN.story,
            principals: PLAN.principals.map((p) => ({ ...p })),
            stretches: this.stretches.map((s) => ({ id: s.id, from: s.from, to: s.to, why: s.why, who: [...s.who], state: s.state, beats: s.beats, key: s.key, chosen: within(s, depth) })),
            summaries: PLAN.summaries,
            authorEstimate: PLAN.authorEstimate,
            reckoned: PLAN.depths[depth],
            call: { ...PLAN.call },
            ceiling: PLAN.ceiling,
            depths: this.offered().map((d) => ({ depth: d, tokens: PLAN.depths[d] })),
            recommended: { ...PLAN.recommended },
            depth,
          }
        : null,
      estimate: this.planned ? this.estimate() : null,
      spent: this.spent(),
      cap: this.word.cap,
      steered: this.steered(shown.state),
      notYet: this.planned && !this.done ? this.notYet() : [],
      note: shown.note,
      names: this.names(),
    };
  }

  // ------------------------------------------------------------ the live view

  /** `lre.prepareLive`: the preparation as it runs (the backend's `prepareLive`); reading it moves nothing on. */
  live(): PrepareLiveView {
    const now = Date.now();
    if (!this.reachable || (this.jobs.length === 0 && this.log.length === 0)) return { at: now, live: false, every: WATCH_SECONDS, prep: null };
    const depth = this.depth();
    const lines: PrepareStretchLine[] = (this.planned ? this.stretches : []).map((s) => {
      const relived = s.state === "recorded" ? s.who.filter((p) => s.relived.includes(p)) : null;
      const state: PrepareStretchLine["state"] = s.state === "planned" ? (within(s, depth) ? "waiting" : "left") : s.state === "open" ? "reading" : s.state === "dropped" ? "dropped" : relived?.length === s.who.length ? "done" : "reliving";
      return { id: s.id, from: s.from, to: s.to, state, beats: s.beats, through: s.through, key: s.key, relivers: [...s.who], relived };
    });
    const underWay = this.underWay();
    const opened = lines.find((s) => s.state === "reading") ?? null;
    const lineOf = (j: Job, stretch: string | null): PrepareRunLine => ({ id: j.id, role: roleOf(j), who: j.as, agent: j.agent, state: runState(j.state), stretch, since: j.createdAt, endedAt: j.endedAt, used: { tokens: j.tokens, calls: j.calls }, reason: j.reason, stoppedAt: null, inside: null });
    // A principal's run is on the first recorded stretch that reached them which they haven't taken in yet.
    const atWork = underWay.map((j) => {
      const who = j.as;
      return lineOf(j, who === null ? null : (lines.find((s) => s.state === "reliving" && s.relivers.includes(who) && !(s.relived ?? []).includes(who))?.id ?? null));
    });
    // The historian works inside the author's run on the stretch open, since it was opened.
    const author = atWork.find((r) => r.role === "author");
    if (opened !== null && author !== undefined) atWork.push({ id: author.id, role: "historian", who: null, agent: HARNESS_AGENT.historian, state: author.state, stretch: opened.id, since: this.log.findLast((e) => e.what === "opened" && e.stretch === opened.id)?.at ?? null, endedAt: null, used: null, reason: null, stoppedAt: null, inside: author.id });
    const rank = (r: PrepareRunLine): number => (r.role === "author" ? 0 : r.role === "historian" ? 1 : r.role === "principal" ? 2 + Math.max(0, PLAN.principals.findIndex((p) => p.entity === r.who)) : 10_000);
    atWork.sort((a, b) => rank(a) - rank(b));
    // The last run of each of them, where it stopped before its work was done.
    const latest = new Map<string, Job>();
    for (const j of this.jobs) latest.set(`${j.agent}\u0000${j.as ?? ""}`, j);
    const stopped = this.done ? [] : [...latest.values()].filter((j) => j.state === "failed").map((j) => lineOf(j, null));
    const principals: PreparePrincipalLine[] = (this.planned ? PLAN.principals : []).map((p) => {
      const theirs = lines.filter((s) => s.state !== "dropped" && s.state !== "left" && s.relivers.includes(p.entity));
      const mind = this.minds.get(p.entity);
      return { id: p.entity, planned: theirs.length, relived: theirs.filter((s) => (s.relived ?? []).includes(p.entity)).length, outline: mind?.outline ?? false, profile: mind?.core ?? false, atWork: underWay.some((j) => j.agent === HARNESS_AGENT.character && j.as === p.entity) };
    });
    const { stage, stages } = this.stages(lines, principals);
    const held = underWay.some((j) => j.state === "paused");
    const going: PrepareGoing = this.done ? "done" : !held && underWay.some((j) => j.state === "running") ? "running" : underWay.length > 0 ? "held" : this.planned && this.waits() && this.unanswered().length === 0 ? "waiting" : "stopped";
    // The author's runs begun and ended, and any run stopped before its work was done; the file's own log says the rest.
    const runTrail = (j: Job): PrepareTrailEntry[] => {
      const of = { role: roleOf(j), agent: j.agent, ...(j.as !== null ? { who: j.as } : {}) };
      const isAuthor = j.agent === HARNESS_AGENT.author;
      const out: PrepareTrailEntry[] = isAuthor ? [{ at: j.createdAt, what: "run_started", ...of }] : [];
      if (j.endedAt === null) return out;
      if (j.state === "failed") out.push({ at: j.endedAt, what: "run_stopped", ...of, ...(j.reason !== null ? { text: j.reason } : {}) });
      else if (j.state === "done" && isAuthor) out.push({ at: j.endedAt, what: "run_ended", ...of });
      return out;
    };
    const trail = [...this.log.map((e) => ({ ...e })), ...this.jobs.flatMap(runTrail)]
      .map((e, i) => ({ e, i }))
      .sort((a, b) => b.e.at - a.e.at || b.i - a.i)
      .map(({ e }) => e);
    const firsts = [...this.log.slice(0, 1).map((e) => e.at), ...this.jobs.map((j) => j.createdAt)];
    const lastEnd = Math.max(0, ...this.jobs.map((j) => j.endedAt ?? 0));
    const worked = (j: Job): number => Math.max(0, (j.endedAt ?? now) - j.createdAt - j.heldMs - (j.heldSince !== null ? now - j.heldSince : 0));
    const ended = going === "stopped" && lastEnd > 0 && now - lastEnd <= 2 * WATCH_SECONDS * 1000;
    return {
      at: now,
      // Asked again while a run is at work (the preview's runs never wait for a place), and for two asks past the latest run's end while it is stopped.
      live: going === "running" || ended,
      every: WATCH_SECONDS,
      prep: {
        kind: "history",
        stage,
        stages,
        going,
        depth: this.planned ? { chosen: depth, recommended: PLAN.recommended.depth, picked: this.word.depth !== null } : null,
        runs: [...atWork, ...stopped],
        stretches: lines,
        principals,
        messages: this.planned ? messagesOf(lines) : null,
        relivedAt: this.log.findLast((e) => e.what === "relived")?.at ?? null,
        reach: true,
        scene: this.scene,
        notebook: this.notebook,
        startedAt: firsts.length > 0 ? Math.min(...firsts) : null,
        endedAt: this.done ? (this.log.findLast((e) => e.what === "finished")?.at ?? null) : null,
        workedMs: this.jobs.filter((j) => j.agent === HARNESS_AGENT.author).reduce((n, j) => n + worked(j), 0),
        left: this.done ? null : leftOf(this.log, lines),
        spent: this.spent(),
        estimate: this.planned ? this.estimate() : null,
        cap: this.word.cap,
        trail,
        logged: true,
        names: this.names(),
      },
    };
  }

  /** Each stage as it stands, and the one it is at: the first neither done nor skipped (the backend's `stagesOf`). */
  private stages(lines: readonly PrepareStretchLine[], principals: readonly PreparePrincipalLine[]): { stage: PrepareStage; stages: { id: PrepareStage; state: PrepareStageState }[] } {
    const open = this.planned && this.unanswered().length > 0;
    const live = lines.filter((s) => s.state !== "dropped" && s.state !== "left");
    const facts: Record<PrepareStage, PrepareStageState> = {
      reading: this.planned ? "done" : "now",
      planning: !this.planned ? "ahead" : open ? "now" : "done",
      waiting: !this.planned || open ? "ahead" : !this.word.asked ? "skipped" : this.word.approved ? "done" : "now",
      reliving: this.planned && live.length === 0 ? "skipped" : this.planned && live.every((s) => s.state === "done" || s.state === "recorded") ? "done" : "ahead",
      filling: this.planned && principals.every((p) => p.profile && p.outline !== false) ? "done" : "ahead",
      scene: this.planned && this.scene && this.notebook ? "done" : "ahead",
      ready: this.done ? "done" : "ahead",
    };
    if (this.done) return { stage: "ready", stages: PREPARE_STAGES.map((id) => ({ id, state: facts[id] === "skipped" ? "skipped" : "done" })) };
    const at = PREPARE_STAGES.find((id) => id !== "ready" && facts[id] !== "done" && facts[id] !== "skipped") ?? "scene";
    return { stage: at, stages: PREPARE_STAGES.map((id) => ({ id, state: id === at ? "now" : facts[id] === "now" ? "ahead" : facts[id] })) };
  }

  // ------------------------------------------------------------ where it begins

  /** Plays the prepared start through to `to` as the product gets there, the player's presses and the work's steps a few minutes apart, then moves it all so the last step was a minute ago. */
  private playTo(to: PrepareState | "offer"): void {
    if (to === "offer" || to === "none") return;
    if (to === "unreachable") {
      this.reachable = false;
      return;
    }
    let clock = 0;
    this.clock = clock;
    const step = (act: () => void): void => {
      act();
      clock += 4 * 60_000;
      this.clock = clock;
    };
    const read = (): void => step(() => this.advance());
    const press = (ask: PrepareAsk): void => step(() => void this.ask(ask));
    press({ op: "start", about: ABOUT });
    read();
    if (to !== "planning") {
      read();
      if (to !== "waiting") {
        press({ op: "approve", depth: "key" });
        read();
        if (to === "revising") press({ op: "steer", text: TOLD });
        else {
          read();
          read();
          switch (to) {
            case "running":
              break;
            case "paused":
              press({ op: "pause" });
              press({ op: "steer", text: KEPT });
              break;
            case "cancelled":
              press({ op: "cancel" });
              break;
            case "failed": {
              read();
              read();
              const job = this.active();
              if (job !== null) {
                this.end(job, clock, "failed");
                job.reason = FAILED_REASON;
              }
              break;
            }
            case "done":
              for (let i = 0; i < 30 && !this.done; i += 1) read();
              break;
            default:
              return to satisfies never;
          }
        }
      }
    }
    const shift = Date.now() - 60_000 - clock;
    for (const e of this.log) e.at += shift;
    for (const j of this.jobs) {
      j.createdAt += shift;
      if (j.endedAt !== null) j.endedAt += shift;
      if (j.heldSince !== null) j.heldSince += shift;
    }
    this.clock = null;
    const planAt = this.log.findLast((e) => e.what === "planned" || e.what === "revised")?.at;
    if (planAt !== undefined) this.onPlan(planText(this.view()), planAt);
  }
}

type Span = [number, number];

/** Spans of message numbers within the chat, made one where they overlap or touch, in order. */
function merged(spans: readonly Span[]): Span[] {
  const out: Span[] = [];
  const inChat = spans.map(([from, to]): Span => [Math.max(from, CHAT.first), Math.min(to, CHAT.last)]).filter(([from, to]) => from <= to);
  for (const [from, to] of inChat.sort((a, b) => a[0] - b[0])) {
    const end = out.at(-1);
    if (end && from <= end[1] + 1) end[1] = Math.max(end[1], to);
    else out.push([from, to]);
  }
  return out;
}

const measure = (spans: readonly Span[]): number => spans.reduce((n, [from, to]) => n + to - from + 1, 0);

/** Of the chat's messages as the plan found them: those of the stretches done, those its summaries cover beside them, and the rest. */
function messagesOf(lines: readonly PrepareStretchLine[]): { total: number; relived: number; filled: number; neither: number } {
  const relived = merged(lines.filter((s) => s.state === "done").map((s): Span => [s.from, s.to]));
  const covered = merged(CHAT.covered.map((c): Span => [c.from, c.to]));
  let both = 0;
  for (const [cf, ct] of covered) for (const [rf, rt] of relived) both += Math.max(0, Math.min(ct, rt) - Math.max(cf, rf) + 1);
  const done = Math.min(CHAT.messages, measure(relived));
  const filled = Math.min(CHAT.messages - done, measure(covered) - both);
  return { total: CHAT.messages, relived: done, filled, neither: CHAT.messages - done - filled };
}

/** The log's entries that halt the reliving, and those that let it go on. */
const HALTS: readonly PrepareTrailEntry["what"][] = ["paused", "stopped", "cancelled", "said"];
const GOES: readonly PrepareTrailEntry["what"][] = ["resumed", "carried", "approved", "reopened"];

/** A rough time left for the stretches not yet done, at the pace of those done so far, less the time it was halted (the backend's `leftOf`). */
function leftOf(log: readonly PrepareTrailEntry[], lines: readonly PrepareStretchLine[]): { ms: number; stretches: number } | null {
  const starts = log.filter((e) => e.what === "opened").map((e) => e.at);
  if (starts.length === 0) return null;
  const start = Math.min(...starts);
  const timed = lines.flatMap((s) => {
    if (s.state !== "done") return [];
    const times = log.filter((e) => e.stretch === s.id && (e.what === "relived" || e.what === "recorded")).map((e) => e.at);
    return times.length > 0 && Math.max(...times) >= start ? [Math.max(...times)] : [];
  });
  const remaining = lines.filter((s) => s.state === "waiting" || s.state === "reading" || s.state === "reliving").length;
  if (timed.length === 0 || remaining === 0) return null;
  const end = Math.max(...timed);
  let held = 0;
  let since: number | null = null;
  for (const e of log) {
    if (e.at < start || e.at > end) continue;
    if (HALTS.includes(e.what)) since ??= e.at;
    else if (GOES.includes(e.what) && since !== null) {
      held += e.at - since;
      since = null;
    }
  }
  if (since !== null) held += end - since;
  const active = end - start - held;
  return active > 0 ? { ms: Math.round((active / timed.length) * remaining), stretches: remaining } : null;
}

/** The plan as the author keeps it in the chat's area (`author/prepare.md`). */
function planText(view: PrepareView): string {
  const plan = view.plan;
  if (plan === null) return "# The prepared start\n\nNo plan yet.";
  return [
    `# The prepared start`,
    "",
    plan.story,
    "",
    "## Principals",
    ...plan.principals.map((p) => `- ${NAMES[p.entity] ?? p.entity}: ${p.why}`),
    "",
    "## Stretches",
    ...plan.stretches.map((s) => `- ${s.id}, #${s.from} to #${s.to}${s.key ? " (a key moment)" : ""}: ${s.why}`),
    "",
    "## How deep",
    `The author recommends ${plan.recommended.depth}: ${plan.recommended.why} It goes to ${plan.depth}.`,
  ].join("\n");
}

/** Every place `?prepare=` may start the prepared start: each state the card can be in, and the offer. */
const PREPARE_STARTS: Readonly<Record<PrepareState | "offer", true>> = { offer: true, none: true, planning: true, revising: true, waiting: true, running: true, paused: true, done: true, cancelled: true, failed: true, unreachable: true };

/** Where `?prepare=` starts the prepared start. */
export function prepareParam(value: string | null): PrepareState | "offer" {
  return (Object.keys(PREPARE_STARTS) as (PrepareState | "offer")[]).find((k) => k === value) ?? "offer";
}
