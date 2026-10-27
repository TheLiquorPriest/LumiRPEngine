// The reference fold (DESIGN §14, the ledger gate): a small, obviously correct implementation of
// DESIGN §4.3. No cache, no overlay shortcut, no re-convergence: every call re-folds every
// message from the world revision. It shares only the event validators and reducers
// (engine/events.ts and pack event types) with the optimized fold, and re-implements the path
// rules itself so a mistake in one is caught by the other (L1).

import { hashJson, hashParts } from "../../shared/hash";
import type { EventRef, JournalNote, KeepLine, LedgerEvent, Marker, PathHash, PostEntry, Rec } from "../../shared/ledger";
import { ROOT_PATH } from "../../shared/ledger";
import { apartHost, applyEvent, applyMarker, tiesOf, TIED_DROP, validateEvent } from "../events";
import type { ReadContext } from "../registry";
import type { MarkerEnv, UpgradeTypes } from "../upgrade";
import { initialState } from "../world-state";
import { FoldError, type FoldInput, type FoldOutput, type MessageResult, type ResolvedFix } from "./chain";

/** What the fold needs from the registry: event types, relation types for the start state, read contexts (what an Upgrade's merge needs too). */
export type FoldTypes = UpgradeTypes;

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
  const resolved: ResolvedFix[] = [];
  const pausedAfter = new Set(input.pauses.map((p) => p.messageId));
  let paused = false;
  let parent: PathHash = ROOT_PATH;

  const ctx = (): ReadContext => {
    const world = input.worlds(state.revision);
    if (!world) throw new FoldError(`unknown revision ${state.revision}`);
    return types.context(world, state);
  };

  // An Upgrade's merge reads the revisions; what it says goes in the Journal at its marker.
  const env: MarkerEnv = { worlds: input.worlds, types };
  const marker = (messageId: string, m: Marker): void => {
    if (m.kind === "migrate") {
      const next = input.worlds(m.to);
      if (!next) throw new FoldError(`unknown revision ${m.to}`);
    }
    for (const text of applyMarker(state, m, env)) notes.push({ kind: "note", messageId, ref: { marker: m.seq }, text });
  };

  for (const m of input.chain) {
    const text = m.swipes[m.swipeId] ?? "";
    if (m.isUser) {
      const path = hashParts("lre.path", parent, "u", textHash(text), "", "");
      messages.push({ id: m.id, fold: "user", parentPath: parent, path, clock: state.clock });
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
      for (const mk of liveMarkers) marker(m.id, mk);
      fold = tombstoned ? "tombstoned" : "plain";
    } else {
      // A record read on another chain (its planned one gone) never folds on its own path.
      const view = recPath !== null && (recPath !== parent || rec.readElsewhere === true);
      const converted = rec.keep?.[parent]?.convert ?? [];
      const record = rec;
      /** Folds one event; true when the view drops it. */
      const event = (ev: LedgerEvent, ref: EventRef): boolean => {
        if (record.undone.some((u) => sameRef(u, ref))) return false;
        const failure = validateEvent(types, ev, ctx());
        if (failure && !view) {
          violations.push(`${m.id}: on-path ${ev.type} failed re-validation (${failure.reason})`);
          return false;
        }
        if (failure) {
          if (converted.some((c) => sameRef(c, ref))) {
            keepReport.push({ messageId: m.id, parentPath: parent, ref, status: "converted", text: failure.reason });
          } else {
            notes.push({ kind: "dropped", messageId: m.id, ref, text: failure.reason });
            keepReport.push({ messageId: m.id, parentPath: parent, ref, status: "dropped", text: failure.reason });
            return true;
          }
        }
        applyEvent(types, ev, state, ctx());
        return false;
      };
      // Every group of this record the view has dropped, in fold order.
      const droppedGroups: string[] = [];
      // A group (contiguous events sharing `group`) on a rebased view lands whole or not at all:
      // tried on a copy first; one failure drops every member, unless Keep converted one of them.
      // A unit kept apart (`APART_GROUP`) is tried with the unit after it that it stands with: both
      // land if both fit; else that unit is tried alone, and the one kept apart drops whatever it
      // does. With a Keep conversion in either, each is a group like any other. A unit that names a
      // dropped group among those it is tied to (`tiedTo`) drops too, unless Keep converted it.
      const run = (list: readonly LedgerEvent[], refOf: (index: number) => EventRef): void => {
        const membersOf = (from: number, to: number): { ev: LedgerEvent; ref: EventRef }[] => {
          const members: { ev: LedgerEvent; ref: EventRef }[] = [];
          for (let k = from; k < to; k++) {
            const ev = list[k];
            const ref = refOf(k);
            if (ev && !record.undone.some((u) => sameRef(u, ref))) members.push({ ev, ref });
          }
          return members;
        };
        const tryOn = (members: readonly { ev: LedgerEvent }[]): { reason: string } | null => {
          const trial = structuredClone(state);
          const world = input.worlds(trial.revision);
          if (!world) throw new FoldError(`unknown revision ${trial.revision}`);
          for (const x of members) {
            const failure = validateEvent(types, x.ev, types.context(world, trial));
            if (failure) return failure;
            applyEvent(types, x.ev, trial, types.context(world, trial));
          }
          return null;
        };
        const dropAll = (members: readonly { ref: EventRef }[], reason: string, group: string | undefined): void => {
          for (const x of members) {
            notes.push({ kind: "dropped", messageId: m.id, ref: x.ref, text: reason });
            keepReport.push({ messageId: m.id, parentPath: parent, ref: x.ref, status: "dropped", text: reason });
          }
          if (members.length > 0 && group !== undefined) droppedGroups.push(group);
        };
        const anyConverted = (members: readonly { ref: EventRef }[]): boolean => members.some((x) => converted.some((c) => sameRef(c, x.ref)));
        let i = 0;
        while (i < list.length) {
          const group = list[i]?.group;
          let j = i + 1;
          while (group !== undefined && j < list.length && list[j]?.group === group) j++;
          const members = membersOf(i, j);
          const host = view ? apartHost(list, [i, j]) : null;
          if (host) {
            const hosted = membersOf(host[0], host[1]);
            if (!anyConverted(members) && !anyConverted(hosted)) {
              i = host[1];
              const together = tryOn([...members, ...hosted]);
              if (!together) {
                for (const x of [...members, ...hosted]) applyEvent(types, x.ev, state, ctx());
                continue;
              }
              dropAll(members, together.reason, group);
              const alone = tryOn(hosted);
              if (alone) dropAll(hosted, alone.reason, list[host[0]]?.group);
              else for (const x of hosted) applyEvent(types, x.ev, state, ctx());
              continue;
            }
          }
          i = j;
          const tied = tiesOf(members.map((x) => x.ev));
          if (view && !anyConverted(members) && droppedGroups.some((g) => tied.includes(g))) {
            dropAll(members, TIED_DROP, group);
            continue;
          }
          if (members.length <= 1 || !view) {
            for (const x of members) if (event(x.ev, x.ref) && group !== undefined) droppedGroups.push(group);
            continue;
          }
          const failure = tryOn(members);
          if (!failure) {
            for (const x of members) applyEvent(types, x.ev, state, ctx());
            continue;
          }
          if (anyConverted(members)) {
            for (const x of members) {
              const own = validateEvent(types, x.ev, ctx());
              if (own) keepReport.push({ messageId: m.id, parentPath: parent, ref: x.ref, status: "converted", text: own.reason });
              applyEvent(types, x.ev, state, ctx());
            }
            continue;
          }
          dropAll(members, failure.reason, group);
        }
      };
      // On a view, a GM edit or ✎ fix that keeps what it asked for folds as that request worked out
      // again here (DESIGN §7, P2), not as stored: dropped whole when it can't be made (by its first
      // ref when it holds no events, being already so where it was made). One undone or converted in
      // any part folds as stored.
      const post = (p: PostEntry): void => {
        const refOf = (index: number): EventRef => ({ in: "post", seq: p.seq, index });
        const touched = [...record.undone, ...converted].some((u) => u.in === "post" && u.seq === p.seq);
        if (!view || p.kind !== "fix" || p.edit === undefined || touched) {
          run(p.events, refOf);
          return;
        }
        const world = input.worlds(state.revision);
        if (!world) throw new FoldError(`unknown revision ${state.revision}`);
        const again = input.resolveFix(world, state, p);
        if (again === null) run(p.events, refOf);
        else if ("rejection" in again) {
          const refs = p.events.length === 0 ? [refOf(0)] : p.events.map((_, i) => refOf(i));
          for (const ref of refs) {
            notes.push({ kind: "dropped", messageId: m.id, ref, text: again.rejection.reason });
            keepReport.push({ messageId: m.id, parentPath: parent, ref, status: "dropped", text: again.rejection.reason });
          }
        } else {
          resolved.push({ messageId: m.id, seq: p.seq, events: again.events });
          for (const ev of again.events) applyEvent(types, ev, state, ctx());
        }
      };
      for (const mk of liveMarkers) if (mk.seq <= record.markersApplied) marker(m.id, mk);
      run(record.events, (index) => ({ in: "events", index }));
      const later: ({ seq: number; marker: Marker } | { seq: number; post: PostEntry })[] = [
        ...liveMarkers.filter((mk) => mk.seq > record.markersApplied).map((mk) => ({ seq: mk.seq, marker: mk })),
        ...livePost.map((p) => ({ seq: p.seq, post: p })),
      ].sort((a, b) => a.seq - b.seq);
      for (const item of later) {
        if ("marker" in item) marker(m.id, item.marker);
        else post(item.post);
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
    messages.push({ id: m.id, fold, parentPath: parent, path, clock: state.clock });
    parent = path;
  }
  state = structuredClone(state);
  return { state, notes, keepReport, messages, resolved, violations };
}
