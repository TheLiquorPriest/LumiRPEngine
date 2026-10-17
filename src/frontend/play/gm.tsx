// Play → GM view (DESIGN §7, §9.2): everything, including secrets, as labelled previews from the
// seed that record nothing. Behind a spoiler gate so a glance at Play never reveals a secret.

import { useState } from "preact/hooks";
import { isRecord } from "../../shared/json";
import { Card, Empty, JsonView, Row } from "../components";
import { list, str, strings } from "../decode";
import type { PanelProps } from "../registry";
import type { GmView } from "../../shared/state-view";

export function decodeGmView(value: unknown): GmView | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.previews) && !Array.isArray(value.truths) && !Array.isArray(value.agendas)) return null;
  return {
    label: str(value.label, "Previews — not recorded"),
    previews: list(value.previews, (p) => ({ title: str(p.title, "Preview"), lines: strings(p.lines) })),
    truths: list(value.truths, (t) => ({ track: str(t.track), stage: str(t.stage), truth: str(t.truth) })),
    agendas: list(value.agendas, (a) => ({ entity: str(a.entity), label: str(a.label), stage: str(a.stage) })),
  };
}

export function GmPanel(props: PanelProps) {
  const [revealed, setRevealed] = useState(false);
  if (!revealed) {
    return (
      <div class="lre-stack" data-lre-panel="core.gm">
        <div class="lre-banner warn">
          <strong>Spoilers ahead</strong>
          <span>The GM view shows secrets, hidden agendas and unrevealed truths as previews. Nothing here is recorded or shown to the narrator.</span>
          <button type="button" class="lre-btn" onClick={() => setRevealed(true)}>
            Show GM view
          </button>
        </div>
      </div>
    );
  }
  const view = decodeGmView(props.view);
  return (
    <div class="lre-stack" data-lre-panel="core.gm">
      <div class="lre-spread">
        <span class="lre-preview-label">{view?.label ?? "Previews — not recorded"}</span>
        <button type="button" class="lre-btn small" onClick={() => setRevealed(false)}>
          Hide
        </button>
      </div>
      {props.view === undefined || props.view === null ? (
        <Empty>No GM view for this world.</Empty>
      ) : !view ? (
        <Card preview>
          <JsonView value={props.view} />
        </Card>
      ) : (
        <>
          {view.truths.length > 0 ? (
            <Card title="Secret truths" preview>
              {view.truths.map((t) => (
                <Row key={`${t.track}:${t.stage}`} k={t.truth} sub={`${t.track} · ${t.stage}`} />
              ))}
            </Card>
          ) : null}
          {view.agendas.length > 0 ? (
            <Card title="Agendas" preview>
              {view.agendas.map((a) => (
                <Row key={`${a.entity}:${a.label}`} k={a.entity} sub={a.label} v={a.stage} />
              ))}
            </Card>
          ) : null}
          {view.previews.map((p) => (
            <Card key={p.title} title={p.title} preview>
              {p.lines.map((line, i) => (
                <div key={i} class="lre-row">
                  <span class="k">{line}</span>
                </div>
              ))}
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
