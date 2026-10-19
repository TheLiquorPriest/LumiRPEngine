// The Build draft (ARCHITECTURE §4 `lre.editor`, `lre.world commit`). `get` resumes the stored
// draft (or a fresh copy of the head), every write returns the whole draft, its lint, its base and
// its version, which replace the held draft; commit turns it into a new revision, `discard` drops
// it. A stale base comes back `conflict` and reloads, and so does a draft another window or an
// outside agent changed (`lre.draft.changed`, DESIGN §23).

import type { WorldId } from "../../shared/ids";
import type { App, Draft } from "../app";
import type { Send } from "../registry";

/** Draft loads under way, by world. */
const loading = new Map<WorldId, Promise<Draft | null>>();

export function loadDraft(app: Pick<App, "request" | "drafts">, worldId: WorldId): Promise<Draft | null> {
  const load = (async (): Promise<Draft | null> => {
    const [got, world] = await Promise.all([app.request({ type: "lre.editor", worldId, base: null, op: "get" }), app.request({ type: "lre.world", op: "get", worldId })]);
    if (!got) return null;
    const draft: Draft = { worldId, base: got.base, version: got.version, doc: got.draft, lint: got.lint, dirty: got.stored, packKinds: world?.packKinds ?? {}, packRelations: world?.packRelations ?? {}, functions: world?.functions ?? [] };
    app.drafts.set(draft);
    return draft;
  })().finally(() => {
    if (loading.get(worldId) === load) loading.delete(worldId);
  });
  loading.set(worldId, load);
  return load;
}

/**
 * Reloads the held draft when its world's draft changed elsewhere (`lre.draft.changed`): in another
 * window, or by an outside agent. Build's own writes answer with the new version before their push
 * arrives, so they reload nothing, and a load already under way finishes first, since it may have
 * read the change already. Installed once at setup.
 */
export function trackDraft(app: Pick<App, "client" | "drafts" | "request" | "toast">): () => void {
  return app.client.onDraftChanged((push) => {
    void (async () => {
      await loading.get(push.worldId);
      const held = app.drafts.get();
      if (!held || held.worldId !== push.worldId || held.version === push.version) return;
      if (await loadDraft(app, push.worldId)) app.toast("This world's draft changed in another window, or an outside agent changed it; Build reloaded it.", "info");
    })();
  });
}

/**
 * The `send` Build editors receive: `lre.editor` requests get the open draft's world and base
 * filled in, and their results replace the draft. Errors are shown; a conflict reloads.
 */
export function draftSend(app: App): Send {
  return async (body) => {
    const draft = app.drafts.get();
    const request = body.type === "lre.editor" && draft ? { ...body, worldId: draft.worldId, base: draft.base } : body;
    const message = await app.send(request);
    if (message.type === "lre.error") {
      app.toast(message.code === "conflict" ? "This world changed elsewhere. Reloaded the latest revision." : message.message, "error");
      if (message.code === "conflict" && draft) await loadDraft(app, draft.worldId);
    } else if (message.request === "lre.editor") {
      const current = app.drafts.get();
      if (current) app.drafts.set({ ...current, doc: message.body.draft, lint: message.body.lint, base: message.body.base, version: message.body.version, dirty: message.body.stored });
    }
    return message;
  };
}

export async function commitDraft(app: App): Promise<boolean> {
  const draft = app.drafts.get();
  if (!draft) return false;
  const message = await app.send({ type: "lre.world", op: "commit", worldId: draft.worldId, base: draft.base });
  if (message.type === "lre.error") {
    app.toast(message.code === "validation" ? `Fix ${message.lint?.length ?? 0} error(s) before committing.` : message.message, "error");
    if (message.lint) app.drafts.set({ ...draft, lint: message.lint });
    if (message.code === "conflict") await loadDraft(app, draft.worldId);
    return false;
  }
  if (message.request !== "lre.world") return false;
  // A commit leaves no stored draft, so its push says version 0.
  app.drafts.set({ ...draft, base: message.body.revision ?? draft.base, lint: message.body.lint ?? draft.lint, version: 0, dirty: false });
  app.toast("Committed a new revision.", "info");
  return true;
}

/** Drops the stored draft and reloads the head. */
export async function discardDraft(app: App): Promise<void> {
  const draft = app.drafts.get();
  if (!draft) return;
  if (!(await app.host.confirm("Discard draft", "Throw away every uncommitted change to this world?", "danger", "Discard"))) return;
  const result = await app.request({ type: "lre.editor", worldId: draft.worldId, base: draft.base, op: "discard" });
  if (result) app.drafts.set({ ...draft, base: result.base, doc: result.draft, lint: result.lint, version: result.version, dirty: result.stored });
}
