// The story engine's pages in the preview (`?engine=harness`): a made-up story in Maple Falls for
// Harness → Cast, Record and Notebook, the prepared start on Play → Now, and the chat's workspace as
// LumiAH's backend answers it (`lah.ws.list`, `read`, `write`), all held in memory, so a pin, a file
// saved, Go ahead or Pause change what the next read gives. `&prepare=offer|planning|waiting|running|
// paused|failed|done` (default offer) is where the prepared start begins; while it works, each read
// moves it on a step, as the author and the historian would.

import type { CastStanding } from "../../src/shared/ledger";
import type { Beat, Draft } from "../../src/shared/ledger";
import type { BeatView, BudgetUseView, CastRowView, CastView, PrepareAsk, PrepareState, PrepareView, ReachedItem, ReachedView, RecordView, StoryAnswer, StoryAsk, StoryAt, StoryNames, StoryTime } from "../../src/shared/story-pages";

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
  private prepare: PrepareView;
  private steps = 0;

  constructor(prepare: PrepareState | "offer") {
    const now = Date.now();
    for (const [path, f] of Object.entries(FILES)) this.files.set(path, { text: f.text, at: now - f.ago, by: f.by, hash: hashOf() });
    this.prepare = prepareAt(prepare);
    if (this.prepare.plan !== null) this.files.set("author/prepare.md", { text: planText(this.prepare), at: now - 60_000, by: "author", hash: hashOf() });
  }

  /** The answer to one of the story pages' requests, or to LumiAH's workspace's; undefined for anything else. */
  answer(payload: unknown): unknown {
    if (typeof payload !== "object" || payload === null || !("type" in payload) || !("reqId" in payload)) return undefined;
    const { type, reqId } = payload as { type: string; reqId: string };
    if (type === "lre.story" || type === "lre.prepare") {
      const ask = payload as unknown as { op: string };
      try {
        const body = type === "lre.story" ? this.story(ask as StoryAsk) : this.prepared(ask as PrepareAsk);
        return { lre: 1, type: "lre.result", reqId, request: type, body };
      } catch (error) {
        return { lre: 1, type: "lre.error", reqId, code: "conflict", message: error instanceof Error ? error.message : String(error) };
      }
    }
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

  // -------------------------------------------------------------- lre.prepare

  private prepared(ask: PrepareAsk): PrepareView {
    const p = this.prepare;
    switch (ask.op) {
      case "get":
        this.advance();
        break;
      case "start":
        if (p.state !== "none" && p.state !== "cancelled") throw new Error("Preparing is under way already.");
        this.prepare = { ...prepareAt("planning"), steered: p.steered, cap: p.cap };
        this.steps = 0;
        break;
      case "approve":
        if (p.state !== "waiting") throw new Error("There's no plan waiting for your word.");
        this.prepare = { ...p, state: "running", note: null };
        break;
      case "steer":
        this.prepare = { ...p, steered: [...p.steered, ask.text] };
        break;
      case "cap":
        this.prepare = { ...p, cap: ask.tokens };
        break;
      case "pause":
        this.prepare = { ...p, state: "paused", note: "You paused it. Carry on picks up where it stopped." };
        break;
      case "resume":
        this.prepare = { ...p, state: p.plan === null ? "planning" : "running", note: null };
        break;
      case "cancel":
        this.prepare = { ...p, state: "cancelled", offer: "This chat has 42 messages from before its world was attached. The plan so far stays in the notebook.", note: null };
        break;
    }
    return structuredClone(this.prepare);
  }

  /** One step of work since the last read: the plan written, or a stretch moved on. */
  private advance(): void {
    const p = this.prepare;
    this.steps += 1;
    if (p.state === "planning" && this.steps >= 2) {
      this.prepare = { ...prepareAt("waiting"), steered: p.steered, cap: p.cap };
      this.files.set("author/prepare.md", { text: planText(this.prepare), at: Date.now(), by: "author", hash: hashOf() });
    } else if (p.state === "running" && p.plan !== null) {
      const stretches = p.plan.stretches.map((s) => ({ ...s }));
      const next = stretches.find((s) => s.state === "open") ?? stretches.find((s) => s.state === "planned");
      if (next) {
        if (next.state === "planned") next.state = "open";
        else {
          next.state = "recorded";
          next.beats = 6;
        }
      }
      const left = stretches.filter((s) => s.state !== "recorded" && s.state !== "dropped");
      this.prepare = { ...p, plan: { ...p.plan, stretches }, spent: p.spent + 27_500, state: left.length === 0 ? "done" : "running", notYet: left.map((s) => `Messages ${s.from} to ${s.to}: ${s.why}`) };
    }
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

/** The plan the preview's author writes. */
function preparePlan(): NonNullable<PrepareView["plan"]> {
  return {
    story: "A small-town diner that may not see winter, and the people who'd lose it: Rosie, who carries the rent alone; Sam, new in town; Mara, who owes Rosie more than money.",
    principals: [
      { entity: "npc_rosie", why: "The diner is hers; every thread runs through her." },
      { entity: "npc_mara", why: "Her debt to Rosie is the story's fuse." },
    ],
    stretches: [
      { id: "s1", from: 1, to: 14, why: "Sam's first week: how Rosie came to trust him.", who: ["npc_rosie"], state: "planned", beats: 0 },
      { id: "s2", from: 15, to: 30, why: "The spring loan: what Rosie and Mara each remember of it.", who: ["npc_rosie", "npc_mara"], state: "planned", beats: 0 },
      { id: "s3", from: 31, to: 42, why: "Last night's argument at the Lakeside.", who: ["npc_mara"], state: "planned", beats: 0 },
    ],
    summaries: "Teo's band and the town's festival are filled from the chat's summaries and the world's lore.",
    authorEstimate: 210_000,
    reckoned: 240_000,
    call: { tokens: 6_000, from: "job" },
    ceiling: 200_000,
  };
}

/** The prepared start as it stands in `state`. */
function prepareAt(state: PrepareState | "offer"): PrepareView {
  const base: PrepareView = { offer: null, state: state === "offer" ? "none" : state, plan: null, estimate: null, spent: 0, cap: null, steered: [], notYet: [], note: null, names: NAMES };
  const plan = preparePlan();
  const notYet = plan.stretches.map((s) => `Messages ${s.from} to ${s.to}: ${s.why}`);
  switch (state) {
    case "offer":
    case "none":
      return { ...base, offer: "This chat has 42 messages from before its world was attached." };
    case "planning":
      return { ...base, spent: 4_200, notYet: ["The author's plan: it is reading the chat so far."] };
    case "waiting":
      return { ...base, plan, estimate: 240_000, spent: 21_800, notYet, note: "The plan is reckoned at 240,000 tokens, above your ceiling of 200,000, so it waits for your word. Nothing is relived until you give it." };
    case "running":
      return { ...base, plan: { ...plan, stretches: plan.stretches.map((s, i) => (i === 0 ? { ...s, state: "recorded", beats: 9 } : s)) }, estimate: 240_000, spent: 122_300, notYet: notYet.slice(1) };
    case "paused":
      return { ...base, plan: { ...plan, stretches: plan.stretches.map((s, i) => (i === 0 ? { ...s, state: "recorded", beats: 9 } : s)) }, estimate: 240_000, spent: 122_300, notYet: notYet.slice(1), note: "You paused it. Carry on picks up where it stopped." };
    case "failed":
      return { ...base, plan, estimate: 240_000, spent: 42_100, notYet, note: "The author's job stopped: the connection refused the request (rate limited). Carry on tries again from the plan." };
    case "cancelled":
      return { ...base, offer: "This chat has 42 messages from before its world was attached. The plan so far stays in the notebook." };
    case "done":
      return { ...base, plan: { ...plan, stretches: plan.stretches.map((s) => ({ ...s, state: "recorded", beats: 7 })) }, estimate: 240_000, spent: 231_000 };
  }
}

/** The plan as the author keeps it in its notebook (`author/prepare.md`). */
function planText(view: PrepareView): string {
  const plan = view.plan;
  if (plan === null) return "# The prepared start\n\nNo plan yet.";
  return [`# The prepared start`, "", plan.story, "", "## Principals", ...plan.principals.map((p) => `- ${NAMES[p.entity] ?? p.entity}: ${p.why}`), "", "## Stretches", ...plan.stretches.map((s) => `- #${s.from} to #${s.to}: ${s.why}`)].join("\n");
}

/** Where `?prepare=` starts the prepared start. */
export function prepareParam(value: string | null): PrepareState | "offer" {
  const known: readonly (PrepareState | "offer")[] = ["offer", "none", "planning", "waiting", "running", "paused", "done", "cancelled", "failed"];
  return known.find((k) => k === value) ?? "offer";
}
