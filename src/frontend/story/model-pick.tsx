// One level of the story engine's model ladder (`StorySettings.models`), as Settings → Story →
// Models and a principal's page on Harness → Cast set it: one of the runtime's connections, a model
// (typed, with the models of the connection it runs on offered as it is typed), and an effort. Each
// member left Not set falls through to the next level down the ladder, so a level can pick only the
// effort. Clear takes the level away whole. The connections offered are the runtime's own
// (`connections.ts`); a level saved on one the runtime doesn't have (one of Lumiverse's, chosen
// before the runtime kept its own) shows it as chosen, with what the agent runs on instead and how
// to choose again. What a pick names, in a line (`pickText`). Hook-free, but for the model's field,
// which reads its connection's models when it is first used.

import { useContext, useEffect, useId, useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import { MODEL_EFFORTS, type ModelEffortPick, type ModelPick } from "../../shared/settings";
import { Button } from "../components";
import { EFFORT_LABEL } from "../settings/steps";
import { type AgentConnections, connectionName, ConnectionsContext, NO_CONNECTION, notTheRuntimes, notTheRuntimesMark, notTheRuntimesText, unsetText } from "./connections";
import { andList, LEVEL_WORDS, type PickedBy } from "./model";

/** What a pick names, in a line: the connection by name, the model, the effort, each only where it is picked; null where it picks nothing. */
export function pickText(pick: ModelPick, connections: Pick<AgentConnections, "choices" | "lumiverse">): string | null {
  const parts = [pick.connectionId !== undefined ? connectionName(pick.connectionId, connections) : null, pick.model ?? null, pick.effort !== undefined ? `effort ${EFFORT_LABEL[pick.effort].toLowerCase()}` : null].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** What an agent runs on as the ladder picks it (`pickedBy`), in a line, and which levels picked it; or, where its connection isn't one of the runtime's, what it runs on instead. */
export function runsOnText(p: PickedBy, connections: AgentConnections): { line: string; note: string } {
  const named = pickText(p.pick, connections);
  if (named === null) return { line: "Nothing set", note: unsetText(connections) };
  const id = p.pick.connectionId;
  if (id !== undefined && notTheRuntimes(p.pick, connections)) return { line: named, note: `Its connection${p.connection !== null ? `, set by ${LEVEL_WORDS[p.connection]}` : ""}: ${notTheRuntimesText(id, connections, "below, or in Settings → Story → Models")}` };
  const levels = [...new Set([p.connection, p.model, p.effort].filter((l) => l !== null))];
  return { line: named, note: `Set by ${andList(levels.map((l) => LEVEL_WORDS[l]))}.${p.connection === null ? ` ${unsetText(connections)}` : ""}` };
}

/**
 * A level's model: typed, with the models of the connection the agent runs on offered as it is typed
 * (`connection`: one of the runtime's; null where the level names one the runtime doesn't have, so
 * its default's), read from the runtime the first time the field is used. With no connection on the
 * level (`connection` undefined) the model goes with whichever connection the ladder picks, and none
 * is listed.
 */
export function RuntimeModelField(props: { owner: string; value: string; notSet: string; runtime: string | null; connection?: string | null; busy: boolean; set(model: string | null): void }) {
  const port = useContext(ConnectionsContext);
  const listId = useId();
  const [models, setModels] = useState<readonly { id: string; name: string }[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const which = props.connection === undefined ? null : `${props.runtime ?? ""}\n${props.connection ?? ""}`;
  // Another connection, or another runtime's, has other models.
  useEffect(() => {
    setModels(null);
    setFailed(null);
  }, [which]);
  const list = (): void => {
    if (port === null || props.connection === undefined || models !== null || failed !== null) return;
    port.models(props.runtime, props.connection).then(
      (found) => setModels(found),
      (error: unknown) => setFailed(error instanceof Error ? error.message : String(error)),
    );
  };
  const help =
    props.connection === undefined
      ? "A model on whichever connection the ladder picks. Pick a connection above to choose from its models."
      : failed !== null
        ? `The connection's models couldn't be listed (${failed}): type the name.`
        : models === null
          ? props.connection === null
            ? "It runs on the runtime's default for now, so that connection's models are offered as you type."
            : "The connection's models are offered as you type."
          : models.length === 0
            ? "The connection lists no models: type the name."
            : `The connection offers ${models.length} model${models.length === 1 ? "" : "s"}: start typing to pick one.`;
  return (
    <label class="lre-field">
      <span class="label">Model</span>
      <input class="lre-input" value={props.value} placeholder={props.notSet} aria-label={`${props.owner}: model`} list={props.connection === undefined ? undefined : listId} autocomplete="off" disabled={props.busy} onFocus={list} onChange={(event) => props.set(event.currentTarget.value.trim() || null)} />
      {props.connection === undefined ? null : (
        <datalist id={listId}>
          {(models ?? []).map((m) => (
            <option key={m.id} value={m.id} label={m.name !== m.id ? m.name : undefined} />
          ))}
        </datalist>
      )}
      <span class="lre-field-help">{help}</span>
    </label>
  );
}

/**
 * The rows of one level: `fallsTo` says what a member left unset goes to (left out at the bottom of
 * the ladder, where the line under the connection says what then happens); `set` sends the members
 * changed (null deletes one), or null to take the level away.
 */
export function ModelPickRows(props: { id: string; owner: string; pick: ModelPick | undefined; fallsTo?: string; connections: AgentConnections; busy: boolean; set(fields: JsonObject | null): void }) {
  const pick = props.pick ?? {};
  const { connections } = props;
  const notSet = props.fallsTo === undefined ? "Not set" : `Not set: ${props.fallsTo}`;
  const saved = pick.connectionId;
  const gone = notTheRuntimes(pick, connections);
  // A saved connection the list doesn't offer (one the runtime doesn't have, or any while the list is read) still shows as the one chosen.
  const unlisted = saved !== undefined && !(connections.choices ?? []).some((c) => c.id === saved) ? connectionName(saved, connections) : null;
  const any = saved !== undefined || pick.model !== undefined || pick.effort !== undefined;
  const line = gone && saved !== undefined ? notTheRuntimesText(saved, connections) : connections.none ? NO_CONNECTION.line : (connections.waiting ?? connections.whose ?? (saved === undefined && props.fallsTo === undefined ? unsetText(connections) : null));
  return (
    <div class="lre-story-pick" data-lre-story-pick={props.id} data-lre-not-runtimes={gone ? "" : undefined}>
      <label class="lre-field">
        <span class="label">Connection</span>
        <select class={gone ? "lre-input invalid" : "lre-input"} value={saved ?? ""} aria-invalid={gone || undefined} disabled={props.busy || connections.choices === null} onChange={(event) => props.set({ connectionId: event.currentTarget.value || null, model: null })}>
          <option value="">{notSet}</option>
          {unlisted !== null && saved !== undefined ? <option value={saved}>{gone ? `${unlisted} (${notTheRuntimesMark(connections)})` : unlisted}</option> : null}
          {(connections.choices ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        {line !== null ? <span class={gone || connections.none ? "lre-field-help lre-story-problem" : "lre-field-help"}>{line}</span> : null}
      </label>
      <RuntimeModelField owner={props.owner} value={pick.model ?? ""} notSet={notSet} runtime={connections.runtime} {...(saved !== undefined ? { connection: gone ? null : saved } : {})} busy={props.busy} set={(model) => props.set({ model })} />
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
