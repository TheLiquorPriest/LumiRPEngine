// What the narrator knows (DESIGN §6.11): the chat's own choice, else its world's default, else the
// user's Settings → Narrator; each section reads in that knowledge unless it sets its own scope; a
// line carrying a secret's words reaches the narrator marked as a secret, or not at all, and never a
// player surface; the Stance section claims nothing of what the narrator knows; a Lumiverse Branch
// keeps the chat's choices; and a turn prepared before they changed never goes out on them.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { markedText, secretLineText } from "../../src/engine/feed";
import type { SectionRenderer } from "../../src/engine/registry";
import type { WorldState } from "../../src/engine/state";
import { editRequest } from "../../src/frontend/requests";
import { STARTER_WORLDS } from "../../src/packs/index";
import { mindLines } from "../../src/packs/minds/core/section";
import type { JsonObject } from "../../src/shared/json";
import { neutralizeMacros } from "../../src/shared/macros";
import { MARK_TEXT_IDS } from "../../src/shared/prompts";
import type { EditOp, ResultBodies } from "../../src/shared/protocol";
import { SECRET_MARK_WORDING, secretMarkForms, secretMarkText, type SecretMarkWording } from "../../src/shared/secret-marks";
import { DEFAULT_SECTIONS } from "../../src/shared/sections";
import type { NarratorView } from "../../src/shared/settings";
import type { FeedScope, SectionTemplate, WorldDoc } from "../../src/shared/world";
import { Rig } from "../support/rig";

const PORT_ALDER = (STARTER_WORLDS["modern_slice_of_life"] as (id: string, name: string) => WorldDoc)("w", "Port Alder");
const POV_NAME = PORT_ALDER.entities[PORT_ALDER.pov]?.name ?? "";
/** What Marcus isn't saying, at its last stage: unrevealed from the start, so no line the player character may read carries it. */
const TRUTH = PORT_ALDER.tracks.s_shop_trouble?.stages.truth?.truth ?? "";
/** Where the player character wakes. */
const HERE = "harbor_street_114";
const DANNY = "danny_okafor";

const SECRET = "Vex Morrow";
const secretHere: Record<string, JsonObject> = { lurker: { id: "lurker", kind: "person", name: SECRET, tier: "background", fields: { place: HERE }, relations: [], visibility: "secret" } };
/** The People line that names him for the narrator: no one with the player character knows him. */
const LURKER = markedText({ text: `${SECRET} is here.`, known: "gm" });

const SCENE: NarratorView = { knowledge: "scene", secrets: "marked" };
const POV: NarratorView = { knowledge: "pov", secrets: "omit" };

interface AlderWorld {
  entities?: Record<string, JsonObject>;
  /** The world's sections, all of them: a world that lists any has only those. */
  sections?: Record<string, SectionTemplate>;
  /** The world's default for what the narrator knows. */
  narrator?: NarratorView;
  minds?: JsonObject;
}

/** A Port Alder chat whose world has these entities, sections, narrator default and minds settings. */
async function alder(rig: Rig, world: AlderWorld = {}): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  for (const [id, value] of Object.entries(world.sections ?? {})) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "sections", id, value }));
  for (const [id, value] of Object.entries(world.entities ?? {})) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id, value }));
  if (world.narrator) rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "meta", value: { narrator: world.narrator } }));
  if (world.minds) rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "minds", value: world.minds }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return chatId;
}

async function settings(rig: Rig, patch: Record<string, unknown>): Promise<void> {
  rig.body(await rig.send({ type: "lre.settings.set", patch }));
}

/** Saves the user's own wording of a secret's mark, part by part, as Settings → Agents → Prompts does (null resets a part). */
async function marks(rig: Rig, wording: Partial<Record<keyof SecretMarkWording, string | null>>): Promise<void> {
  await settings(rig, { prompts: { texts: Object.fromEntries(Object.entries(wording).map(([part, text]) => [MARK_TEXT_IDS[part as keyof SecretMarkWording], text])) } });
}

/** The narrator rules' sentence on marks as a turn sends it: `wording`'s rule, with each form its marks take and its word for everyone. */
function ruleOf(wording: SecretMarkWording): string {
  return neutralizeMacros(wording.rule.replace("{{forms}}", secretMarkForms(wording).join(" or ")).replace("{{everyone}}", wording.everyone));
}

/** A section budget with room for every marked fact, so nothing a test looks for is left out for space. */
async function roomy(rig: Rig): Promise<void> {
  await settings(rig, { modelUse: { tokens: { sections: 100_000 } } });
}

/** GM → This chat → Knowledge: sets the parts given, and answers with the chat's own choices. */
async function chatKnowledge(rig: Rig, chatId: string, change: { knowledge?: boolean | null; narrator?: NarratorView | null }): Promise<ResultBodies["lre.chat.knowledge"]> {
  return rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, ...change })) as unknown as ResultBodies["lre.chat.knowledge"];
}

async function edit(rig: Rig, chatId: string, op: EditOp): Promise<void> {
  rig.body(await rig.send(editRequest(chatId, [op]) as unknown as Record<string, unknown>));
}

async function preview(rig: Rig, chatId: string): Promise<ResultBodies["lre.sections"]> {
  return rig.body(await rig.send({ type: "lre.sections", chatId })) as unknown as ResultBodies["lre.sections"];
}

const bullets = (content: string | null | undefined): string[] => (content ?? "").split("\n").flatMap((l) => (l.startsWith("- ") ? [l.slice(2)] : []));

/** The lines of the section the last reply's prompt held for `slot`. */
const told = (rig: Rig, slot: string): string[] => bullets(rig.host.section(DEFAULT_SECTIONS[slot]?.label ?? slot));

/** Everything the engine put in the last reply's prompt. */
const prompt = (rig: Rig): string => rig.host.assembled.map((e) => e.content).join("\n");

/** Every player surface of the chat as one text: the view as pushed and as asked for, and each of its panels as opened. */
async function playerSurfaces(rig: Rig, chatId: string): Promise<string> {
  const view = await rig.rt.view(chatId, rig.host.userId);
  const panels: unknown[] = [];
  for (const panel of Object.keys(view.panels)) panels.push(rig.body(await rig.send({ type: "lre.view.open", chatId, panel })));
  return JSON.stringify([rig.latestView(chatId), view, panels]);
}

async function stateOf(rig: Rig, chatId: string): Promise<{ state: WorldState; world: WorldDoc }> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  if (!core) throw new Error("no ledger");
  const state = core.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  const world = core.worldAt(state.revision);
  if (!world) throw new Error("no world");
  return { state, world };
}

/** Every shipped section's scope as the preview reports it: `scope`, but where `own` gives one. */
const every = (scope: FeedScope, own: Record<string, FeedScope> = {}): Record<string, FeedScope> => Object.fromEntries(Object.values(DEFAULT_SECTIONS).map((s) => [s.id, own[s.id] ?? scope]));

describe("what the narrator knows, and whose choice it is", () => {
  test("the user's Settings apply where the world and the chat set none; a world's default beats them, the chat's own beats the world's, and null returns the chat to the world's", async () => {
    const rig = new Rig({ shipped: true });
    await roomy(rig);
    const narrator = async (chatId: string) => (await rig.rt.view(chatId, rig.host.userId)).controls?.knowledge.narrator;
    // Settings → Narrator alone, as shipped: everyone in the scene, so the secret person is named, marked for the narrator.
    const plain = await alder(rig, { entities: secretHere });
    await rig.turn(plain, "I look around.", "Quiet.");
    expect(told(rig, "people")).toContain(LURKER);
    expect(await narrator(plain)).toEqual({ chat: null, world: null, user: SCENE });
    // The player character's knowledge alone: never named.
    await settings(rig, { narrator: POV });
    await rig.turn(plain, "I look around again.", "Still quiet.");
    expect(prompt(rig)).not.toContain(SECRET);
    expect(await narrator(plain)).toEqual({ chat: null, world: null, user: POV });
    // A world's default over the user's.
    const chatId = await alder(rig, { entities: secretHere, narrator: SCENE });
    await rig.turn(chatId, "I look around.", "Quiet.");
    expect(told(rig, "people")).toContain(LURKER);
    expect(await narrator(chatId)).toEqual({ chat: null, world: SCENE, user: POV });
    // The chat's own over the world's.
    expect(await chatKnowledge(rig, chatId, { narrator: POV })).toEqual({ knowledge: null, narrator: POV });
    await rig.turn(chatId, "I look around again.", "Still quiet.");
    expect(prompt(rig)).not.toContain(SECRET);
    expect(await narrator(chatId)).toEqual({ chat: POV, world: SCENE, user: POV });
    // Null: the chat follows its world's again.
    expect(await chatKnowledge(rig, chatId, { narrator: null })).toEqual({ knowledge: null, narrator: null });
    await rig.turn(chatId, "And again.", "Nothing new.");
    expect(told(rig, "people")).toContain(LURKER);
    expect(await narrator(chatId)).toEqual({ chat: null, world: SCENE, user: POV });
    // No player surface named him, whatever the narrator knew.
    for (const id of [plain, chatId]) expect(await playerSurfaces(rig, id)).not.toContain(SECRET);
  });

  test("the chat's knowledge tracking is its own, kept with the chat, and null returns it to the user's switch", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await alder(rig);
    const user = (await rig.rt.settings.get(rig.host.userId)).minds.knowledge.enabled;
    const tracking = async (r: Rig) => (await r.rt.view(chatId, r.host.userId)).controls?.knowledge.tracking;
    expect(await tracking(rig)).toEqual({ chat: null, user });
    expect(await chatKnowledge(rig, chatId, { knowledge: !user })).toEqual({ knowledge: !user, narrator: null });
    expect(await tracking(rig)).toEqual({ chat: !user, user });
    // Only a world chat has choices of its own, and only ones it can take.
    const loose = rig.host.createChat("Hello.");
    const refused = await rig.send({ type: "lre.chat.knowledge", chatId: loose, knowledge: true });
    expect(refused.type === "lre.error" ? refused.code : null).toBe("not_world_chat");
    const bad = await rig.send({ type: "lre.chat.knowledge", chatId, narrator: { knowledge: "everyone", secrets: "marked" } });
    expect(bad.type === "lre.error" ? bad.code : null).toBe("bad_request");
    // Kept with the chat, not in memory: a backend started afresh reads them back, and a read alone changes nothing.
    const again = rig.restart();
    expect(await chatKnowledge(again, chatId, {})).toEqual({ knowledge: !user, narrator: null });
    expect(await tracking(again)).toEqual({ chat: !user, user });
    // Each part is set on its own, the other left as it is.
    expect(await chatKnowledge(again, chatId, { narrator: POV })).toEqual({ knowledge: !user, narrator: POV });
    // Null: the chat follows the user's switch, wherever the user moves it.
    expect(await chatKnowledge(again, chatId, { knowledge: null })).toEqual({ knowledge: null, narrator: POV });
    await settings(again, { minds: { knowledge: { enabled: !user } } });
    expect(await tracking(again)).toEqual({ chat: null, user: !user });
  });
});

describe("section scopes follow what the narrator knows", () => {
  test("a section with no scope of its own reads as the narrator knows; the GM's scope for one holds under either view, and the GM's settings without one follow it; a world's own scope holds under the world's or the user's view and gives way to the chat's own", async () => {
    const rig = new Rig({ shipped: true });
    await roomy(rig);
    const place = DEFAULT_SECTIONS.place;
    if (!place) throw new Error("no shipped Place");
    // The world sets the Place section's scope itself; no other section sets one.
    const sections: Record<string, SectionTemplate> = { ...DEFAULT_SECTIONS, place: { ...place, scope: "scene" } };
    const chatId = await alder(rig, { entities: secretHere, sections });
    const scopes = async (id: string): Promise<Record<string, FeedScope>> => Object.fromEntries((await preview(rig, id)).sections.map((s) => [s.slot, s.scope]));
    const people = async (): Promise<string[]> => bullets((await preview(rig, chatId)).sections.find((s) => s.slot === "people")?.content);
    // The user's view, as shipped: everyone in the scene's knowledge is the GM scope, each fact beyond the player character's marked.
    expect(await scopes(chatId)).toEqual(every("gm", { place: "scene" }));
    expect(await people()).toContain(LURKER);
    // The player character's view.
    await settings(rig, { narrator: POV });
    expect(await scopes(chatId)).toEqual(every("player", { place: "scene" }));
    expect((await people()).join("\n")).not.toContain(SECRET);
    // The GM's settings for a section stand whole: with a scope it holds under either view; without one, the section follows the view.
    await edit(rig, chatId, { op: "feed", section: "people", to: { scope: "scene" } });
    await edit(rig, chatId, { op: "feed", section: "gear", to: { maxLines: 5 } });
    expect(await scopes(chatId)).toEqual(every("player", { place: "scene", people: "scene" }));
    await settings(rig, { narrator: SCENE });
    expect(await scopes(chatId)).toEqual(every("gm", { place: "scene", people: "scene" }));
    // The scene scope tells only what someone with the player character knows, and no one here knows him.
    expect((await people()).join("\n")).not.toContain(SECRET);
    // The chat's own view comes before the world's scope for its section, never before the GM's.
    await chatKnowledge(rig, chatId, { narrator: POV });
    expect(await scopes(chatId)).toEqual(every("player", { people: "scene" }));
    await chatKnowledge(rig, chatId, { narrator: SCENE });
    expect(await scopes(chatId)).toEqual(every("gm", { people: "scene" }));
    // Under a world's default view the world's scope for its section holds too.
    const worldView = await alder(rig, { sections, narrator: POV });
    expect(await scopes(worldView)).toEqual(every("player", { place: "scene" }));
  });
});

describe("a secret's words: marked for the narrator, or left out", () => {
  test("a line carrying an unrevealed truth reaches the narrator marked as a secret kept from the player character, or not at all, and never a player surface; a GM-only fact carrying it keeps its own mark, or is left out too", async () => {
    expect(TRUTH).not.toBe("");
    const rig = new Rig({ shipped: true });
    await roomy(rig);
    const heard = `Overheard at the counter: ${TRUTH}`;
    const books = `The shop's books say: ${TRUTH}`;
    const probes: SectionRenderer[] = [
      { slot: "scene", source: "probe_heard", label: "What was overheard", render: () => [heard] },
      { slot: "scene", source: "probe_books", label: "What the books say", render: () => [], feed: (_ctx, scope) => (scope === "gm" ? [{ text: books, known: "gm" }] : []) },
    ];
    (rig.rt.registry.renderers as SectionRenderer[]).push(...probes);
    const chatId = await alder(rig);
    // Marked, as shipped: the plain line as a secret kept from the player character, the GM's fact with its own mark.
    await rig.turn(chatId, "I look around.", "Quiet.");
    const scene = told(rig, "scene");
    expect(scene).toContain(secretMarkText(heard, [], [POV_NAME], SECRET_MARK_WORDING));
    expect(scene).toContain(markedText({ text: books, known: "gm" }));
    expect(scene).not.toContain(heard);
    expect(await playerSurfaces(rig, chatId)).not.toContain(TRUTH);
    // Left out: neither reaches the prompt, nor the GM's preview of it.
    await settings(rig, { narrator: { secrets: "omit" } });
    await rig.turn(chatId, "I look around again.", "Still quiet.");
    expect(prompt(rig)).not.toContain(TRUTH);
    expect(JSON.stringify((await preview(rig, chatId)).sections)).not.toContain(TRUTH);
    // The player character's view leaves both out as well.
    await settings(rig, { narrator: POV });
    await rig.turn(chatId, "And again.", "Nothing new.");
    expect(prompt(rig)).not.toContain(TRUTH);
    expect(await playerSurfaces(rig, chatId)).not.toContain(TRUTH);
  });

  test("the wording of a secret's mark is the user's to rewrite as a text of the prompt registry, and its reset brings back the shipped one", async () => {
    const rig = new Rig({ shipped: true });
    await roomy(rig);
    const heard = `Overheard at the counter: ${TRUTH}`;
    (rig.rt.registry.renderers as SectionRenderer[]).push({ slot: "scene", source: "probe_heard", label: "What was overheard", render: () => [heard] });
    const chatId = await alder(rig);
    const kept = "{{text}} (hidden from {{kept}})";
    await marks(rig, { kept });
    await rig.turn(chatId, "I look around.", "Quiet.");
    expect(told(rig, "scene")).toContain(secretMarkText(heard, [], [POV_NAME], { ...SECRET_MARK_WORDING, kept }));
    expect(told(rig, "scene")).not.toContain(secretMarkText(heard, [], [POV_NAME], SECRET_MARK_WORDING));
    await marks(rig, { kept: null });
    await rig.turn(chatId, "I look around again.", "Still quiet.");
    expect(told(rig, "scene")).toContain(secretMarkText(heard, [], [POV_NAME], SECRET_MARK_WORDING));
  });

  test("the narrator rules explain every form a mark can take, in the user's wording as it stands, in the user's own rule while they keep one, and in the shipped rule again after its reset", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await alder(rig);
    const rules = (): string => rig.host.assembled.find((e) => e.content.startsWith("[Narrator rules]\n"))?.content ?? "";
    // Every case the sections and the interceptor write: a fact beyond the player character's; a
    // secret with holders or none, kept from some or from everyone; and Who knows what's secret lines
    // (`secretLineText`), a holder's own secret kept from everyone, or from some.
    const forms = (wording: SecretMarkWording): string[] => [
      markedText({ text: "", known: "scene", who: "…" }).trim(),
      markedText({ text: "", known: "gm" }).trim(),
      ...[[], ["…"]].flatMap((known) => [["…"], "everyone" as const].map((kept) => secretMarkText("…", known, kept, wording))),
      ...(["everyone", ["…"]] satisfies (string[] | "everyone")[]).map((keptFrom) => secretLineText({ text: "…", known: "scene", secret: { keptFrom, known: ["…"] } }, "marked", wording, (id) => id) ?? "no secret line"),
    ];
    await rig.turn(chatId, "I look around.", "Quiet.");
    for (const form of forms(SECRET_MARK_WORDING)) expect(rules()).toContain(form);
    // The user's own wording is what the rules then explain, in the user's own rule, and the shipped ones are gone from them.
    const own: SecretMarkWording = {
      known: "{{text}} (only {{known}} know this)",
      kept: "{{text}} (hidden from {{kept}})",
      both: "{{text}} (only {{known}} know this; hidden from {{kept}})",
      everyone: "all but them",
      rule: "Read a line written {{forms}} as a secret: {{everyone}} means all who don't know it, and no one it is hidden from knows it.",
    };
    await marks(rig, own);
    await rig.turn(chatId, "I look around again.", "Still quiet.");
    for (const form of forms(own)) expect(rules()).toContain(form);
    expect(rules()).toContain(ruleOf(own));
    expect(rules()).not.toContain(ruleOf({ ...own, rule: SECRET_MARK_WORDING.rule }));
    expect(rules()).not.toContain("[secret; known to");
    // Reset brings back the shipped rule, still explaining the user's own forms.
    await marks(rig, { rule: null });
    await rig.turn(chatId, "And once more.", "Quiet again.");
    expect(rules()).toContain(ruleOf({ ...own, rule: SECRET_MARK_WORDING.rule }));
    expect(rules()).not.toContain(ruleOf(own));
  });

  test("a mind whose thoughts carry an unrevealed truth reaches the Minds section marked as a secret its holder keeps from the player character, or not at all, even where the world gives the narrator each mind whole", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const MIND = /You are the private mind of (.+?) in the roleplay world/;
    rig.host.quietReply = (req: QuietRequest): string => {
      const mind = MIND.exec(req.messages[0]?.content ?? "")?.[1];
      if (mind) return JSON.stringify({ monologue: TRUTH, depiction: `${mind} wipes down the counter`, intent: "keep the shop going", reactions: [], plans: [], mood: "tense" });
      return JSON.stringify({ notes: [], commitments: [], resolved: [], plans: [], told: [], proposals: [] });
    };
    await roomy(rig);
    // Danny is the one Live mind, with the player character; the world sets full secrecy itself.
    const chatId = await alder(rig, { minds: { secrecy: "full", thresholds: { live: 900, near: 900, far: 900 }, always: { ids: [DANNY] } } });
    await settings(rig, { minds: { refreshLimit: 0 } });
    await edit(rig, chatId, { op: "move", entity: DANNY, to: HERE });
    await rig.turn(chatId, "Morning, Danny.", "Danny nods.");
    const { state, world } = await stateOf(rig, chatId);
    const mind = mindLines(rig.rt.registry.context(world, state)).find((l) => l.entity === DANNY);
    if (!mind) throw new Error("Danny has no mind this turn");
    expect(mind.line).toContain(TRUTH);
    expect(told(rig, "minds")).toContain(secretMarkText(mind.line, [mind.name], [POV_NAME], SECRET_MARK_WORDING));
    expect(told(rig, "minds")).not.toContain(mind.line);
    expect(await playerSurfaces(rig, chatId)).not.toContain(TRUTH);
    // Left out.
    await settings(rig, { narrator: { secrets: "omit" } });
    await rig.turn(chatId, "Busy morning?", "Danny shrugs.");
    expect(prompt(rig)).not.toContain(TRUTH);
    expect(JSON.stringify((await preview(rig, chatId)).sections)).not.toContain(TRUTH);
  });
});

describe("the Stance section", () => {
  test("claims nothing of what the narrator knows, under either view", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await alder(rig);
    await edit(rig, chatId, { op: "move", entity: DANNY, to: HERE });
    const label = DEFAULT_SECTIONS.stance?.label ?? "Stance";
    const note = (DEFAULT_SECTIONS.stance?.template ?? "").split("{{lines}}")[0] ?? "";
    for (const view of [SCENE, POV]) {
      await settings(rig, { narrator: view });
      await rig.turn(chatId, "Morning, Danny.", "Danny nods.");
      const stance = rig.host.section(label);
      expect(stance).toContain("Danny Okafor");
      expect(stance.startsWith(`[${label}]\n${note}`)).toBe(true);
      expect(stance).not.toMatch(/knows only what the player character knows/i);
    }
  });
});

describe("a chat's choices over time", () => {
  test("a Lumiverse Branch keeps them: the branch's controls, its own reads and its preview follow them", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await alder(rig, { entities: secretHere });
    expect(await chatKnowledge(rig, chatId, { knowledge: false, narrator: POV })).toEqual({ knowledge: false, narrator: POV });
    await rig.turn(chatId, "I look around.", "Quiet.");
    const head = rig.host.head(chatId);
    if (!head) throw new Error("no reply");
    const branch = rig.host.branch(chatId, head.id);
    const knowledge = (await rig.rt.view(branch, rig.host.userId)).controls?.knowledge;
    expect(knowledge?.narrator).toEqual({ chat: POV, world: null, user: SCENE });
    expect(knowledge?.tracking.chat).toBe(false);
    expect(await chatKnowledge(rig, branch, {})).toEqual({ knowledge: false, narrator: POV });
    const people = (await preview(rig, branch)).sections.find((s) => s.slot === "people");
    expect(people?.scope).toBe("player");
    expect(people?.content ?? "").not.toContain(SECRET);
    // The original going back to following leaves the branch's own as they were.
    expect(await chatKnowledge(rig, chatId, { knowledge: null, narrator: null })).toEqual({ knowledge: null, narrator: null });
    expect(await chatKnowledge(rig, branch, {})).toEqual({ knowledge: false, narrator: POV });
    expect((await preview(rig, chatId)).sections.find((s) => s.slot === "people")?.scope).toBe("gm");
  });

  test("a turn prepared before the chat's choice changed never goes out on it: the engine runs again, and the reply reads the new one", async () => {
    const rig = new Rig({ shipped: true });
    await roomy(rig);
    const chatId = await alder(rig, { entities: secretHere });
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    // The engine runs first and prepares the turn as everyone in the scene knows it.
    expect((await rig.host.begin(chatId, { type: "normal" })).halted).toBe("cancelled");
    expect(await chatKnowledge(rig, chatId, { narrator: POV })).toEqual({ knowledge: null, narrator: POV });
    rig.host.restarts.length = 0;
    // The reply finds its turn made on the old choice: the engine runs again before it starts.
    expect((await rig.host.begin(chatId, { type: "regenerate" })).halted).toBe("cancelled");
    expect(rig.host.restarts).toMatchObject([{ chatId, as: "regenerate" }]);
    const reply = await rig.host.begin(chatId, { type: "regenerate" });
    expect(reply.halted).toBeUndefined();
    expect(prompt(rig)).not.toContain(SECRET);
    await rig.host.finish(reply, "Quiet.");
  });
});
