// GM mode → Money (DESIGN §7, §25): anyone's money, a person's, a business's, a
// trust's or a household's, picked under Whose money, as the same hub the player sees at that
// party's own level, with the GM's controls: money in and out, statuses, autopay, card states,
// flows, jobs, prices and every declared field, each one edit with its own Corrected chip. Its pages
// stack over the hub as GM pages, each kept mounted under the one over it.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { FinanceView } from "../../../shared/finance";
import { Disclosure, Empty, HostSelect, JsonView } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import { Icon } from "../../../frontend/icons";
import type { GmSectionProps } from "../../../frontend/registry";
import { decodeFinanceView } from "./decode";
import { MoneyHub, type GmControls } from "./hub";
import { possessive } from "./layout";
import type { HubNav, HubPage } from "./nav";
import { HubPageView, pageLabel } from "./pages";

/**
 * The hub's GM pages as a stack (GM mode's `usePages` holds one page; the hub's go deeper: a
 * section, a thing, an action), with its focus rules: opening a page focuses its Back, Back
 * returns focus to what opened the page, and Escape goes back one.
 */
function usePageStack() {
  const [stack, setStack] = useState<readonly HubPage[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const openers = useRef<(HTMLElement | null)[]>([]);
  const shown = useRef(0);
  useEffect(() => {
    const was = shown.current;
    shown.current = stack.length;
    if (stack.length > was) {
      ref.current?.querySelector<HTMLElement>(`:scope > [data-lre-money-level="${stack.length}"] .lre-page-header button`)?.focus();
      return;
    }
    const back = openers.current.splice(stack.length);
    if (back[0]?.isConnected) back[0].focus();
  }, [stack.length]);
  // Back from a page only while it's the top one, so an answer that comes after Back was tapped doesn't go back twice.
  const backFrom = (level: number) => setStack((s) => (s.length === level ? s.slice(0, -1) : s));
  return {
    stack,
    open: (page: HubPage) => {
      openers.current.push(document.activeElement instanceof HTMLElement ? document.activeElement : null);
      setStack((s) => [...s, page]);
    },
    backFrom,
    ref,
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== "Escape" || stack.length === 0 || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      backFrom(stack.length);
    },
  };
}

/** One party's hub in GM mode: the picker and the hub under it, and the pages opened over them. */
function GmHub(props: { view: FinanceView; controls: GmControls; picker: ComponentChildren; extra: ComponentChildren }) {
  const { view, controls } = props;
  const pages = usePageStack();
  const label = `${possessive(view.name, view.partyKind === "household")} money`;
  const top = pages.stack.length;
  const navAt = (level: number): HubNav => {
    const under = level >= 2 ? pages.stack[level - 2] : undefined;
    return { page: pages.stack[level - 1] ?? null, open: pages.open, back: () => pages.backFrom(level), frame: "gm", backLabel: under ? pageLabel(view, under) : label };
  };
  return (
    <div ref={pages.ref} class="lre-gm-pages lre-money-root" onKeyDown={pages.onKeyDown} data-lre-gm-money>
      <div class="lre-stack lre-gm-list" hidden={top > 0}>
        {props.picker}
        <MoneyHub view={view} label={label} controls={controls} nav={navAt(0)} />
        {props.extra}
      </div>
      {pages.stack.map((page, i) => (
        <div key={`${i}:${page.type}:${page.path.join("/")}`} class="lre-money-level" data-lre-money-level={i + 1} hidden={i !== top - 1}>
          <HubPageView page={page} view={view} controls={controls} nav={navAt(i + 1)} />
        </div>
      ))}
    </div>
  );
}

export function GmMoneySection(props: GmSectionProps) {
  const parties = props.gm.money.map((raw) => ({ raw, view: decodeFinanceView(raw) }));
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  if (parties.length === 0) return <Empty icon="coins">No one's money is tracked.</Empty>;
  const q = query.trim().toLowerCase();
  const shown = parties.filter((p) => q === "" || (p.view?.name ?? "").toLowerCase().includes(q) || (p.view?.party ?? "").toLowerCase().includes(q));
  const current = parties.find((p) => p.view !== null && p.view.party === picked) ?? shown.find((p) => p.view !== null) ?? null;
  const unreadable = parties.filter((p) => p.view === null);
  const picker = (
    <div class="lre-money-whose" data-lre-gm-money-picker>
      {parties.length > 8 ? (
        <label class="lre-gm-search">
          <Icon name="search" size={16} />
          <input class="lre-input" type="search" placeholder="Search" aria-label="Search parties" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
        </label>
      ) : null}
      <HostSelect label="Whose money" value={current?.view?.party ?? ""} options={shown.flatMap((p) => (p.view ? [{ value: p.view.party, label: p.view.name, sublabel: `${humanize(p.view.partyKind)} · Money ${p.view.level}` }] : []))} onChange={setPicked} />
    </div>
  );
  const extra =
    unreadable.length > 0 ? (
      <Disclosure summary={`Money this build can't draw (${unreadable.length})`}>
        {unreadable.map((p, i) => (
          <JsonView key={i} value={p.raw} />
        ))}
      </Disclosure>
    ) : null;
  if (!current?.view) {
    return (
      <div class="lre-money-root" data-lre-gm-money>
        {picker}
        <Empty icon="coins">Nothing to show for that party.</Empty>
        {extra}
      </div>
    );
  }
  return <GmHub key={current.view.party} view={current.view} controls={{ mode: "gm", busy: props.busy, currency: props.currency, edit: props.edit, gm: props.gm }} picker={picker} extra={extra} />;
}
