import type { RunShown, TurnReply } from "../../../../shared/api";
import { Button } from "../../../atoms";
import type { RunNode } from "../../../live-model";
import { EachRun } from "../parts";
import { Folder } from "../folder";
import type { TurnSection } from "../types";

/** What a run's lead was given, by the names it began work with. */
function Given(props: { run: RunNode }) {
  const lead = props.run.roots[0];
  const info = lead === undefined ? null : (props.run.agents.get(lead)?.info ?? null);
  if (info === null) return <p class="lre-muted rpe-line">Its lead has not begun work.</p>;
  return <p class="rpe-line">{info.given.length === 0 ? `${info.definition} was given nothing by name.` : `${info.definition} was given: ${info.given.join(", ")}.`}</p>;
}

/** What each agent of a run was sent on its first model call, where the harness kept it: its request rebuilt exactly as sent, opened on demand. */
function FirstCalls(props: { view: RunShown | undefined; onOpenRequest(name: string, held: string | null): void }) {
  const first = new Map<string, RunShown["requests"][number]>();
  for (const request of props.view?.requests ?? []) {
    const held = first.get(request.agent);
    if (held === undefined || request.call < held.call) first.set(request.agent, request);
  }
  if (first.size === 0) return null;
  return (
    <div class="lre-stack" data-first-calls>
      <span class="rpe-caption">What each agent was sent first</span>
      <div class="rpe-files">
        {[...first.values()].map((r) => (
          <Button key={r.agent} small kind="ghost" onClick={() => props.onOpenRequest(r.file, props.view?.held ?? null)}>
            {`${r.definition} (${r.agent}), call ${r.call}`}
          </Button>
        ))}
      </div>
    </div>
  );
}


/** The lore of the turn's prompt, by id, as its intake kept it: what Lumiverse activated for it, and what its lore map showed the Author. */
function TurnLore(props: { lore: TurnReply["lore"] }) {
  const { activated, map } = props.lore;
  return (
    <div class="lre-stack" data-lore>
      <span class="rpe-caption">Its lore, by id</span>
      <p class="rpe-line">
        Lumiverse activated for its prompt: {activated.length === 0 ? "no entry." : <span class="lre-id">{activated.join(", ")}</span>}
      </p>
      <p class="rpe-line">
        Its lore map showed the Author: {map.length === 0 ? "no entry." : <span class="lre-id">{map.join(", ")}</span>}
      </p>
    </div>
  );
}


export const section: TurnSection = {
  id: "given",
  order: 50,
  title: "What the Author was given",
  spoiler: true,
  body: ({ turn, runs, folder, onOpenFile, onOpenRequest, onCloseFile }) => (
    <div class="lre-stack">
      <EachRun
        runs={runs}
        views={turn.runs}
        part={(run, view) => (
          <>
            <Given run={run} />
            <FirstCalls view={view} onOpenRequest={onOpenRequest} />
          </>
        )}
      />
      <TurnLore lore={turn.lore} />
      <Folder folder={folder} onOpenFile={onOpenFile} onCloseFile={onCloseFile} />
    </div>
  ),
};
