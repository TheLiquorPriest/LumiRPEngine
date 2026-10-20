// The Encounter (DESIGN §11, §12), on Play → Now while a fight is under way: one card with the
// initiative order and whose turn it is, HP as a meter (the POV's exact; anyone else's as the rules
// and visibility allow, a wound band otherwise), conditions, what the POV has left of each budget,
// End turn, the way to the combat actions (the palette's Combat tab, with their targets and exact
// odds), and this round's acts. The GM view draws the same card with everything shown and no
// actions. The view is the combat pack's, already POV-filtered: an unseen foe reads "someone".

import { isRecord } from "../../../shared/json";
import type { PaletteEntry, PaletteOption } from "../../../shared/state-view";
import { useApp } from "../../../frontend/app";
import { Badge, Button, Empty, JsonView, Meter, Section, useBusy } from "../../../frontend/components";
import { bool, list, num, obj, oneOf, optStr, str, strings } from "../../../frontend/decode";
import { Icon } from "../../../frontend/icons";
import type { PanelProps, Send } from "../../../frontend/registry";
import { paletteRequest } from "../../../frontend/requests";
import type { EncounterRow, EncounterView } from "../core/view";

/** The fight's view model, as the frontend receives it (the GM view's Fight card reads it too). */
export type { EncounterView } from "../core/view";

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

/** How hurt someone is, as far as the view tells: an HP meter, a bare HP figure, or the wound band. */
function Health(props: { row: EncounterRow }) {
  const { hp, wound } = props.row;
  if (hp && hp.max !== null && hp.max > 0) return <Meter label="HP" value={hp.current} max={hp.max} tone={hp.current / hp.max <= 0.25 ? "neg" : "accent"} showValue />;
  if (hp) return <span class="lre-world-hp">HP {hp.current}</span>;
  return wound ? <Badge tone={wound === "badly hurt" ? "warn" : "neutral"}>{wound}</Badge> : null;
}

function Fighter(props: { row: EncounterRow }) {
  const { row } = props;
  // The POV named "You" needs no badge saying so.
  const side = row.you ? (row.name.toLowerCase() === "you" ? null : "You") : row.side === "party" ? "Ally" : "Foe";
  return (
    <div class={row.current ? "lre-world-fighter current" : "lre-world-fighter"} role="listitem" aria-current={row.current ? "true" : undefined} data-lre-fighter={row.id ?? "unseen"}>
      <span class="lre-world-fighter-turn">{row.current ? <Icon name="play" size={16} label="Their turn" /> : row.init !== null ? <span class="lre-world-init" title="Initiative">{row.init}</span> : null}</span>
      <span class="lre-world-fighter-who">
        <span class="lre-world-fighter-name">{row.name}</span>
        <span class="lre-world-badges start">
          {side ? <Badge tone={row.you ? "accent" : "neutral"}>{side}</Badge> : null}
          {row.down ? <Badge tone="neg">down</Badge> : null}
          {row.out ? <Badge>out of the fight</Badge> : null}
          {row.conditions.map((c) => (
            <Badge key={c} tone="warn">
              {c}
            </Badge>
          ))}
        </span>
      </span>
      <span class="lre-world-fighter-hp">
        <Health row={row} />
      </span>
    </div>
  );
}

/** End turn, the turn's way out, sent as the combat pack offers it. */
function EndTurn(props: { entry: PaletteEntry; option: PaletteOption; chatId: string; send: Send }) {
  const [busy, run] = useBusy();
  return (
    <span data-lre-encounter-action={props.entry.action}>
      <Button
        icon="check"
        busy={busy}
        disabled={props.option.disabled !== undefined}
        title={props.option.disabled}
        onClick={() =>
          run(async () => {
            await props.send(paletteRequest(props.entry, [props.option], props.chatId));
          })
        }
      >
        {props.entry.label}
      </Button>
    </span>
  );
}

/** One fight as one card: the order, the POV's budgets and actions (unless it's the GM's), and this round's acts. */
export function EncounterCard(props: { view: EncounterView; chatId?: string; send?: Send }) {
  const app = useApp();
  const { view, chatId, send } = props;
  const turn = view.yours ? "Your turn" : `${view.turn.charAt(0).toUpperCase()}${view.turn.slice(1)}'s turn`;
  // The GM's card shows the fight; acting stays the player's.
  const act = chatId !== undefined && send !== undefined && !view.gm && view.actions.length > 0 ? { chatId, send } : null;
  const end = view.actions.find((entry) => entry.action === "end_turn");
  const endOption = end?.options[0];
  const others = view.actions.filter((entry) => entry.action !== "end_turn");
  const ready = others.flatMap((entry) => entry.options).filter((option) => option.disabled === undefined).length;
  return (
    <div class="lre-world-encounter" data-lre-encounter={view.gm ? "gm" : "player"}>
      <Section title={`Round ${view.round}`} aside={<Badge tone={view.yours ? "accent" : "neutral"}>{turn}</Badge>}>
        <div class="lre-stack">
          <div class="lre-world-fighters" role="list" aria-label="Turn order">
            {view.order.map((row, i) => (
              <Fighter key={`${row.id ?? "unseen"}:${i}`} row={row} />
            ))}
          </div>
          {!view.gm && view.economy.length > 0 ? (
            <div class="lre-world-budgets" role="group" aria-label="You have left">
              <span class="lre-world-sublabel">You have left</span>
              <span class="lre-world-badges start">
                {view.economy.map((b) => (
                  <Badge key={b.id} tone={b.left > 0 ? "pos" : "neutral"}>
                    {b.label} {b.left}/{b.of}
                  </Badge>
                ))}
              </span>
            </div>
          ) : null}
          {act ? (
            <div class="lre-world-moves">
              <span class="lre-world-sublabel">{view.yours ? "Your move" : "Waiting for your turn"}</span>
              <div class="lre-inline">
                {others.length > 0 ? (
                  <span data-lre-encounter-action="combat">
                    <Button variant={view.yours ? "primary" : "secondary"} icon="sword" onClick={() => void app.overlays.openPalette("combat")}>
                      {ready > 0 ? `Combat actions (${ready})` : "Combat actions"}
                    </Button>
                  </span>
                ) : null}
                {end && endOption ? <EndTurn entry={end} option={endOption} chatId={act.chatId} send={act.send} /> : null}
              </div>
              {endOption?.disabled ? <span class="lre-world-sublabel">{endOption.disabled}</span> : null}
            </div>
          ) : null}
          {view.log.length > 0 ? (
            <div class="lre-world-log">
              <span class="lre-world-sublabel">This round</span>
              {view.log.map((line, i) => (
                <p key={`${i}:${line}`}>{line}</p>
              ))}
            </div>
          ) : null}
        </div>
      </Section>
    </div>
  );
}

export function EncounterPanel(props: PanelProps) {
  if (props.view === null || props.view === undefined) return <Empty icon="sword">No fight is under way.</Empty>;
  const view = decodeEncounterView(props.view);
  if (!view) return <JsonView value={props.view} />;
  return <EncounterCard view={view} chatId={props.chatId} send={props.send} />;
}
