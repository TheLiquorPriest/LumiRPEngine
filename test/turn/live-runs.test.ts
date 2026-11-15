// A turn's runs on the chat's live hub. Each run of a turn (its first, a continue) has RPH's own id for it, never the turn's: its
// records carry it with the turn in their scope, its streaming text names it alone and still reaches the chat, and what went to the
// chat is published under it, so a page hangs each piece on the run it belongs to. RPE keeps RPH's id beside its own for each run.
// Played through the stand-in Lumiverse on the scripted model. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import type { LiveEvent } from "../../src/shared/api";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

test("a continue's own streaming text and reply reach the chat's live view under the run they belong to", async () => {
  const b = await openTurnBed({ answers: [replying("The lamp turns."), replying("And the sea calms.")] });
  beds.push(b);
  const heard: LiveEvent[] = [];
  b.app.live.follow(CHAT, {
    take: (batch) => {
      // The hub carries only the kinds it declares, each with its declared data: the shared types say which.
      const declared = batch.events as unknown as readonly LiveEvent[];
      heard.push(...declared);
      return true;
    },
  });

  b.host.send(CHAT, "I climb the stairs.");
  const first = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type: "normal" });
  const turn = await settledTurn(b, first.generationId!);
  const continuing = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type: "continue" });
  expect(continuing.error).toBeNull();
  await settledTurn(b, continuing.generationId!);

  const records = heard.flatMap((e) => (e.kind === "trace" ? [e.data] : []));
  const started = records.filter((r) => r.event.kind === "run_started" && r.scope.turn === turn.id).map((r) => r.run);
  expect(started.length).toBe(2);
  expect(new Set(started).size).toBe(2);
  expect(started).not.toContain(turn.id);
  const [firstRun, continueRun] = started as [string, string];
  expect(b.turns.runs.ofTurn(USER, turn.id).map((r) => r.traceRun)).toEqual([firstRun, continueRun]);

  // The continue's streaming text reaches the chat, named by its run alone.
  const deltas = heard.flatMap((e) => (e.kind === "delta" ? [e.data] : []));
  expect(deltas.filter((d) => d.run === continueRun).map((d) => d.text ?? "").join("")).toContain("And the sea calms.");
  expect(deltas.every((d) => started.includes(d.run))).toBe(true);

  // What each run sent to the chat is published under that run.
  const pieces = heard.flatMap((e) => (e.kind === "reply" ? [e.data] : []));
  const sentBy = new Map<string, string>();
  for (const p of pieces) if ("text" in p) sentBy.set(p.run, (sentBy.get(p.run) ?? "") + p.text);
  expect([...sentBy]).toEqual([
    [firstRun, "The lamp turns."],
    [continueRun, "And the sea calms."],
  ]);
});
