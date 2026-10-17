// Play → Encounter (DESIGN §11, §12), shown while a fight is under way: the initiative order with
// whose turn it is, HP bars (the POV's exact; anyone else's as the rules and visibility allow, a
// wound band otherwise), conditions, the POV's economy, its attacks with their targets and exact
// odds, End turn, and this round's acts. The GM view draws the same card with everything shown and
// no actions. The view is the combat pack's, already POV-filtered: an unseen foe reads "someone".

import { isRecord } from "../../../shared/json";
import type { PaletteEntry, PaletteOption } from "../../../shared/state-view";
import { Card, Empty, JsonView, OddsBar, useBusy } from "../../../frontend/components";
import { bool, list, num, obj, oneOf, optStr, str, strings } from "../../../frontend/decode";
import { formatMinutes } from "../../../frontend/format";
import type { PanelProps, Send } from "../../../frontend/registry";
import { paletteRequest } from "../../../frontend/requests";
import type { EncounterRow, EncounterView } from "../core/view";

const SIDES = ["party", "foes"] as const;

function decodeOption(o: Record<string, unknown>): PaletteOption | null {
  const params = obj(o.params);
  if (!params || typeof o.label !== "string") return null;
  const odds = list(o.odds, (x) => (typeof x.outcome === "string" ? { outcome: x.outcome, p: num(x.p) } : null));
  const detail = optStr(o.detail);
  const disabled = optStr(o.disabled);
  const minutes = typeof o.minutes === "number" ? o.minutes : undefined;
  // Params are JSON the backend sent; they go back unchanged.
  return { label: o.label, params: params as PaletteOption["params"], ...(odds.length > 0 ? { odds } : {}), ...(detail ? { detail } : {}), ...(disabled ? { disabled } : {}), ...(minutes !== undefined ? { minutes } : {}) };
}

/** The Encounter card's view model from JSON; null when it isn't one. */
export function decodeEncounterView(value: unknown): EncounterView | null {
  if (!isRecord(value) || !Array.isArray(value.order) || typeof value.round !== "number") return null;
  return {
    gm: bool(value.gm),
    round: value.round,
    turn: str(value.turn),
    yours: bool(value.yours),
    order: list(value.order, (r): EncounterRow => {
      const hp = obj(r.hp);
      return {
        id: typeof r.id === "string" ? r.id : null,
        name: str(r.name, "someone"),
        side: oneOf(r.side, SIDES, "foes"),
        you: bool(r.you),
        current: bool(r.current),
        down: bool(r.down),
        out: bool(r.out),
        init: typeof r.init === "number" ? r.init : null,
        hp: hp ? { current: num(hp.current), max: typeof hp.max === "number" ? hp.max : null } : null,
        wound: optStr(r.wound) ?? null,
        conditions: strings(r.conditions),
      };
    }),
    economy: list(value.economy, (b) => (typeof b.id === "string" ? { id: b.id, label: str(b.label, b.id), left: num(b.left), of: num(b.of) } : null)),
    actions: list(value.actions, (e): PaletteEntry | null => (typeof e.action === "string" ? { action: e.action, label: str(e.label, e.action), group: "combat", options: list(e.options, decodeOption) } : null)),
    log: strings(value.log),
  };
}

function HpBar(props: { row: EncounterRow }) {
  const { hp, wound, name } = props.row;
  if (hp && hp.max !== null && hp.max > 0) {
    const fill = Math.max(0, Math.min(100, (hp.current / hp.max) * 100));
    return (
      <div class="lre-stack" style={{ gap: "2px", minWidth: "96px" }}>
        <span class="lre-small lre-num">
          {hp.current} / {hp.max}
        </span>
        <div class={fill <= 25 ? "lre-bar low" : "lre-bar"} role="meter" aria-label={`${name}: ${hp.current} of ${hp.max}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fill)}>
          <span style={{ width: `${fill}%` }} />
        </div>
      </div>
    );
  }
  if (hp) return <span class="lre-small lre-num">{hp.current}</span>;
  return wound ? <span class={wound === "badly hurt" ? "lre-badge warn" : "lre-badge"}>{wound}</span> : null;
}

function OrderRow(props: { row: EncounterRow }) {
  const { row } = props;
  return (
    <div class="lre-row" aria-current={row.current ? "true" : undefined} data-lre-fighter={row.id ?? "unseen"} style={row.current ? { background: "color-mix(in srgb, var(--lre-accent) 12%, transparent)", borderRadius: "var(--lre-radius)", padding: "8px 6px" } : undefined}>
      <span class="k lre-inline" style={{ gap: "6px", flexWrap: "wrap" }}>
        <span aria-hidden="true" style={{ width: "1em" }}>
          {row.current ? "▶" : ""}
        </span>
        <strong>{row.name}</strong>
        <span class={row.side === "party" ? "lre-badge pos" : "lre-badge neg"}>{row.you ? "you" : row.side === "party" ? "ally" : "foe"}</span>
        {row.init !== null ? <span class="lre-small lre-muted">init {row.init}</span> : null}
        {row.down ? <span class="lre-badge neg">down</span> : null}
        {row.out ? <span class="lre-badge">out of the fight</span> : null}
        {row.conditions.map((c) => (
          <span key={c} class="lre-badge warn">
            {c}
          </span>
        ))}
      </span>
      <span class="v">
        <HpBar row={row} />
      </span>
    </div>
  );
}

function ActionOption(props: { entry: PaletteEntry; option: PaletteOption; chatId: string; send: Send }) {
  const { entry, option } = props;
  const [busy, run] = useBusy();
  const label = entry.options.length === 1 && option.label === entry.label ? entry.label : `${entry.label} → ${option.label}`;
  return (
    <button
      type="button"
      class="lre-item"
      disabled={option.disabled !== undefined || busy}
      title={option.disabled}
      data-lre-encounter-action={entry.action}
      onClick={() =>
        run(async () => {
          await props.send(paletteRequest(entry, [option], props.chatId));
        })
      }
    >
      <span class="grow">
        <span class="title">{label}</span>
        <span class="sub">{[option.detail, option.minutes !== undefined ? formatMinutes(option.minutes) : null, option.disabled].filter((part) => part).join(" · ")}</span>
        {option.odds && option.odds.length > 0 ? <OddsBar odds={option.odds} /> : null}
      </span>
    </button>
  );
}

/** One fight as a card: the order, the POV's economy and actions (unless it's the GM's), and this round's acts. */
export function EncounterCard(props: { view: EncounterView; chatId?: string; send?: Send }) {
  const { view, chatId, send } = props;
  const turn = view.yours ? "Your turn" : `${view.turn.charAt(0).toUpperCase()}${view.turn.slice(1)}'s turn`;
  // The GM's card shows the fight; acting stays the player's.
  const act = chatId !== undefined && send !== undefined && !view.gm && view.actions.length > 0 ? { chatId, send } : null;
  return (
    <div class="lre-stack" data-lre-encounter={view.gm ? "gm" : "player"}>
      <Card title={`Round ${view.round}`} aside={<span class={view.yours ? "lre-badge accent" : "lre-badge"}>{turn}</span>}>
        {view.order.map((row, i) => (
          <OrderRow key={`${row.id ?? "unseen"}:${i}`} row={row} />
        ))}
      </Card>
      {!view.gm && view.economy.length > 0 ? (
        <Card title="You have left">
          <div class="lre-inline" style={{ flexWrap: "wrap", gap: "6px" }}>
            {view.economy.map((b) => (
              <span key={b.id} class={b.left > 0 ? "lre-badge pos" : "lre-badge"}>
                {b.label} {b.left}/{b.of}
              </span>
            ))}
          </div>
        </Card>
      ) : null}
      {act ? (
        <Card title={view.yours ? "Your move" : "Waiting for your turn"}>
          <div class="lre-list">
            {/* What can be done now first; End turn last, as the turn's way out. */}
            {view.actions
              .flatMap((entry) => entry.options.map((option) => ({ entry, option })))
              .sort((a, b) => Number(a.entry.action === "end_turn") - Number(b.entry.action === "end_turn") || Number(a.option.disabled !== undefined) - Number(b.option.disabled !== undefined))
              .map(({ entry, option }) => <ActionOption key={`${entry.action}:${JSON.stringify(option.params)}`} entry={entry} option={option} chatId={act.chatId} send={act.send} />)}
          </div>
        </Card>
      ) : null}
      {view.log.length > 0 ? (
        <Card title="This round">
          {view.log.map((line, i) => (
            <div key={`${i}:${line}`} class="lre-small">
              {line}
            </div>
          ))}
        </Card>
      ) : null}
    </div>
  );
}

export function EncounterPanel(props: PanelProps) {
  if (props.view === null || props.view === undefined) return <Empty>No fight is under way.</Empty>;
  const view = decodeEncounterView(props.view);
  if (!view) return <JsonView value={props.view} />;
  return <EncounterCard view={view} chatId={props.chatId} send={props.send} />;
}
