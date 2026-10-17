// The Build draft (ARCHITECTURE §4 `lre.editor`, `lre.world commit`). `get` resumes the stored
// draft (or a fresh copy of the head), every write returns the whole draft, its lint and its
// base, which replace the held draft; commit turns it into a new revision, `discard` drops it.
// A stale base comes back `conflict` and reloads.

import type { WorldId } from "../../shared/ids";
import type { App, Draft } from "../app";
import type { Send } from "../registry";

export async function loadDraft(app: App, worldId: WorldId): Promise<Draft | null> {
  const [got, world] = await Promise.all([app.request({ type: "lre.editor", worldId, base: null, op: "get" }), app.request({ type: "lre.world", op: "get", worldId })]);
  if (!got) return null;
  const draft: Draft = { worldId, base: got.base, doc: got.draft, lint: got.lint, dirty: got.stored, packKinds: world?.packKinds ?? {}, packRelations: world?.packRelations ?? {} };
  app.drafts.set(draft);
  return draft;
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
      if (current) app.drafts.set({ ...current, doc: message.body.draft, lint: message.body.lint, base: message.body.base, dirty: message.body.stored });
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
  app.drafts.set({ ...draft, base: message.body.revision ?? draft.base, lint: message.body.lint ?? draft.lint, dirty: false });
  app.toast("Committed a new revision.", "info");
  return true;
}

/** Drops the stored draft and reloads the head. */
export async function discardDraft(app: App): Promise<void> {
  const draft = app.drafts.get();
  if (!draft) return;
  if (!(await app.host.confirm("Discard draft", "Throw away every uncommitted change to this world?", "danger", "Discard"))) return;
  const result = await app.request({ type: "lre.editor", worldId: draft.worldId, base: draft.base, op: "discard" });
  if (result) app.drafts.set({ ...draft, base: result.base, doc: result.draft, lint: result.lint, dirty: result.stored });
}
