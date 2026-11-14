// The floor test's fixture: an invented card, a persona and a preset of its own, all consistent with
// one another, so that "a simple turn" asks nothing the chat cannot answer. The preset and the
// persona are not made active: `floor.ts run` names them on every generation it starts, on both
// connections alike (`preset_id` with `force_preset_id`, and `persona_id`, as Lumiverse's
// `POST /api/v1/generate` takes them), so no setting of the user's changes and no other chat plays
// under them. Each is found again by a mark in its metadata, and `remove` deletes what `setup` made.

import { guard, type TestbedEnv } from "./lib/env";
import type { Lumiverse } from "./lib/lumiverse";

/** In the metadata of the preset and the persona `setup` makes: how `run` and `remove` know them. */
const MARK = "lumirpengine_floor_test";
/** The floor chats' name: `remove` deletes only the floor card's chats of this name. */
export const CHAT_NAME = "Floor test";

export const CARD = {
  name: "Marta Venn",
  description:
    "Marta Venn keeps the light on Skerry Rock, a day's sail from the nearest harbor. She is in her fifties, spare and weathered, slow to speak and exact when she does. She has kept the lamp for nineteen years and knows the water around the rock by sound.",
  personality: "Dry, patient, observant. She answers what is asked and notices what is not.",
  scenario: "A traveller's boat has put in at Skerry Rock ahead of a storm. Marta has let them into the keeper's kitchen at the foot of the tower.",
  first_mes:
    "The kitchen is small and warm, and smells of lamp oil and peat. Marta shuts the door against the wind and nods at the bench by the stove.\n\n\"You'll not be leaving tonight,\" she says. \"Sit. There's tea.\"",
};

/** The player: the traveller the card's scenario names, and nobody else. */
const PERSONA = {
  name: "Traveller",
  title: "Floor test (invented)",
  folder: "Floor test (invented)",
  description: "A traveller whose small boat put in at Skerry Rock ahead of the storm: tired, polite, and curious about the keeper and her light.",
  is_default: false,
  metadata: { [MARK]: true },
};

/** Plain instructions that name nobody: `{{char}}` and `{{user}}` are the card and the persona. */
const INSTRUCTIONS = [
  "Write {{char}}'s next reply in a roleplay with {{user}}.",
  "Write in the third person and the past tense, as the chat's first message is written: what {{char}} says and does, and what {{user}} can see and hear. Never write {{user}}'s words, actions or thoughts.",
  "Keep to the character and the scenario below. Answer what {{user}} has just said or done; the reply ends when {{char}} has answered.",
  "Write about 120 to 200 words.",
].join("\n\n");

const block = (name: string, content: string, marker: string | null = null) => ({ name, content, role: "system", enabled: true, position: "pre_history", depth: 0, marker });

const PRESET = {
  name: "Floor test (invented)",
  provider: "loom",
  engine: "classic",
  // No sampler overrides: both connections play with their own settings, as they would under any preset.
  parameters: {},
  prompt_order: [
    block("Instructions", INSTRUCTIONS),
    block("Character", "<character>\n{{description}}\n\n{{personality}}\n</character>"),
    block("Scenario", "<scenario>\n{{scenario}}\n</scenario>"),
    block("Player", "<player>\n{{user}}: {{persona}}\n</player>"),
    block("Chat History", "", "chat_history"),
  ],
  prompts: {},
  metadata: { [MARK]: true, description: "Made by the floor test's setup (scripts/testbed/floor.ts). Not active; floor.ts names it on each generation it starts." },
};

/** What `run` names on every generation. */
export interface Fixture {
  preset: { id: string; name: string };
  persona: { id: string; name: string };
}

type Marked = { id: string; name: string; metadata?: { [key: string]: unknown } | null };

/** Every row of a paged list route (`{ data, total }`, or a bare array). */
async function every(host: Lumiverse, path: string): Promise<Marked[]> {
  const out: Marked[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await host.call<{ data: Marked[]; total: number } | Marked[]>("GET", `${path}?limit=100&offset=${offset}`);
    if (Array.isArray(page)) return page;
    out.push(...page.data);
    if (page.data.length < 100 || out.length >= page.total) return out;
  }
}

const marked = async (host: Lumiverse, path: string): Promise<Marked[]> => (await every(host, path)).filter((row) => row.metadata?.[MARK] === true);

/** The fixture `setup` made; throws when it is missing or doubled. */
export async function findFixture(host: Lumiverse): Promise<Fixture> {
  const [presets, personas] = await Promise.all([marked(host, "/api/v1/presets"), marked(host, "/api/v1/personas")]);
  if (presets.length !== 1 || personas.length !== 1) throw new Error(`the floor fixture has ${presets.length} preset(s) and ${personas.length} persona(s), not one of each: run floor.ts setup (or remove, then setup)`);
  const [preset, persona] = [presets[0] as Marked, personas[0] as Marked];
  return { preset: { id: preset.id, name: preset.name }, persona: { id: persona.id, name: persona.name } };
}

/** Makes what is missing of the fixture and a new floor chat; prints what it set. */
export async function setupFixture(host: Lumiverse): Promise<void> {
  const presets = await marked(host, "/api/v1/presets");
  const personas = await marked(host, "/api/v1/personas");
  if (presets.length > 1 || personas.length > 1) throw new Error(`${presets.length} floor presets and ${personas.length} floor personas: run floor.ts remove first`);
  const preset = presets[0] ?? (await host.call<Marked>("POST", "/api/v1/presets", PRESET));
  const persona = personas[0] ?? (await host.call<Marked>("POST", "/api/v1/personas", PERSONA));
  const existing = (await host.characters()).find((c) => c.name === CARD.name);
  const character = existing ?? (await host.createCharacter(CARD));
  const chat = await host.createChat(character.id, CHAT_NAME);
  const was = (made: unknown) => (made ? " (already there)" : " (made)");
  console.log(`card     ${character.id} "${CARD.name}"${was(existing)}
persona  ${persona.id} "${persona.name}"${was(personas[0])}: the traveller of the card's scenario; not made default or active
preset   ${preset.id} "${preset.name}"${was(presets[0])}: ${PRESET.prompt_order.map((b) => b.name).join(", ")}; third person, past tense, 120 to 200 words, names nobody; not made active
chat     ${chat.id} "${CHAT_NAME}"

floor.ts run starts every generation, plain and RPE alike, with this preset (forced past any preset binding) and this persona,
and sends the player's lines under the persona's name. No setting changes; other chats keep their own preset and persona.
Remove it all with: floor.ts remove

export FLOOR_CHAT=${chat.id}`);
}

/** Deletes the floor chats, the card when no other chat uses it, the preset and the persona; prints each. */
export async function removeFixture(host: Lumiverse, env: TestbedEnv): Promise<void> {
  for (const card of (await host.characters()).filter((c) => c.name === CARD.name)) {
    const chats = await every(host, `/api/v1/chats?characterId=${encodeURIComponent(card.id)}`);
    const floor = chats.filter((c) => c.name === CHAT_NAME);
    for (const chat of floor) {
      await host.deleteChat(guard(env, chat.id));
      console.log(`deleted chat ${chat.id} "${chat.name}"`);
    }
    if (chats.length > floor.length) console.log(`kept card ${card.id} "${card.name}": ${chats.length - floor.length} other chat(s) use it`);
    else {
      await host.call("DELETE", `/api/v1/characters/${card.id}`);
      console.log(`deleted card ${card.id} "${card.name}"`);
    }
  }
  for (const [kind, path] of [
    ["preset", "/api/v1/presets"],
    ["persona", "/api/v1/personas"],
  ] as const) {
    for (const row of await marked(host, path)) {
      await host.call("DELETE", `${path}/${row.id}`);
      console.log(`deleted ${kind} ${row.id} "${row.name}"`);
    }
  }
}
