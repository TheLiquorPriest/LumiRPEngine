// The Build draft (ARCHITECTURE §4 `lre.editor`, `lre.world commit`). `get` resumes the stored
// draft (or a fresh copy of the head), every write returns the whole draft, its lint, its base and
// its version, which replace the held draft; commit turns it into a new revision, `discard` drops
// it. Build's writes, discards and commits name the version it holds, so one made over a change it
// hasn't loaded is refused (`conflict`) and reloads. A change made elsewhere (`lre.draft.changed`,
// DESIGN §23) reloads too, once a burst of them stops; forms keep their edits (`held.tsx`).

import type { WorldId } from "../../shared/ids";
import type { App, Draft } from "../app";
import type { Send } from "../registry";
import { confirmOverwrite, NOT_SAVED } from "./held";

/** Draft loads under way, by world. */
const loading = new Map<WorldId, Promise<Draft | null>>();

const RELOADED = "This world's draft changed in another window, or an outside agent changed it; Build reloaded it.";

/** How long a burst of pushes must stop before Build reloads, so an agent's quick writes cost one reload. */
export const QUIET_MS = 300;

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const REAL_TIMERS: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle as number) };

function track<T extends Draft | null>(worldId: WorldId, load: Promise<T>): Promise<T> {
  const settled = load.finally(() => {
    if (loading.get(worldId) === settled) loading.delete(worldId);
  });
  loading.set(worldId, settled);
  return settled;
}

/** Loads the world's draft and the packs' kinds, relation types and functions its editors need. */
export function loadDraft(app: Pick<App, "request" | "drafts">, worldId: WorldId): Promise<Draft | null> {
  return track(
    worldId,
    (async (): Promise<Draft | null> => {
      const [got, world] = await Promise.all([app.request({ type: "lre.editor", worldId, base: null, op: "get" }), app.request({ type: "lre.world", op: "get", worldId })]);
      if (!got) return null;
      const draft: Draft = { worldId, base: got.base, version: got.version, doc: got.draft, lint: got.lint, dirty: got.stored, reloaded: true, packKinds: world?.packKinds ?? {}, packRelations: world?.packRelations ?? {}, functions: world?.functions ?? [] };
      app.drafts.set(draft);
      return draft;
    })(),
  );
}

/** Reads the held world's draft again; the packs' parts don't change with it, so only the draft is asked for. */
function refreshDraft(app: Pick<App, "request" | "drafts">, worldId: WorldId): Promise<Draft | null> {
  const held = app.drafts.get();
  if (!held || held.worldId !== worldId) return loadDraft(app, worldId);
  return track(
    worldId,
    (async (): Promise<Draft | null> => {
      const got = await app.request({ type: "lre.editor", worldId, base: null, op: "get" });
      const now = app.drafts.get();
      if (!got || !now || now.worldId !== worldId) return null;
      const draft: Draft = { ...now, base: got.base, version: got.version, doc: got.draft, lint: got.lint, dirty: got.stored, reloaded: true };
      app.drafts.set(draft);
      return draft;
    })(),
  );
}

/**
 * Reloads the held draft when its world's working copy changed elsewhere (`lre.draft.changed`): in
 * another window, or by an outside agent. A push no newer than the version Build holds is ignored
 * (Build's own writes answer with theirs before their push comes), a burst reloads once after
 * QUIET_MS, and a load already under way finishes first, since it may have read the change already.
 * Installed once at setup.
 */
export function trackDraft(app: Pick<App, "client" | "drafts" | "request" | "toast">, timers: Timers = REAL_TIMERS): () => void {
  const wanted = new Map<WorldId, number>();
  const timer = new Map<WorldId, unknown>();
  const running = new Set<WorldId>();
  const behind = (worldId: WorldId): boolean => {
    const held = app.drafts.get();
    return held !== null && held.worldId === worldId && (wanted.get(worldId) ?? 0) > held.version;
  };
  const reload = async (worldId: WorldId): Promise<void> => {
    running.add(worldId);
    try {
      await loading.get(worldId);
      if (behind(worldId) && (await refreshDraft(app, worldId))) app.toast(RELOADED, "info");
    } finally {
      running.delete(worldId);
      if (behind(worldId)) schedule(worldId);
    }
  };
  const schedule = (worldId: WorldId): void => {
    const prior = timer.get(worldId);
    if (prior !== undefined) timers.clear(prior);
    timer.set(
      worldId,
      timers.set(() => {
        timer.delete(worldId);
        if (!running.has(worldId)) void reload(worldId);
      }, QUIET_MS),
    );
  };
  const off = app.client.onDraftChanged((push) => {
    const held = app.drafts.get();
    if (!held || held.worldId !== push.worldId || push.version <= held.version) return;
    wanted.set(push.worldId, Math.max(wanted.get(push.worldId) ?? 0, push.version));
    // A reload under way looks again when it ends.
    if (!running.has(push.worldId)) schedule(push.worldId);
  });
  return () => {
    off();
    for (const handle of timer.values()) timers.clear(handle);
  };
}

/** After a reconnect, which may have missed a push: reads the held draft again and says so when it changed. */
export async function recheckDraft(app: Pick<App, "drafts" | "request" | "toast">): Promise<void> {
  const held = app.drafts.get();
  if (!held) return;
  await loading.get(held.worldId);
  const before = app.drafts.get();
  if (!before || before.worldId !== held.worldId) return;
  const now = await refreshDraft(app, held.worldId);
  if (now && now.version !== before.version) app.toast(RELOADED, "info");
}

/**
 * The `send` Build editors receive: `lre.editor` requests get the open draft's world, base and
 * version filled in, and their results replace the draft. A write over a change a form holds its
 * edits over asks first (`held.tsx`). Errors are shown; a conflict reloads, and the forms keep
 * their edits for another save.
 */
export function draftSend(app: App): Send {
  return async (body) => {
    const draft = app.drafts.get();
    const write = body.type === "lre.editor" && body.op !== "get";
    if (write && !(await confirmOverwrite(app))) return NOT_SAVED;
    const request = body.type === "lre.editor" && draft ? { ...body, worldId: draft.worldId, base: draft.base, version: draft.version } : body;
    const message = await app.send(request);
    if (message.type === "lre.error") {
      app.toast(message.code === "conflict" ? "This world changed elsewhere, so nothing was saved. Build reloaded it; save again to keep your change." : message.message, "error");
      if (message.code === "conflict" && draft) await refreshDraft(app, draft.worldId);
    } else if (message.request === "lre.editor") {
      const current = app.drafts.get();
      if (current) app.drafts.set({ ...current, doc: message.body.draft, lint: message.body.lint, base: message.body.base, version: message.body.version, dirty: message.body.stored, reloaded: false });
    }
    return message;
  };
}

/** Commits the draft Build holds, at the version it holds; then reads the world again, whatever it held meanwhile. */
export async function commitDraft(app: App): Promise<boolean> {
  const draft = app.drafts.get();
  if (!draft) return false;
  const message = await app.send({ type: "lre.world", op: "commit", worldId: draft.worldId, base: draft.base, version: draft.version });
  if (message.type === "lre.error") {
    app.toast(message.code === "validation" ? `Fix ${message.lint?.length ?? 0} error(s) before committing.` : message.message, "error");
    if (message.lint) app.drafts.set({ ...draft, lint: message.lint });
    if (message.code === "conflict") await refreshDraft(app, draft.worldId);
    return false;
  }
  if (message.request !== "lre.world") return false;
  // Another change may have landed between the commit and its answer, so the draft is read, not assumed.
  await refreshDraft(app, draft.worldId);
  app.toast("Committed a new revision.", "info");
  return true;
}

/** Drops the stored draft and reloads the head; the draft must still be the one the dialog was shown for. */
export async function discardDraft(app: App): Promise<void> {
  const draft = app.drafts.get();
  if (!draft) return;
  if (!(await app.host.confirm("Discard draft", "Throw away every uncommitted change to this world?", "danger", "Discard"))) return;
  const message = await app.send({ type: "lre.editor", worldId: draft.worldId, base: draft.base, version: draft.version, op: "discard" });
  if (message.type === "lre.error") {
    app.toast(message.code === "conflict" ? "Nothing was discarded: the draft changed while you were asked. Build reloaded it." : message.message, "error");
    if (message.code === "conflict") await refreshDraft(app, draft.worldId);
    return;
  }
  if (message.request === "lre.editor") app.drafts.set({ ...draft, base: message.body.base, doc: message.body.draft, lint: message.body.lint, version: message.body.version, dirty: message.body.stored, reloaded: false });
}
