import type { RunShown, TurnReply } from "../../../../shared/api";
import { Button } from "../../../atoms";
import type { RunNode } from "../../../live-model";
import { EachRun } from "../parts";
import { Folder } from "../folder";
import { LoreMapRows, NAMED_PARTS, PromptBySlice } from "../prompt-parts";
import type { TurnParts, TurnSection } from "../types";

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


/** The turn's folder's files the Author's prompt and briefing are made of, each opened on demand by the name it is given. */
function NamedParts(props: { folder: TurnParts["folder"]; onOpenFile(name: string): void }) {
  const files = (props.folder.files ?? []).filter((f) => !f.folder && NAMED_PARTS[f.name] !== undefined);
  if (files.length === 0) return null;
  return (
    <div class="lre-stack" data-named-parts>
      <span class="rpe-caption">Named parts</span>
      <div class="rpe-files">
        {files.map((f) => (
          <Button key={f.name} small kind="ghost" current={props.folder.open?.name === f.name} onClick={() => props.onOpenFile(f.name)}>
            {NAMED_PARTS[f.name]}
          </Button>
        ))}
      </div>
    </div>
  );
}

export const section: TurnSection = {
  id: "given",
  order: 50,
  title: "What the Author was given",
  spoiler: true,
  body: ({ turn, runs, folder, lead, loreRows, onOpenFile, onOpenRequest, onCloseFile }) => (
    <div class="lre-stack">
      <PromptBySlice prompt={turn.prompt} lead={lead} />
      <LoreMapRows rows={loreRows} />
      <NamedParts folder={folder} onOpenFile={onOpenFile} />
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
