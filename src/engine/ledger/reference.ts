// The reference fold (DESIGN §14, the ledger gate): a small, obviously correct implementation of
// DESIGN §4.3. No cache, no overlay shortcut, no re-convergence: every call re-folds every
// message from the world revision. It shares only the event validators and reducers
// (engine/events.ts and pack event types) with the optimized fold, and re-implements the path
// rules itself so a mistake in one is caught by the other (L1).

import { hashJson, hashParts } from "../../shared/hash";
import type { EventRef, JournalNote, KeepLine, LedgerEvent, Marker, PathHash, PostEntry, Rec } from "../../shared/ledger";
import { ROOT_PATH } from "../../shared/ledger";
import { applyEvent, applyMarker, validateEvent, type EventTypes } from "../events";
import type { ReadContext } from "../registry";
import type { RelationTypes } from "../relations";
import type { WorldState } from "../state";
import { initialState } from "../world-state";
import type { WorldDoc } from "../../shared/world";
import { FoldError, type FoldInput, type FoldOutput, type MessageResult } from "./chain";

/** What the fold needs from the registry: event types, relation types for the start state, read contexts. */
export interface FoldTypes extends EventTypes, RelationTypes {
  context(world: WorldDoc, state: Readonly<WorldState>): ReadContext;
}

const textHash = (text: string): string => hashParts("lre.content", text);

function sameRef(a: EventRef, b: EventRef): boolean {
  return a.in === b.in && a.index === b.index && (a.in === "events" || (b.in === "post" && a.seq === b.seq));
}

export function referenceFold(input: FoldInput, types: FoldTypes): FoldOutput {
  const startWorld = input.worlds(input.revision);
  if (!startWorld) throw new FoldError(`unknown revision ${input.revision}`);
  let state = initialState(startWorld, input.revision, types);
  const notes: JournalNote[] = [];
  const keepReport: KeepLine[] = [];
  const messages: MessageResult[] = [];
  const violations: string[] = [];
  const pausedAfter = new Set(input.pauses.map((p) => p.messageId));
  let paused = false;
  let parent: PathHash = ROOT_PATH;

  const ctx = (): ReadContext => {
    const world = input.worlds(state.revision);
    if (!world) throw new FoldError(`unknown revision ${state.revision}`);
    return types.context(world, state);
  };

  const marker = (m: Marker): void => {
    if (m.kind === "migrate") {
      const next = input.worlds(m.to);
      if (!next) throw new FoldError(`unknown revision ${m.to}`);
    }
    applyMarker(state, m);
  };

  for (const m of input.chain) {
    const text = m.swipes[m.swipeId] ?? "";
    if (m.isUser) {
      const path = hashParts("lre.path", parent, "u", textHash(text), "", "");
      messages.push({ id: m.id, fold: "user", parentPath: parent, path });
      parent = path;
      if (pausedAfter.has(m.id)) paused = true;
      continue;
    }

    // The active swipe's record, unless a tombstone matches it.
    let rec: Rec | null = m.ledger?.swipes[String(m.swipeId)] ?? null;
    let tombstoned = false;
    if (rec) {
      const stored = hashJson(rec);
      const candidate = rec;
      tombstoned = input.tombstones.some(
        (t) => t.messageId === m.id && t.swipeHash.len === candidate.swipeHash.len && t.swipeHash.hash === candidate.swipeHash.hash && t.recHash === stored,
      );
      if (tombstoned) {
        notes.push({ kind: "tombstoned", messageId: m.id, ref: null, text: "discarded" });
        rec = null;
      }
    }
    // A bare record (path "") has no turn: its entries never travel with it.
    const recPath = rec && rec.path !== "" ? rec.path : null;
    const live = (at: PathHash | null): boolean => at === null || at === parent || (recPath !== null && at === recPath);

    const markers = [...(m.ledger?.markers ?? [])].sort((a, b) => a.seq - b.seq);
    const liveMarkers = markers.filter((mk) => live(mk.at));
    for (const mk of markers) {
      if (live(mk.at)) continue;
      notes.push({ kind: "inert", messageId: m.id, ref: { marker: mk.seq }, text: "made on another branch" });
      keepReport.push({ messageId: m.id, parentPath: parent, ref: { marker: mk.seq }, status: "inert", text: "made on another branch" });
    }
    const livePost: PostEntry[] = rec ? rec.post.filter((p) => live(p.at)).sort((a, b) => a.seq - b.seq) : [];
    if (rec) {
      for (const p of rec.post) {
        if (live(p.at)) continue;
        notes.push({ kind: "inert", messageId: m.id, ref: { in: "post", seq: p.seq, index: 0 }, text: "made on another branch" });
        keepReport.push({ messageId: m.id, parentPath: parent, ref: { in: "post", seq: p.seq, index: 0 }, status: "inert", text: "made on another branch" });
      }
      // Entries a swipe didn't carry over (a Re-narrate's or Re-run's copies) or a Re-read dropped.
      for (const d of rec.dropped ?? []) notes.push({ kind: "not_carried", messageId: m.id, ref: { in: "post", seq: d.seq, index: 0 }, text: d.reason });
    }

    let fold: MessageResult["fold"];
    if (paused) {
      fold = "paused";
    } else if (!rec) {
      for (const mk of liveMarkers) marker(mk);
      fold = tombstoned ? "tombstoned" : "plain";
    } else {
      const view = recPath !== null && recPath !== parent;
      const converted = rec.keep?.[parent]?.convert ?? [];
      const record = rec;
      const event = (ev: LedgerEvent, ref: EventRef): void => {
        if (record.undone.some((u) => sameRef(u, ref))) return;
        const failure = validateEvent(types, ev, ctx());
        if (failure && !view) {
          violations.push(`${m.id}: on-path ${ev.type} failed re-validation (${failure.reason})`);
          return;
        }
        if (failure) {
          if (converted.some((c) => sameRef(c, ref))) {
            keepReport.push({ messageId: m.id, parentPath: parent, ref, status: "converted", text: failure.reason });
          } else {
            notes.push({ kind: "dropped", messageId: m.id, ref, text: failure.reason });
            keepReport.push({ messageId: m.id, parentPath: parent, ref, status: "dropped", text: failure.reason });
            return;
          }
        }
        applyEvent(types, ev, state, ctx());
      };
      // A group (contiguous events sharing `group`) on a rebased view lands whole or not at all:
      // tried on a copy first; one failure drops every member, unless Keep converted one of them.
      const run = (list: readonly LedgerEvent[], refOf: (index: number) => EventRef): void => {
        let i = 0;
        while (i < list.length) {
          const group = list[i]?.group;
          let j = i + 1;
          while (group !== undefined && j < list.length && list[j]?.group === group) j++;
          const members: { ev: LedgerEvent; ref: EventRef }[] = [];
          for (let k = i; k < j; k++) {
            const ev = list[k];
            const ref = refOf(k);
            if (ev && !record.undone.some((u) => sameRef(u, ref))) members.push({ ev, ref });
          }
          i = j;
          if (members.length <= 1 || !view) {
            for (const x of members) event(x.ev, x.ref);
            continue;
          }
          const trial = structuredClone(state);
          const world = input.worlds(trial.revision);
          if (!world) throw new FoldError(`unknown revision ${trial.revision}`);
          let failure: { reason: string } | null = null;
          for (const x of members) {
            failure = validateEvent(types, x.ev, types.context(world, trial));
            if (failure) break;
            applyEvent(types, x.ev, trial, types.context(world, trial));
          }
          if (!failure) {
            for (const x of members) applyEvent(types, x.ev, state, ctx());
            continue;
          }
          if (members.some((x) => converted.some((c) => sameRef(c, x.ref)))) {
            for (const x of members) {
              const own = validateEvent(types, x.ev, ctx());
              if (own) keepReport.push({ messageId: m.id, parentPath: parent, ref: x.ref, status: "converted", text: own.reason });
              applyEvent(types, x.ev, state, ctx());
            }
            continue;
          }
          for (const x of members) {
            notes.push({ kind: "dropped", messageId: m.id, ref: x.ref, text: failure.reason });
            keepReport.push({ messageId: m.id, parentPath: parent, ref: x.ref, status: "dropped", text: failure.reason });
          }
        }
      };
      for (const mk of liveMarkers) if (mk.seq <= record.markersApplied) marker(mk);
      run(record.events, (index) => ({ in: "events", index }));
      const later: ({ seq: number; marker: Marker } | { seq: number; post: PostEntry })[] = [
        ...liveMarkers.filter((mk) => mk.seq > record.markersApplied).map((mk) => ({ seq: mk.seq, marker: mk })),
        ...livePost.map((p) => ({ seq: p.seq, post: p })),
      ].sort((a, b) => a.seq - b.seq);
      for (const item of later) {
        if ("marker" in item) marker(item.marker);
        else run(item.post.events, (index) => ({ in: "post", seq: item.post.seq, index }));
      }
      fold = recPath === null ? "plain" : view ? "view" : "on_path";
    }

    // Chain this message: its content (the record's swipeHash, else its text), record and live markers.
    const content = rec ? rec.swipeHash.hash : textHash(text);
    let recHash = "";
    if (rec) {
      const keep = rec.keep?.[parent];
      const empty = rec.events.length === 0 && livePost.length === 0 && rec.markersApplied === 0 && !keep && rec.undone.length === 0;
      if (!empty) {
        recHash = hashJson({
          e: rec.events,
          m: rec.markersApplied,
          p: livePost.map((p) => ({ s: p.seq, k: p.kind, e: p.events })),
          k: keep ?? null,
          u: rec.undone,
        });
      }
    }
    const markerHash =
      liveMarkers.length === 0
        ? ""
        : hashJson(
            liveMarkers.map((mk) => {
              const { at: _at, start: _start, ...body } = mk;
              return body;
            }),
          );
    const path = hashParts("lre.path", parent, "a", content, recHash, markerHash);
    messages.push({ id: m.id, fold, parentPath: parent, path });
    parent = path;
  }
  state = structuredClone(state);
  return { state, notes, keepReport, messages, violations };
}
