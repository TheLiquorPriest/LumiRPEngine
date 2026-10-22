// GM → Minds on demand (DESIGN §24.9) and the lore pinned for a character (§24.5). The run card asks
// the backend (`lre.minds`) to run the minds of one character, of those picked, or of everyone Live
// and Near, from the chat so far; its progress arrives as `lre.minds.update` for this session, each
// mind with how it went and why it failed, and once it is recorded its Undo takes it back. The
// pinned-lore section shows what is pinned to a character and to where they are, as the chat's
// world revision has it, and opens Build where the pins are edited. GM data, behind the gate.

import { useEffect, useState } from "preact/hooks";
import type { EntityId, PlaceId } from "../../../shared/ids";
import type { MindsRunView } from "../../../shared/minds";
import type { LorePinView, LorePinsView } from "../../../shared/protocol";
import type { GmView } from "../../../shared/state-view";
import { useApp, useView } from "../../../frontend/app";
import { Badge, Banner, Button, List, ListRow, Meter, Section } from "../../../frontend/components";
import type { RequestBody, Send } from "../../../frontend/registry";
import { FIDELITY_LABEL } from "./ops";

const STATUS: Record<MindsRunView["entries"][number]["status"], { text: string; tone: "neutral" | "accent" | "pos" | "neg" | "warn" }> = {
  waiting: { text: "Waiting", tone: "neutral" },
  thinking: { text: "Thinking", tone: "accent" },
  recorded: { text: "Recorded", tone: "pos" },
  failed: { text: "Failed", tone: "neg" },
  cancelled: { text: "Cancelled", tone: "warn" },
};

/** The chat's minds run as GM → Minds shows it, and what acts on it. */
export interface MindsRun {
  run: MindsRunView | null;
  /** Why the last request failed, in the backend's words. */
  error: string | null;
  /** The run's Undo was used. */
  undone: boolean;
  start(who?: EntityId[]): Promise<boolean>;
  cancel(): Promise<boolean>;
  undo(): Promise<void>;
}

/** The chat's minds run: the latest one, kept live by its updates; `start`, `cancel` and `undo` act on it. */
export function useMindsRun(chatId: string, send: Send, reload: () => Promise<void>): MindsRun {
  const app = useApp();
  const [run, setRun] = useState<MindsRunView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undone, setUndone] = useState(false);
  useEffect(() => {
    let live = true;
    void send({ type: "lre.minds", op: "status", chatId }).then((m) => {
      if (live && m.type === "lre.result" && m.request === "lre.minds") setRun(m.body.run);
    });
    const off = app.client.onMindsRun((u) => {
      if (u.chatId !== chatId) return;
      setRun(u.run);
      if (u.run.status !== "running") void reload();
    });
    return () => {
      live = false;
      off();
    };
  }, [chatId]);
  const act = async (body: RequestBody): Promise<boolean> => {
    setError(null);
    const m = await send(body);
    if (m.type === "lre.error") {
      setError(m.message);
      return false;
    }
    if (m.type === "lre.result" && m.request === "lre.minds") setRun(m.body.run);
    return true;
  };
  return {
    run,
    error,
    undone,
    start: (who?: EntityId[]) => {
      setUndone(false);
      return act({ type: "lre.minds", op: "run", chatId, ...(who ? { who } : {}) });
    },
    cancel: () => (run ? act({ type: "lre.minds", op: "cancel", chatId, runId: run.runId }) : Promise.resolve(false)),
    undo: async () => {
      if (!run?.undo) return;
      const m = await send({ type: "lre.chip", chatId, chip: run.undo, choice: "undo" });
      if (m.type === "lre.error") setError(m.message);
      else {
        setUndone(true);
        await reload();
      }
    },
  };
}


/** The run under way or just ended: each mind with how it went, the run's end, and Cancel or Undo. */
export function RunCard(props: { minds: MindsRun; busy: boolean }) {
  const { run, error } = props.minds;
  if (!run && !error) return null;
  const finished = run ? run.entries.filter((e) => e.status !== "waiting" && e.status !== "thinking").length : 0;
  return (
    <div data-lre-minds-run={run?.status ?? "error"}>
      <Section title={run?.status === "running" ? "Running minds" : "Last minds run"} aside={run ? <Badge tone={run.status === "done" ? "pos" : run.status === "running" ? "accent" : "warn"}>{run.status === "running" ? `${finished} of ${run.entries.length}` : run.status === "done" ? "Recorded" : run.status === "cancelled" ? "Cancelled" : "Failed"}</Badge> : undefined} flush>
        {error ? (
          <Banner tone="neg" title="The run didn't start">
            {error}
          </Banner>
        ) : null}
        {run ? (
          <>
            {run.status === "running" ? (
              <div class="lre-gm-minds-run-meter">
                <Meter label={`${finished} of ${run.entries.length} minds done`} value={finished} max={Math.max(1, run.entries.length)} />
              </div>
            ) : null}
            {run.message ? <p class="lre-gm-minds-run-note">{run.message}</p> : null}
            <List>
              {run.entries.map((e) => (
                <ListRow
                  key={e.entity}
                  title={e.name}
                  subtitle={
                    <span class="lre-gm-minds-run-sub">
                      <span>{[FIDELITY_LABEL[e.level], e.ms !== undefined && e.status !== "waiting" ? `${(e.ms / 1000).toFixed(1)} s · ${e.tokens ?? 0} tok` : ""].filter((s) => s !== "").join(" · ")}</span>
                      {e.reason ? <span class="lre-gm-minds-run-why">{e.reason}</span> : null}
                      {(e.pinned ?? []).length > 0 ? <span class="lre-gm-minds-run-pins">Pinned lore: {(e.pinned ?? []).map((p) => `${p.title}${p.left ? " (left out)" : p.cut ? " (cut)" : ""}`).join(", ")}</span> : null}
                    </span>
                  }
                  badge={<Badge tone={STATUS[e.status].tone}>{STATUS[e.status].text}</Badge>}
                />
              ))}
            </List>
            <div class="lre-gm-minds-run-actions">
              {run.status === "running" ? (
                <Button variant="danger" icon="close" onClick={() => void props.minds.cancel()}>
                  Cancel the run
                </Button>
              ) : run.undo && !props.minds.undone ? (
                <Button icon="undo" disabled={props.busy} onClick={() => void props.minds.undo()}>
                  Undo this run
                </Button>
              ) : props.minds.undone ? (
                <span class="lre-gm-minds-run-note">Undone: their minds are as they were.</span>
              ) : null}
            </div>
          </>
        ) : null}
      </Section>
    </div>
  );
}

/** A character's place and the places holding it, nearest first. */
function placesOf(gm: GmView, place: PlaceId | null): PlaceId[] {
  const out: PlaceId[] = [];
  for (let at = place; at !== null && !out.includes(at) && out.length < 16; at = gm.places.find((p) => p.id === at)?.parent ?? null) out.push(at);
  return out;
}

/** What is pinned to a character, then to where they are (DESIGN §24.5), as the chat's world revision has it; edited in Build. */
export function PinnedLore(props: { gm: GmView; chatId: string; who: EntityId; send: Send }) {
  const app = useApp();
  const worldId = useView()?.worldId ?? null;
  const [pins, setPins] = useState<LorePinsView | null>(null);
  useEffect(() => {
    void props.send({ type: "lre.lore", op: "pins", chatId: props.chatId }).then((m) => {
      if (m.type === "lre.result" && m.request === "lre.lore") setPins(m.body.pins ?? { characters: {}, places: {}, steps: {} });
    });
  }, [props.chatId]);
  const own = pins?.characters[props.who] ?? [];
  const place = props.gm.entities.find((e) => e.id === props.who)?.place ?? null;
  const there = placesOf(props.gm, place).flatMap((id) => (pins?.places[id] ?? []).map((p) => ({ ...p, at: props.gm.places.find((x) => x.id === id)?.name ?? id })));
  const row = (p: LorePinView & { at?: string }) => (
    <ListRow
      key={`${p.at ?? ""}:${p.key}`}
      icon="pin"
      title={p.title}
      subtitle={[p.at ? `Pinned to ${p.at}` : "Pinned to them", p.source].join(" · ")}
      badge={p.status === "missing" ? <Badge tone="neg">Missing</Badge> : p.status === "pending" ? <Badge tone="warn">Not reviewed</Badge> : p.status === "off" ? <Badge>Off in its book</Badge> : p.secret ? <Badge tone="gm">Secret</Badge> : undefined}
    />
  );
  return (
    <Section
      title="Pinned lore"
      aside={
        worldId ? (
          <Button size="sm" variant="ghost" icon="hammer" onClick={() => app.ui.update((ui) => ({ ...ui, mode: "build", build: { view: "item", worldId, collection: "entities", id: props.who } }))}>
            Edit in Build
          </Button>
        ) : undefined
      }
      flush
    >
      {pins === null ? (
        <p class="lre-gm-minds-none">Reading the pins…</p>
      ) : own.length + there.length === 0 ? (
        <p class="lre-gm-minds-none">Nothing is pinned to them or to where they are. Pins are the world's: Build → Entities or Places, Pinned lore. Commit, then Upgrade this chat, to use them here.</p>
      ) : (
        <List>{[...own.map((p) => row(p)), ...there.map((p) => row(p))]}</List>
      )}
    </Section>
  );
}
