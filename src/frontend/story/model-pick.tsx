// One level of the story engine's model ladder (`StorySettings.models`), as Settings → Story →
// Models and a principal's page on Harness → Cast set it: a connection (with a model from it, or one
// typed), and an effort. Each member left Not set falls through to the next level down the ladder,
// so a level can pick only the effort. Clear takes the level away whole. The connections offered
// leave out every loopback (`connections.ts`); a level saved on one shows it, marked, with what to
// do. What a pick names, in a line (`pickText`): the connection by name, the model, the effort, each
// only where picked. Hook-free.

import type { JsonObject } from "../../shared/json";
import { MODEL_EFFORTS, type ModelEffortPick, type ModelPick } from "../../shared/settings";
import { Button, HostModelPicker } from "../components";
import { type Connection, EFFORT_LABEL } from "../settings/steps";
import { type AgentConnections, LOOPBACK_PROBLEM, onLoopback, UNSET_CONNECTION } from "./connections";
import { andList, LEVEL_WORDS, type PickedBy } from "./model";

/** What a pick names, in a line: the connection by name, the model, the effort, each only where it is picked; null where it picks nothing. */
export function pickText(pick: ModelPick, connections: readonly Connection[]): string | null {
  const parts = [pick.connectionId !== undefined ? (connections.find((c) => c.id === pick.connectionId)?.name ?? pick.connectionId) : null, pick.model ?? null, pick.effort !== undefined ? `effort ${EFFORT_LABEL[pick.effort].toLowerCase()}` : null].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** What an agent runs on as the ladder picks it (`pickedBy`), in a line, and which levels picked it; or, on a loopback, the problem. */
export function runsOnText(p: PickedBy, connections: AgentConnections): { line: string; note: string } {
  const named = pickText(p.pick, connections.all);
  if (named === null) return { line: "Nothing set", note: UNSET_CONNECTION };
  if (onLoopback(p.pick, connections.loopback)) return { line: named, note: `Its connection${p.connection !== null ? `, set by ${LEVEL_WORDS[p.connection]},` : ""} is the runtime's own, so it would call back into the runtime. Choose another below, or in Settings → Story → Models.` };
  const levels = [...new Set([p.connection, p.model, p.effort].filter((l) => l !== null))];
  return { line: named, note: `Set by ${andList(levels.map((l) => LEVEL_WORDS[l]))}.${p.connection === null ? ` ${UNSET_CONNECTION}` : ""}` };
}

/**
 * The rows of one level: `fallsTo` says what a member left unset goes to (left out at the bottom of
 * the ladder, where `unset` says what then happens); `set` sends the members changed (null deletes
 * one), or null to take the level away.
 */
export function ModelPickRows(props: { id: string; owner: string; pick: ModelPick | undefined; fallsTo?: string; unset?: string; connections: AgentConnections; busy: boolean; set(fields: JsonObject | null): void }) {
  const pick = props.pick ?? {};
  const { connections } = props;
  const notSet = props.fallsTo === undefined ? "Not set" : `Not set: ${props.fallsTo}`;
  const saved = pick.connectionId;
  const bad = onLoopback(pick, connections.loopback);
  // A saved connection the list doesn't offer (a loopback, or one Lumiverse no longer has) still shows as the one chosen.
  const unlisted = saved !== undefined && !(connections.choices ?? []).some((c) => c.id === saved) ? (connections.all.find((c) => c.id === saved)?.name ?? saved) : null;
  const any = saved !== undefined || pick.model !== undefined || pick.effort !== undefined;
  return (
    <div class="lre-story-pick" data-lre-story-pick={props.id}>
      <label class="lre-field">
        <span class="label">Connection</span>
        <select class={bad ? "lre-input invalid" : "lre-input"} value={saved ?? ""} aria-invalid={bad || undefined} disabled={props.busy || connections.choices === null} onChange={(event) => props.set({ connectionId: event.currentTarget.value || null, model: null })}>
          <option value="">{notSet}</option>
          {unlisted !== null && saved !== undefined ? (
            <option value={saved} disabled={bad}>
              {bad ? `${unlisted} (the runtime's own)` : unlisted}
            </option>
          ) : null}
          {(connections.choices ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.model ? `${c.name} · ${c.model}` : c.name}
            </option>
          ))}
        </select>
        {bad ? (
          <span class="lre-field-help lre-story-problem" role="alert">
            {LOOPBACK_PROBLEM}
          </span>
        ) : connections.waiting !== null ? (
          <span class="lre-field-help">{connections.waiting}</span>
        ) : saved === undefined && props.unset !== undefined ? (
          <span class="lre-field-help">{props.unset}</span>
        ) : null}
      </label>
      {saved === undefined ? (
        <label class="lre-field">
          <span class="label">Model</span>
          <input class="lre-input" value={pick.model ?? ""} placeholder={notSet} disabled={props.busy} onChange={(event) => props.set({ model: event.currentTarget.value.trim() || null })} />
          <span class="lre-field-help">A model on whichever connection the ladder picks. Pick a connection above to choose from its models.</span>
        </label>
      ) : bad ? null : (
        <HostModelPicker connectionId={saved} value={pick.model ?? ""} label={`${props.owner}: model`} onChange={(model) => props.set({ model: model || null })} />
      )}
      <label class="lre-field">
        <span class="label">Effort</span>
        <select class="lre-input" value={pick.effort ?? ""} disabled={props.busy} onChange={(event) => props.set({ effort: (event.currentTarget.value || null) as ModelEffortPick | null })}>
          <option value="">{notSet}</option>
          {MODEL_EFFORTS.map((effort) => (
            <option key={effort} value={effort}>
              {EFFORT_LABEL[effort]}
            </option>
          ))}
        </select>
      </label>
      {any ? (
        <Button size="sm" variant="ghost" icon="undo" label={`Clear ${props.owner}'s own choice`} disabled={props.busy} onClick={() => props.set(null)}>
          Clear
        </Button>
      ) : null}
    </div>
  );
}
