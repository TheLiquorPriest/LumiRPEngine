// Each chat's own choices (STANDALONE-PLAN §15.2, "Your settings"; §9.6): the knowledge switch and the
// narrator's view of secrets its metadata holds (`lumi_rp_engine.prefs`), the tidy-up's switch and
// leave-alone list and the map's display (`runs/<chat>/prefs.json`, and the metadata's `tidy`), and what counts as its story
// (`harness/chats.json`'s `story`), each into the setting of the same meaning in the chat's own `RPE.yml`, where
// a chat's setting stands over the user's. A chat with no choice of its own leaves the key unset, so it
// follows its world and the user as it did. A value is written only where the app's registry declares the
// setting and takes the value; the rest is named, with why, and a later run carries it once a build
// declares it. As for the user's settings, a later run puts what an earlier run put while RPE's value is
// still that, takes it out where today's side no longer has it, and names either.

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { oneFileAtATime, readText, writeWhole } from "../app/disk";
import { type Setting, takenValue } from "../app/setting-list";
import { LayoutRefused, withKeyAt, yamlMapping } from "../app/yaml";
import { hashJson } from "../shared/hash";
import { isRecord, type JsonValue } from "../shared/json";
import type { PutPrints } from "./connections";
import type { TreePlaces } from "./own-files";
import type { Followed } from "./tables";
import type { Today } from "./today";
import { chatKnowledgePrefsOf } from "./today/chat-knowledge-prefs";

/** What a run did with each carried chat's own choices. */
export interface ChatSettingsCarried {
  /** Each choice written into its chat's `RPE.yml`: the chat, where it was, and the setting it now is. */
  carried: { chat: string; from: string; to: string }[];
  /** Choices a chat's `RPE.yml` holds otherwise since a run put them there, left as RPE has them. */
  keptInRpe: { chat: string; from: string; to: string }[];
  /** Choices not carried, with why: no setting of that name is declared yet, or it takes no such value. Each stays in the backup. */
  notCarried: { chat: string; from: string; to: string; why: string }[];
  /** What a run put before that today's side no longer has: taken out where RPE's value is still the run's, else left, and named. */
  followed: Followed[];
  /** Chats whose leave-alone list had older keys than the cap holds: how many were left out of each. */
  tidyCut: { chat: string; left: number }[];
}

/** The identity a run keeps of a choice it put: the chat's config and the key. */
const keyOf = (config: string, key: string): string => `chat setting ${config}\u0000${key}`;

/** One choice of a chat's, as today's side holds it, and the setting it becomes. */
interface Wanted {
  from: string;
  key: string;
  value: JsonValue;
}

/** The narrator's, knowledge and tidy choices the chat's metadata holds, as the settings they are. */
function metadataChoices(meta: Record<string, JsonValue>): Wanted[] {
  const prefs = chatKnowledgePrefsOf(meta);
  const out: Wanted[] = [];
  if (prefs.knowledge !== undefined) out.push({ from: "its own knowledge switch", key: "secrets.tracked", value: prefs.knowledge });
  if (prefs.narrator !== undefined) {
    out.push({ from: "its own narrator view (what the narrator knows)", key: "secrets.narrator.knowledge", value: prefs.narrator.knowledge });
    out.push({ from: "its own narrator view (how a secret reaches the narrator)", key: "secrets.narrator.secrets", value: prefs.narrator.secrets });
  }
  if (prefs.tidy !== undefined) out.push({ from: "its own tidy-up switch", key: "things.tidy", value: prefs.tidy });
  return out;
}

/** What counts as the chat's story, where LumiAH's `chats.json` holds a choice of its own for it. */
function storyChoices(doc: unknown, chat: string): Wanted[] {
  const story = isRecord(doc) && isRecord(doc.story) ? doc.story[chat] : undefined;
  if (!isRecord(story)) return [];
  const out: Wanted[] = [];
  if (story.hidden === "include" || story.hidden === "leave_out") out.push({ from: "its own choice of hidden messages", key: "chat.hiddenReadable", value: story.hidden === "include" });
  if (typeof story.from === "string") out.push({ from: "its own choice of whose messages are the story", key: "story.from", value: story.from });
  if (typeof story.newest === "string") out.push({ from: "its own choice of the newest message", key: "story.newest", value: story.newest });
  return out;
}

function json(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Carries the own choices of `chats` (the chats this run imported) into their `RPE.yml`. `globalConfig` is where the user's own cap of the
 * leave-alone list (`things.tidyLeftMost`) is read; `registry` the app's settings; `earlier` what earlier runs put.
 */
export async function carryChatSettings(input: { today: Today; chats: readonly string[]; places: TreePlaces; globalConfig: string; earlier: PutPrints; registry?: readonly Setting[] }): Promise<{ carried: ChatSettingsCarried; put: Map<string, string>; drop: Set<string> }> {
  const { today, places, earlier, registry } = input;
  const out: ChatSettingsCarried = { carried: [], keptInRpe: [], notCarried: [], followed: [], tidyCut: [] };
  const put = new Map<string, string>();
  const drop = new Set<string>();
  const lumiah = json(await today.userView.read("harness/chats.json"));
  const globalText = (await readText(input.globalConfig)) ?? "";
  const mostDeclared = registry?.find((d) => d.key === "things.tidyLeftMost");
  const globalMost = ((): unknown => {
    const things = yamlMapping(globalText, input.globalConfig).things;
    return isRecord(things) ? things.tidyLeftMost : undefined;
  })();
  const cap = typeof globalMost === "number" ? globalMost : typeof mostDeclared?.default === "number" ? mostDeclared.default : null;

  for (const chat of [...input.chats].sort()) {
    const row = today.chats.find((c) => c.id === chat);
    if (row === undefined) continue;
    const character = row.character === null ? null : today.db.character(row.character);
    const config = join(places.root, await places.chat(chat, { character, chat: { name: row.name ?? "" } }), "RPE.yml");
    const wanted: Wanted[] = [...metadataChoices(row.metadata), ...storyChoices(lumiah, chat)];
    const prefs = json(await today.userView.read(`runs/${chat}/prefs.json`));
    if (isRecord(prefs)) {
      const left = Array.isArray(prefs.tidyLeft) ? prefs.tidyLeft.filter((k): k is string => typeof k === "string") : [];
      if (left.length > 0) {
        const kept = cap !== null && left.length > cap ? left.slice(left.length - cap) : left;
        if (kept.length < left.length) out.tidyCut.push({ chat, left: left.length - kept.length });
        wanted.push({ from: "what it told the tidy-up to leave alone", key: "things.tidyLeft", value: kept });
      }
      if (typeof prefs.mapDisplay === "string") wanted.push({ from: "its map display", key: "map.display", value: prefs.mapDisplay });
    }

    await oneFileAtATime(config, async () => {
      const before = (await readText(config)) ?? "";
      const held = yamlMapping(before, config);
      let text = before;
      for (const w of wanted) {
        const def = registry?.find((d) => d.key === w.key);
        if (registry !== undefined && def === undefined) {
          out.notCarried.push({ chat, from: w.from, to: w.key, why: `RPE declares no setting ${w.key} yet; it stays in the backup and a later run carries it` });
          continue;
        }
        let value: JsonValue = w.value;
        if (def !== undefined) {
          const taken = takenValue(def, w.value, w.key, true);
          if (!taken.ok) {
            out.notCarried.push({ chat, from: w.from, to: w.key, why: taken.why });
            continue;
          }
          value = taken.value as JsonValue;
        }
        const path = w.key.split(".");
        let ours: unknown = held;
        for (const part of path) ours = isRecord(ours) ? ours[part] : undefined;
        const what = keyOf(config, w.key);
        const was = earlier.get(what);
        const print = hashJson(value);
        const have = ours === undefined ? "" : hashJson(ours);
        const to = `${w.key} in its RPE.yml`;
        if (have === print || (was === undefined ? ours === undefined : have === was)) {
          if (have !== print) {
            try {
              text = withKeyAt(text, path, value, config);
            } catch (error) {
              if (!(error instanceof LayoutRefused)) throw error;
              out.notCarried.push({ chat, from: w.from, to: w.key, why: error.message });
              continue;
            }
          }
          put.set(what, print);
          out.carried.push({ chat, from: w.from, to });
        } else out.keptInRpe.push({ chat, from: w.from, to });
      }
      // What an earlier run put in this chat's file that today's side no longer has.
      const given = new Set(wanted.map((w) => keyOf(config, w.key)));
      for (const [what, was] of earlier) {
        if (!what.startsWith(`chat setting ${config}\u0000`) || given.has(what) || put.has(what)) continue;
        const key = what.slice(`chat setting ${config}\u0000`.length);
        const path = key.split(".");
        let ours: unknown = held;
        for (const part of path) ours = isRecord(ours) ? ours[part] : undefined;
        drop.add(what);
        if (ours === undefined) continue;
        const change = "its own choice was taken away on today's side since an earlier run";
        if (hashJson(ours) !== was) {
          out.followed.push({ what: `${key} in ${chat}'s RPE.yml`, change, followed: false });
          continue;
        }
        try {
          text = withKeyAt(text, path, undefined, config);
          out.followed.push({ what: `${key} in ${chat}'s RPE.yml`, change, followed: true });
        } catch (error) {
          if (!(error instanceof LayoutRefused)) throw error;
          out.followed.push({ what: `${key} in ${chat}'s RPE.yml`, change: `${change}; ${error.message}`, followed: false });
        }
      }
      if (text !== before) {
        await mkdir(dirname(config), { recursive: true });
        await writeWhole(config, text);
      }
    });
  }
  return { carried: out, put, drop };
}
