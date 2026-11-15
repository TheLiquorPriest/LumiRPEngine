// What the live gates of row 0.2 play with (PlanGates-24): the floor's chat, preset, persona and lines, the
// same acts as the floor's (`FloorActs`: a line typed in the chat page, the connection chosen, the reply's
// end waited for), one line at a time, each turn read from RPE once its run has ended (the floor's own
// reader, `liveReader`), and the few things the floor never needs: the reply contract in force in the chat,
// a setting read and a setting written through RPE's settings route. A setting is never guidance: the
// proof runner's standing hashes a layer's guidance files only, so writing one in the chat's own
// `RPE.yml` leaves the play under the shipped guidance as shipped.
//
// The gates count what RPE's trace says of each turn (`./phase0.ts`); nothing here counts. A turn whose
// RPE side could not be read is `unread`, never a miss (`formCount`).

import type { Play } from "../route/form";
import type { JsonValue } from "../../../src/shared/json";
import { floorTrials, type BuildReader } from "./record";
import { liveReader, type FloorActs, type FloorFixture, type FloorReader, type Ground, type TurnRead } from "../floor/play";
import { LIMITS } from "../../testbed/floor-measure";
import { RpeReader } from "./read";
import { leadOf } from "./turn";

/** The floor's reader and what a gate of row 0.2 reads and writes beside it. */
export interface LoopReader extends FloorReader {
  /** The reply contract in force in the chat (`.prompts/reply-contract.md`), as the chat's view serves it. */
  contract(chat: string): Promise<string>;
  /** A setting's value in force for the chat and the level it comes from; null where RPE lists no such key. */
  setting(chat: string, key: string): Promise<{ value: unknown; from: string | null } | null>;
  /** Writes a setting at the chat's own level. */
  put(chat: string, key: string, value: JsonValue): Promise<void>;
}

/** The reply contract's file, below a level of the tree. */
export const CONTRACT_FILE = ".prompts/reply-contract.md";

/** The floor's reader with RPE's settings and the chat's reply contract. */
export function liveLoopReader(acts: FloorActs): LoopReader {
  const floor = liveReader(acts);
  const rpe = new RpeReader(acts.rpe.base, acts.rpe.token);
  return {
    ...floor,
    async contract(chat) {
      const file = (await rpe.view(chat)).find((f) => f.applies && f.path.endsWith(CONTRACT_FILE));
      if (file === undefined) throw new Error(`the chat's view holds no ${CONTRACT_FILE} in force`);
      return rpe.viewFile(chat, file.path);
    },
    async setting(chat, key) {
      const found = (await rpe.settings(chat)).settings.find((s) => s.key === key);
      return found === undefined ? null : { value: found.value, from: found.from };
    },
    async put(chat, key, value) {
      await rpe.put({ level: "chat", chat, key, value });
    },
  };
}

/** The chat a gate plays in, opened the way the floor opens its own, and what it stood on before the first line. */
export interface Opened {
  fixture: FloorFixture;
  chat: string;
  ground: Ground;
  /** The floor's own reasons for a trial found before the first line (a shipped tree not the build's, guidance in a layer, a lead that is not the Author). */
  trials: string[];
}

/** Opens the floor's chat as the floor does: the fixture found, a chat made, the plain connection's ground read, the floor's own reasons for a trial found. */
export async function open(play: Play, acts: FloorActs, reader: FloorReader, build: BuildReader | null): Promise<Opened> {
  const fixture = await reader.fixture();
  const chat = await acts.chat(fixture.card.id);
  const ground = await reader.ground(chat, acts.connections.plain, fixture.preset.id);
  await play.keep("observed", { ...ground.observed });
  return { fixture, chat, ground, trials: floorTrials(play.run, ground.observed, build) };
}

/** One line sent and read back: what RPE's trace says of it, or why it could not be read; and why the gate must stop after it, where it must. */
export interface Sent {
  line: string;
  read: TurnRead;
  /** Null where the turn's RPE side was read. */
  unread: string | null;
  stopped: string | null;
}

/**
 * Sends one line through the chat page on RPE's connection and reads RPE's side once its run has ended. A
 * run still going at the floor's limit stops the gate: no line is sent over a running run.
 */
export async function send(acts: FloorActs, reader: FloorReader, opened: Opened, line: string, preset: string): Promise<Sent> {
  const read = await reader.turn(opened.chat, "rpe", () => acts.send(opened.chat, acts.connections.rpe, line, { preset, persona: opened.fixture.persona.id }), opened.ground.history, opened.ground.plain.model);
  const unread = read.rpe === null ? (read.error ?? "no RPE turn was matched to the reply") : null;
  const stopped = read.rpe?.status === "running" ? `RPE's run was still going ${LIMITS.runEnd / 60_000} min after the reply (LIMITS.runEnd), so no later line was sent over it` : null;
  return { line, read, unread, stopped };
}

/** The Author's connection as `run.json` names it, by which a per-connection setting is written; null where it names none. */
export function authorConnection(run: Play["run"]): string | null {
  return run.agents.find((a) => a.agent === "author")?.connection ?? null;
}

/**
 * Writes a setting into the chat and reads it back as RPE holds it. Null where it holds; else why not, in
 * words: a gate that cannot say its connection stood in the form it counts does not count.
 */
export async function setSetting(reader: LoopReader, chat: string, key: string, value: string): Promise<string | null> {
  try {
    await reader.put(chat, key, value);
    const held = await reader.setting(chat, key);
    if (held === null) return `RPE lists no setting ${key}, so it could not be set`;
    return held.value === value ? null : `${key} reads ${JSON.stringify(held.value)} after it was set to ${JSON.stringify(value)}${held.from === null ? "" : ` (the ${held.from} level decides it)`}`;
  } catch (error) {
    return `${key} could not be set to ${JSON.stringify(value)}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Turns the trace shows led by another definition than the Author: one reason for a trial, naming each, as the floor makes it. */
export function ledAway(expected: string | null, sent: readonly Sent[]): string[] {
  if (expected === null) return [];
  const others = sent.flatMap((s, i) => {
    if (s.read.rpe === null) return [];
    const led = leadOf(s.read.rpe.trace);
    return led !== null && led.definition === expected ? [] : [`turn ${i + 1} by ${led === null ? "no one the trace names" : led.definition}`];
  });
  return others.length === 0 ? [] : [`a turn was led by another definition than the Author (${expected}): ${others.join(", ")}`];
}


/** Whether a reader is the floor's reader with what the gates of row 0.2 add to it. */
export function isLoopReader(reader: FloorReader): reader is LoopReader {
  return "contract" in reader && "setting" in reader && "put" in reader;
}
