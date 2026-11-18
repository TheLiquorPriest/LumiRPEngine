// What a chat plays by on its own, which no turn sets and the World page changes (plan §14): how closely each part of life is
// worked out (its realism levels and the caps of each kind of person), what something you add that the world doesn't have
// becomes (its claims), and when a check rolls and when a failed try may be tried again (its check rules). Each is what the
// engine's packs, the panels' Add and the action resolver read of the chat's state, so a change records exactly that and no more:
// a marker of his, in one edit through the one owner's-edit path, from now on and over nothing already recorded, with the id
// its Undo takes. A chat's claims and check rules may also be given back to what its world says. Every refusal and every
// answer is a line of `.prompts/play-answers.md`.

import { policyOf } from "../engine/adjudication";
import { applyMarker, validMarkerBody } from "../engine/events";
import { claimsOf, presetOf } from "../engine/realism";
import { levelFloors } from "../engine/registry-impl";
import type { WorldState } from "../engine/state";
import { type Infer, type LiveHub, route, RouteError, shape, type WriteQueue } from "../app";
import { CHECK_TIMINGS, readAdjudication, RETRY_RULES } from "../shared/adjudication";
import { CLAIM_MODES } from "../shared/claims";
import { BANDS, DOMAIN_LABEL, DOMAINS } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import type { ErrorCode } from "../shared/protocol";
import { bandTiers } from "../shared/tiers";
import type { WorldDoc } from "../shared/world";
import type { Store } from "../store";
import { STORE_OPS } from "../store/types";
import { type Head, headOf, recordOwnerEdit, Refused, type Resolved } from "./owner-edits";
import { answerWords, playAnswers } from "./service";

export const OWN_PATH = "/api/v1/chats/:chat/own-values";

const T = shape.text();
const opt = shape.optional;
const level = shape.whole({ least: 0, most: 4 });
const share = shape.number({ least: 0, most: 1 });
const minutes = shape.whole({ least: 0, most: 10_080 });

const ownAsk = shape.named(
  "OwnAsk",
  "One change to what a chat plays by on its own: a realism level for everyone, one band's cap for a part of life, what something you add that the world doesn't have becomes, or when checks roll and when a failed try may be tried again (each as far as it is given); or the claims or the check rules given back to what the chat's world says.",
  shape.union(
    shape.object({ kind: shape.literal("level"), domain: shape.oneOf(...DOMAINS), to: level }),
    shape.object({ kind: shape.literal("cap"), band: shape.oneOf(...BANDS), domain: shape.oneOf(...DOMAINS), to: level }),
    shape.object({ kind: shape.literal("claims"), mode: opt(shape.oneOf(...CLAIM_MODES)), capped: opt(shape.yesNo()) }),
    shape.object({ kind: shape.literal("claims-world") }),
    shape.object({
      kind: shape.literal("checks"),
      when: opt(shape.oneOf(...CHECK_TIMINGS)),
      riskyAt: opt(share),
      trivialAt: opt(shape.nullable(share)),
      impossibleAt: opt(shape.nullable(share)),
      retry: opt(shape.oneOf(...RETRY_RULES)),
      retryAfter: opt(minutes),
    }),
    shape.object({ kind: shape.literal("checks-world") }),
  ),
);

const ownValues = shape.named(
  "OwnValues",
  "What a chat plays by on its own now: its realism (the preset its levels match, each part of life's level, each band's cap, the floors the world's ruleset sets, and the world's tiers in each band), what something you add that the world doesn't have becomes (and whether the chat set it), and when checks roll and when a failed try may be tried again (and whether the chat set it).",
  shape.object({
    realism: shape.object({
      preset: shape.oneOf("story", "grounded", "simulation", "custom"),
      levels: shape.record(level),
      caps: shape.record(shape.record(level)),
      floors: shape.record(level),
      tiers: shape.record(shape.list(T)),
    }),
    claims: shape.object({ mode: shape.oneOf(...CLAIM_MODES), capped: shape.yesNo(), own: shape.yesNo() }),
    checks: shape.object({
      when: shape.oneOf(...CHECK_TIMINGS),
      riskyAt: share,
      trivialAt: shape.nullable(share),
      impossibleAt: shape.nullable(share),
      retry: shape.oneOf(...RETRY_RULES),
      retryAfter: minutes,
      own: shape.yesNo(),
    }),
  }),
);

const ownAnswer = shape.named(
  "OwnAnswer",
  "What a change to a chat's own values came to: whether it was recorded, the id its Undo takes (null where nothing was recorded), and the answer in words.",
  shape.object({ applied: shape.yesNo(), undo: shape.nullable(T), words: T }),
);

/** One change to what a chat plays by on its own (the body of the route). */
export type OwnChange = Infer<typeof ownAsk>;
/** What a chat plays by on its own now. */
export type OwnShown = Infer<typeof ownValues>;
/** What a change came to. */
export type OwnChanged = Infer<typeof ownAnswer>;

/** The status a refusal is answered with, by its code. */
const STATUS: Readonly<Record<ErrorCode, number>> = { bad_request: 400, not_found: 404, not_world_chat: 404, conflict: 409, paused: 409, validation: 422, forbidden: 403, unavailable: 409, internal: 500 };

export interface OwnDeps {
  store: Store;
  writes: WriteQueue;
  live: Pick<LiveHub, "publish">;
  /** The guidance folder whose `.prompts/` holds the words. */
  guidance: string;
}

/** What the chat's state plays by. */
function shown(world: WorldDoc, state: Readonly<WorldState>): OwnShown {
  const floors = levelFloors(world);
  const policy = policyOf(world, state);
  return {
    realism: {
      preset: presetOf(state.realism),
      levels: { ...state.realism.levels },
      // A band with no cap for a part of life holds that part to its level: shown as the highest.
      caps: Object.fromEntries(BANDS.map((b) => [b, Object.fromEntries(DOMAINS.map((d) => [d, state.realism.tierCaps[b][d] ?? 4]))])),
      floors: Object.fromEntries(DOMAINS.map((d) => [d, floors[d] ?? 0])),
      tiers: bandTiers(world),
    },
    claims: { ...claimsOf(world, state), own: state.claims !== undefined },
    checks: { when: policy.checks, riskyAt: policy.riskyAt, trivialAt: policy.trivialAt, impossibleAt: policy.impossibleAt, retry: policy.retry, retryAfter: policy.retryAfter, own: state.adjudication !== undefined },
  };
}

/** The marker a change comes to on the chat's head. */
function markerOf(ask: OwnChange, world: WorldDoc, state: Readonly<WorldState>): JsonObject {
  switch (ask.kind) {
    case "level": {
      const floor = levelFloors(world)[ask.domain] ?? 0;
      if (ask.to < floor) throw new Refused("validation", { line: "own_below_floor", fields: { domain: DOMAIN_LABEL[ask.domain], floor } });
      return { kind: "resolve", domain: ask.domain, scope: { all: true }, to: ask.to };
    }
    case "cap":
      return { kind: "resolve", domain: ask.domain, scope: { tier: ask.band }, to: ask.to };
    case "claims":
      return { kind: "claims", to: { ...claimsOf(world, state), ...(ask.mode === undefined ? {} : { mode: ask.mode }), ...(ask.capped === undefined ? {} : { capped: ask.capped }) } };
    case "claims-world":
      return { kind: "claims", to: null };
    case "checks": {
      const { when, ...rest } = ask;
      const next = { ...policyOf(world, state), ...rest, ...(when === undefined ? {} : { checks: when }), preset: "custom" };
      return { kind: "adjudicate", to: readAdjudication(next) as unknown as JsonValue };
    }
    case "checks-world":
      return { kind: "adjudicate", to: null };
  }
}

/** Reads and changes what a chat plays by on its own. */
export class OwnService {
  constructor(private readonly deps: OwnDeps) {}

  /** What the chat plays by now; a chat that plays no world is refused in its words. */
  async values(user: string, chat: string): Promise<OwnShown> {
    try {
      const head = headOf(this.deps.store, user, chat);
      return shown(head.world, head.state);
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      throw new RouteError(STATUS[error.code], await this.words(error));
    }
  }

  /** One change, recorded at once as his own edit; a refusal is answered in words with nothing changed. */
  async change(user: string, chat: string, ask: OwnChange): Promise<OwnChanged> {
    try {
      const { undo } = await recordOwnerEdit(this.deps, user, chat, { kind: "own", ask: ask as unknown as JsonValue }, null, (head) => this.marker(head, ask));
      return { applied: undo !== null, undo, words: undo === null ? answerWords(await playAnswers(this.deps.guidance), "changes_nothing") : "" };
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      return { applied: false, undo: null, words: await this.words(error) };
    }
  }

  private marker(head: Head, ask: OwnChange): Resolved {
    const body = validMarkerBody(markerOf(ask, head.world, head.state));
    if (body === null || (body.kind !== "resolve" && body.kind !== "claims" && body.kind !== "adjudicate")) throw new Refused("bad_request", { line: "own_unreadable" });
    // Nothing is recorded for what the chat already plays by.
    const after = structuredClone(head.state) as WorldState;
    applyMarker(after, body);
    const held = (s: Readonly<WorldState>): string => JSON.stringify([s.realism, s.claims ?? null, s.adjudication ?? null]);
    if (held(after) === held(head.state)) return { opened: [], events: [] };
    return { opened: [], events: [], store: [{ op: STORE_OPS.marker, value: body as unknown as JsonValue }] };
  }

  private async words(error: Refused): Promise<string> {
    return "words" in error.why ? error.why.words : answerWords(await playAnswers(this.deps.guidance), error.why.line, error.why.fields, error.why.codes);
  }
}

/** The routes of a chat's own values: what it plays by now, and one change to it. */
export function ownRoutes(own: OwnService) {
  return [
    route({
      method: "GET",
      path: OWN_PATH,
      access: "page",
      group: "state",
      does: "What a chat plays by on its own now: how closely each part of life is worked out, what something you add that the world doesn't have becomes, and when checks roll.",
      reply: ownValues,
      handle: ({ user, params }) => own.values(user, params.chat),
    }),
    route({
      method: "POST",
      path: OWN_PATH,
      access: "page",
      group: "state",
      does: "One change to what a chat plays by on its own, recorded at once as his own edit from now on, over nothing already recorded, and taken back by the Undo its answer names; a refusal is answered in words with nothing changed.",
      body: ownAsk,
      reply: ownAnswer,
      handle: ({ user, params, body }) => own.change(user, params.chat, body),
    }),
  ] as const;
}
