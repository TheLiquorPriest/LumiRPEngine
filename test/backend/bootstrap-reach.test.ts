// How the bootstrap's beats reach the minds it forms (DEPTH-PLAN §4.2, §8), on a small starter-world
// chat with fake model answers: the player character's acts reach whoever was there and him, and an
// actor the historian left out perceives its own act; a character lives its own act as its own and a
// text it received as the text's words, never the sender's surroundings; the point-of-view render is
// told only how its perceiver may name the people of the beat; a place made from an earlier stretch
// is named by the historian, never made again; and where the historian writes each beat's deed, each
// actor lives its own act as it did it (a call, an answer through a door, a text sent from elsewhere),
// never a surface written from the player character's side, with no point of view asked for it.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import type { BootstrapView } from "../../src/shared/bootstrap";
import { mindV2At } from "../../src/shared/character-engine";
import type { DepthMindView } from "../../src/shared/depth-views";
import { Rig } from "../support/rig";
import { DANNY, MARCUS, PRIYA } from "../support/mind-chat";
import { readyLoopback } from "../support/relay";

const PROSE = "The kettle ticked on the stove while the rain worked at the window, and the shop smelled of solder and wet coats. ".repeat(30);
const BEAT_IDS = /\bb[0-9a-f]{16,}\b/g;
const BUNKHOUSE = /^- The bunkhouse \(id: (bsp_[0-9a-f]+)\)$/m;

/** A Port Alder chat with history written before depth: the player fixes Danny's truck, Danny texts Priya from the bunkhouse, Priya brings him the invoice there, and he leaves. */
async function historyChat(rig: Rig): Promise<string> {
  await readyLoopback(rig);
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  const chat = rig.host.chat(chatId);
  const say = (i: number, isUser: boolean, text: string): void => void rig.host.append(chat, { id: `h${i}`, isUser, name: isUser ? "User" : "Narrator", swipes: [text], swipeId: 0, bag: {} });
  say(1, true, "I tell Danny the truck's fixed and toss him the keys.");
  say(2, false, `Danny catches them, climbs into the cab out by the bunkhouse and thumbs a text to Priya. ${PROSE}`);
  say(3, true, "I walk out to the bunkhouse.");
  say(4, false, `Priya crosses the wet gravel to Danny and hands him the invoice. ${PROSE}`);
  say(5, true, "I head home.");
  say(6, false, `Danny calls something about tomorrow across the yard. ${PROSE}`);
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { depth: { bootstrap: { chunkTokens: 2000 } } } }));
  return chatId;
}

const text = (req: QuietRequest): string => req.messages.map((m) => m.content).join("\n");

/** Each message's beat as the historian answers it; at h4 the bunkhouse is the place the run made from h2, by the id the prompt lists. */
function beatAt(id: string, bunkhouse: string | null): Record<string, unknown> {
  switch (id) {
    case "h1":
      // The player character acts and speaks; the answer lists only Danny.
      return { message: id, actors: ["pov"], act: "said", about: [DANNY], addressed: [DANNY], what: "Jordan tells Danny the truck is fixed and tosses him the keys.", surface: "Jordan, saying the truck's fixed; keys arcing through the air (h1).", quotes: "Truck's fixed (h1).", exposure: [{ who: DANNY, channel: "hearing", reach: "whole" }] };
    case "h2":
      // Danny texts Priya, who is elsewhere; the answer leaves Danny out of who perceived it.
      return { message: id, place: "new:bunkhouse", actors: [DANNY], act: "said", about: [PRIYA], addressed: [PRIYA], what: "Danny texts Priya that he is running late.", surface: "TRUCK-SURFACE: Danny in the cab by the bunkhouse, the engine idling, thumbs on his phone (h2).", quotes: "Running late, save me a seat (h2).", exposure: [{ who: PRIYA, channel: "message", reach: "whole" }] };
    case "h3":
      return { message: id, actors: ["pov"], act: "did", about: [], what: "Jordan walks out to the bunkhouse.", surface: "Footsteps on the gravel (h3).", exposure: [] };
    case "h4":
      // Priya's own act; the answer lists only Danny, who saw it.
      return { message: id, ...(bunkhouse ? { place: bunkhouse } : {}), actors: [PRIYA], act: "did", about: [DANNY], what: "Priya hands Danny the invoice.", surface: "WALK-SURFACE: a woman crosses the wet gravel and hands a man a folded invoice (h4).", exposure: [{ who: DANNY, channel: "sight", reach: "whole" }] };
    case "h5":
      return { message: id, actors: ["pov"], act: "did", about: [], what: "Jordan heads home.", surface: "Jordan walking off up the lane (h5).", exposure: [] };
    default:
      // Only part of Danny's call across the yard reaches Priya.
      return { message: id, actors: [DANNY], act: "said", about: [], what: "Danny calls to Priya that he will see her tomorrow.", surface: "Danny, calling across the yard (h6).", quotes: "See you tomorrow (h6).", exposure: [{ who: PRIYA, channel: "hearing", reach: "partial" }] };
  }
}

interface Seen {
  historian: string[];
  pov: string[];
  catchUp: { name: string; user: string }[];
}

/** Fake answers by the answer each prompt asks for, keeping what the historian, the render and each catch-up were asked. */
function fakeModels(rig: Rig): Seen {
  const seen: Seen = { historian: [], pov: [], catchUp: [] };
  rig.host.quietReply = (req) => {
    const all = text(req);
    const user = req.messages.at(-1)?.content ?? "";
    if (all.includes('"beats": [{"message"')) {
      seen.historian.push(user);
      const ids = [...user.matchAll(/^\[(h\d+)\] /gm)].map((m) => m[1] as string);
      const made = BUNKHOUSE.exec(user)?.[1] ?? null;
      return JSON.stringify({
        beats: ids.map((id) => beatAt(id, made)),
        staging: [{ who: DANNY, where: "by the truck", doing: "pocketing the keys" }, { who: "jess_kowalczyk", where: "behind the bar at the Rusty Anchor", doing: "pouring a pint" }],
        newcomers: [],
        // The bunkhouse, met at h2 and named again where the story is back there: made once.
        newPlaces: ids.includes("h2") || ids.includes("h4") ? [{ ref: "new:bunkhouse", name: "The bunkhouse", in: "port_alder", note: "the bunkhouse out back" }] : [],
        switches: [],
        uncertain: [],
      });
    }
    if (all.includes('"chapter": {"ends"')) return JSON.stringify({ files: [], comments: [], chapter: { ends: false }, cast: [{ who: DANNY, mind: true, why: "He drives it." }, { who: PRIYA, mind: true, why: "She is always there." }], uncertain: [], reasoning: "" });
    if (all.includes('{"povs":')) {
      seen.pov.push(all);
      // One point of view for each person asked (no rule writes a missing one): Priya's is the call across the yard.
      const asked = [...(req.messages.at(-1)?.content ?? "").matchAll(/^### ([^:\n]+)/gm)].map((m) => m[1] as string);
      return JSON.stringify({ povs: Object.fromEntries(asked.map((who) => [who, who === PRIYA ? "A voice across the yard: something about tomorrow." : "Someone there, as you saw and heard it."])) });
    }
    if (all.includes('"memories": [{"lived"')) {
      seen.catchUp.push({ name: /You are (.+?), a person in a story/.exec(req.messages[0]?.content ?? "")?.[1] ?? "", user });
      const lived = [...new Set((user.split("## What reached you\n")[1] ?? "").match(BEAT_IDS) ?? [])];
      return JSON.stringify({ memories: lived.length > 0 ? [{ lived, about: [], text: "What I made of it." }] : [], beliefs: null, people: {}, plans: null });
    }
    if (all.includes('"facts": [{"ref"')) return JSON.stringify({ facts: [], links: [], unlinks: [], settle: [] });
    if (all.includes('"on_my_mind"')) return JSON.stringify({ self: null, on_my_mind: null, beliefs: null, people: {}, plans: null, planned: [], now: null });
    return "{}";
  };
  return seen;
}

async function bootstrap(rig: Rig, chatId: string, op: Record<string, unknown>): Promise<{ view: BootstrapView }> {
  return rig.body(await rig.send({ type: "lre.bootstrap", chatId, ...op })) as { view: BootstrapView };
}

describe("the bootstrap's beats reach its minds", () => {
  test("the player character's acts reach whoever was there; each character lives its own act as its own and a text as its words; the render names only whom its perceiver may; a place is made once", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await historyChat(rig);
    const seen = fakeModels(rig);
    await bootstrap(rig, chatId, { op: "opt", on: true });
    await bootstrap(rig, chatId, { op: "start", cap: "none" });
    await rig.dispatch.bootstraps.idle();
    await rig.host.settle();
    const view = (await bootstrap(rig, chatId, { op: "status" })).view;
    expect(view.status).toBe("done");
    expect(view.log.filter((l) => l.includes("wasn't kept") || l.includes("named someone"))).toEqual([]);
    expect(seen.historian.length).toBeGreaterThan(1);

    const story = await rig.rt.ledger.readStory(chatId, rig.host.userId);
    const at = (message: string) => story.beats.find((p) => "bootstrap" in p.beat.by && p.beat.by.bootstrap.message === message)?.beat;
    const [h1, h2, h4, h6] = [at("h1"), at("h2"), at("h4"), at("h6")];
    if (!h1 || !h2 || !h4 || !h6) throw new Error("a beat is missing");
    // His act reached Danny, who heard it, and him; hers and Danny's reached each of them too, though the answer left them out.
    expect(h1.exposure.map((x) => [x.who, x.pending ?? false])).toEqual([[DANNY, true], ["pov", false]]);
    expect(h2.exposure.map((x) => x.who)).toEqual([PRIYA, DANNY]);
    expect(h4.exposure.map((x) => x.who)).toEqual([DANNY, PRIYA]);

    const priya = seen.catchUp.filter((c) => c.name === "Priya Nair").map((c) => c.user).join("\n");
    const danny = seen.catchUp.filter((c) => c.name === "Danny Okafor").map((c) => c.user).join("\n");
    // The text reached Priya as its words, from Danny, with no place: never his cab and engine.
    expect(priya).toMatch(new RegExp(`\\[beat ${h2.id}\\] [^\\n]*\\(a message to you from Danny Okafor\\)\\nRunning late, save me a seat \\(h2\\)\\.`));
    expect(priya).not.toContain("TRUCK-SURFACE");
    // Her crossing to him she lives as her own act; Danny lives his texting as his.
    expect(priya).toMatch(new RegExp(`\\[beat ${h4.id}\\] [^\\n]*\\(your own act, as those there could see and hear it\\)\\nWALK-SURFACE`));
    expect(danny).toMatch(new RegExp(`\\[beat ${h2.id}\\] [^\\n]*\\(your own act, as those there could see and hear it\\)\\nTRUCK-SURFACE`));
    const state = (await rig.rt.ledger.foldAtBasis(chatId, rig.host.userId, (await rig.rt.ledger.basisFor(chatId, rig.host.userId))!))!.state;
    for (const [who, beat] of [[PRIYA, h2], [PRIYA, h4], [DANNY, h1], [DANNY, h2], [DANNY, h4]] as const) expect(mindV2At(state, who).lived[beat.id]).toBe(true);

    // The call across the yard reached Priya in part: its render named Danny, whom she knows, and no one who wasn't there; the stretch's closing staging placed only the beat's people.
    // The other renders are for what someone heard alone (LIVE3c L3c-4: never what there was to see), whole.
    const part = seen.pov.filter((p) => p.includes(`### ${PRIYA}: by hearing; in part`));
    expect(part).toHaveLength(1);
    for (const p of seen.pov) if (!part.includes(p)) expect(p).toMatch(/### [^\n]+: by hearing; whole\n/);
    expect(part[0]).toContain(`- ${DANNY}: Danny Okafor`);
    for (const never of ["Jess", "Marcus", "Rusty Anchor", "Priya Nair"]) expect(part[0]).not.toContain(never);
    expect(h6.exposure.find((x) => x.who === PRIYA)?.pov).toBeDefined();

    // The bunkhouse, made from h2's stretch, was listed by id to the next stretch's historian; h4 happens there, and it was made once.
    const made = BUNKHOUSE.exec(seen.historian[1] ?? "")?.[1];
    expect(made).toBeDefined();
    expect(h4.place).toBe(made ?? "");
    const world = (await rig.rt.ledger.foldAtBasis(chatId, rig.host.userId, (await rig.rt.ledger.basisFor(chatId, rig.host.userId))!))!.world;
    expect(Object.values(world.places).filter((p) => p.name === "The bunkhouse").map((p) => p.id)).toEqual([made ?? ""]);
  }, 60_000);
});

const HELEN = "helen_kowalczyk";

/** One morning at 114 Harbor Street, as the history wrote it before depth (a live run, LIVE2). */
const MORNING =
  "6:15. Across the landing Danny's door bangs, and he whistles his way down the stairs. \"Morning, Helen! Coffee's on at the shop if you want it!\" he calls down to the ground floor. From behind the door of 1A, Helen calls back, \"Save me a cup, love!\" On your nightstand the phone buzzes: Marcus, to you and Danny. \"Both of you at the shop by 7. Ferris truck.\"";

/** Each beat as the historian answers it: the deed as its actor did it, and the surface as the history had it before, from upstairs. */
const OUTSIDE = {
  call: { deed: "CALL-DEED: Danny calls down the stairs to Helen, offering her coffee at the shop.", surface: "UPSTAIRS-SURFACE: Danny's voice carries up through the old building as he calls down to the ground floor.", words: "Morning, Helen! Coffee's on at the shop if you want it!" },
  answer: { deed: "ANSWER-DEED: Helen calls back to Danny from behind her door.", surface: "MUFFLED-SURFACE: A muffled voice from 1A, unintelligible.", words: "Save me a cup, love!" },
  text: { deed: "TEXT-DEED: Marcus texts Jordan and Danny to be at the shop by seven.", surface: "NIGHTSTAND-SURFACE: A phone buzzes on the nightstand; the screen shows a text from Marcus.", words: "Both of you at the shop by 7. Ferris truck." },
} as const;

/** The morning's fake answers: the historian's three beats, minds for Danny, Helen and Marcus, and every catch-up and render kept as asked. */
function morningModels(rig: Rig): Seen {
  const seen: Seen = { historian: [], pov: [], catchUp: [] };
  rig.host.quietReply = (req) => {
    const all = text(req);
    const user = req.messages.at(-1)?.content ?? "";
    if (all.includes('"beats": [{"message"')) {
      seen.historian.push(user);
      const id = /^\[(h\d+)\] /m.exec(user)?.[1] ?? "";
      const beat = (actors: string[], addressed: string[], t: { deed: string; surface: string; words: string }, exposure: unknown[]) => ({ message: id, place: "harbor_street_114", actors, act: "said", about: addressed, addressed, what: `${t.deed.split(": ")[1]} (the truth)`, deed: t.deed, surface: t.surface, quotes: t.words, exposure });
      return JSON.stringify({
        beats: id === ""
          ? []
          : [
              // Danny's own call; Helen and Jordan hear it. The answer leaves him out of who perceived it.
              beat([DANNY], [HELEN], OUTSIDE.call, [{ who: HELEN, channel: "hearing", reach: "whole" }, { who: "pov", channel: "hearing", reach: "whole" }]),
              // Helen's answer through her door: Danny on the stairs hears it, Jordan upstairs in part, and the answer has her hear her own voice in part.
              beat([HELEN], [DANNY], OUTSIDE.answer, [{ who: DANNY, channel: "hearing", reach: "whole" }, { who: "pov", channel: "hearing", reach: "partial" }, { who: HELEN, channel: "hearing", reach: "partial" }]),
              // Marcus's text from home to Jordan and Danny, read where the story is.
              beat([MARCUS], ["pov", DANNY], OUTSIDE.text, [{ who: "pov", channel: "message", reach: "whole" }, { who: DANNY, channel: "message", reach: "whole" }]),
            ],
        staging: [{ who: DANNY, where: "on the stairs", doing: "reading his phone" }, { who: HELEN, where: "behind the door of 1A", doing: "putting the kettle on" }],
        newcomers: [],
        newPlaces: [],
        switches: [],
        uncertain: [],
      });
    }
    if (all.includes('"chapter": {"ends"')) return JSON.stringify({ files: [], comments: [], chapter: { ends: false }, cast: [DANNY, HELEN, MARCUS].map((who) => ({ who, mind: true, why: "They recur." })), uncertain: [], reasoning: "" });
    if (all.includes('{"povs":')) {
      seen.pov.push(all);
      return JSON.stringify({ povs: {} });
    }
    if (all.includes('"memories": [{"lived"')) {
      seen.catchUp.push({ name: /You are (.+?), a person in a story/.exec(req.messages[0]?.content ?? "")?.[1] ?? "", user });
      const lived = [...new Set((user.split("## What reached you\n")[1] ?? "").match(BEAT_IDS) ?? [])];
      return JSON.stringify({ memories: lived.length > 0 ? [{ lived, about: [], text: "What I made of the morning." }] : [], beliefs: null, people: {}, plans: null });
    }
    if (all.includes('"facts": [{"ref"')) return JSON.stringify({ facts: [], links: [], unlinks: [], settle: [] });
    if (all.includes('"on_my_mind"')) return JSON.stringify({ self: null, on_my_mind: null, beliefs: null, people: {}, plans: null, planned: [], now: null });
    return "{}";
  };
  return seen;
}

describe("outside views: each actor lives its own act as it did it", () => {
  test("Danny's own call, Helen's answer through her door and Marcus's text from home are each lived as its deed, never the surface from upstairs; Danny lives only the text's words, and no point of view is asked for any of them", async () => {
    const rig = new Rig({ shipped: true });
    await readyLoopback(rig);
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.host.append(rig.host.chat(chatId), { id: "h1", isUser: false, name: "Narrator", swipes: [MORNING], swipeId: 0, bag: {} });
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const seen = morningModels(rig);
    await bootstrap(rig, chatId, { op: "opt", on: true });
    await bootstrap(rig, chatId, { op: "start", cap: "none" });
    await rig.dispatch.bootstraps.idle();
    await rig.host.settle();
    expect((await bootstrap(rig, chatId, { op: "status" })).view.status).toBe("done");

    // Each beat keeps its deed beside its surface.
    const story = await rig.rt.ledger.readStory(chatId, rig.host.userId);
    const [call, answer, sent] = story.beats.map((p) => p.beat).filter((b) => "bootstrap" in b.by && b.by.bootstrap.message === "h1");
    if (!call || !answer || !sent) throw new Error("a beat is missing");
    for (const [b, t] of [[call, OUTSIDE.call], [answer, OUTSIDE.answer], [sent, OUTSIDE.text]] as const) expect(b.deed !== undefined ? await rig.rt.blobs.get(rig.host.userId, b.deed) : null).toBe(t.deed);

    const lived = (name: string): string => seen.catchUp.filter((c) => c.name === name).map((c) => c.user).join("\n");
    const heading = (all: string, beat: string): string => new RegExp(`^\\[beat ${beat}\\] [^\\n]*$`, "m").exec(all)?.[0] ?? "";
    // An actor's own call: Danny lives it as he did it, his words beside it, at the house.
    const danny = lived("Danny Okafor");
    expect(danny).toContain(`(your own act)\n${OUTSIDE.call.deed}\nWords said: ${OUTSIDE.call.words}`);
    expect(heading(danny, call.id)).toContain("at 114 Harbor Street (your own act)");
    expect(danny).not.toContain("UPSTAIRS-SURFACE");
    // An answer through a door: Helen lives hers whole, words and all, though the answer had her hear it in part.
    const helen = lived("Helen Kowalczyk");
    expect(helen).toContain(`(your own act)\n${OUTSIDE.answer.deed}\nWords said: ${OUTSIDE.answer.words}`);
    expect(helen).not.toContain("MUFFLED-SURFACE");
    // A text sent from elsewhere: Marcus lives sending it, nowhere near Jordan's nightstand or his house; Danny lives only its words, from him.
    const marcus = lived("Marcus Delgado");
    expect(marcus).toContain(`(your own act)\n${OUTSIDE.text.deed}\nWords said: ${OUTSIDE.text.words}`);
    expect(heading(marcus, sent.id)).not.toContain(" at ");
    expect(marcus).not.toContain("NIGHTSTAND-SURFACE");
    expect(heading(danny, sent.id)).toEndWith("(a message to you from Marcus Delgado)");
    expect(danny).toContain(`(a message to you from Marcus Delgado)\n${OUTSIDE.text.words}`);
    for (const never of ["NIGHTSTAND-SURFACE", OUTSIDE.text.deed]) expect(danny).not.toContain(never);
    // No point of view was asked for anyone's own act or a message: the deed and the words were enough. Only what someone heard alone got one (LIVE3c L3c-4).
    expect(seen.pov.length).toBeGreaterThan(0);
    for (const p of seen.pov) expect(p).not.toMatch(/^### [^\n]*(their own act|by message|in part)/m);
    const state = (await rig.rt.ledger.foldAtBasis(chatId, rig.host.userId, (await rig.rt.ledger.basisFor(chatId, rig.host.userId))!))!.state;
    for (const [who, beat] of [[DANNY, call], [HELEN, answer], [MARCUS, sent], [DANNY, sent]] as const) expect(mindV2At(state, who).lived[beat.id]).toBe(true);

    // GM → Minds says so too: what each own act gave its mind is its deed, whole.
    const mindOf = async (who: string): Promise<DepthMindView> => {
      // The mind op answers {mind} (`backend/depth-views.ts`).
      const answered = rig.body(await rig.send({ type: "lre.depth", op: "mind", chatId, who })) as { mind: DepthMindView };
      return answered.mind;
    };
    expect((await mindOf(MARCUS)).povs.find((p) => p.beat.id === sent.id)).toMatchObject({ reach: "whole", text: OUTSIDE.text.deed });
    expect((await mindOf(HELEN)).povs.find((p) => p.beat.id === answer.id)).toMatchObject({ reach: "whole", text: OUTSIDE.answer.deed });
    expect((await mindOf(DANNY)).povs.find((p) => p.beat.id === call.id)).toMatchObject({ reach: "whole", text: OUTSIDE.call.deed });
  }, 60_000);
});
