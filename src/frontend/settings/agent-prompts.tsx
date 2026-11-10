// Settings → Agents → Prompts (DESIGN §6.12): every text LumiRPEngine sends to a model, found by its
// name, its words or its id, with chips for All, Yours and Needs a fix, or browsed: an index of the
// pages, grouped and counted, then a page's texts under their headings, a heading of more than
// `FOLD_OVER` folded. One text's editor is open at a time (the step prompts' editor: its placeholders,
// Compare with shipped, its shipped text and Reset), and a text left unsaved keeps what was written
// while another is open. A text with a placeholder it doesn't have, or without one it must keep, is
// flagged as it is typed and can't be saved; the backend refuses it too. A role's text has Test while
// a chat is open (`lre.prompts test`): the role runs once on that chat's latest exchange with the text
// as written, one model call, and the page says whether its answer kept the role's contract or, in
// words, how it didn't, and what of its task the chat couldn't give (`PromptTestRow`). Another page
// opens a page here, or one of its texts, with `open`. Styles: styles/minds.ts.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { RUNTIME_PROMPT_PAGE } from "../../shared/agent-prompts";
import { ROLE_IDS } from "../../shared/agent-roles";
import type { ChatId } from "../../shared/ids";
import type { JsonObject } from "../../shared/json";
import { hasOwn } from "../../shared/json";
import { MAIN_AGENT_PAGE } from "../../shared/main-agent-prompts";
import type { PromptDef, PromptPage, PromptSettings } from "../../shared/prompts";
import { FINAL_OUTPUT_PAGE, GM_AGENT_PAGE, PROMPT_PAGES, PROMPTS, promptProblems } from "../../shared/prompts";
import type { PromptTestView } from "../../shared/protocol";
import { ROLE_PROMPT_PAGES, rolePageId } from "../../shared/role-prompts";
import { Chip } from "../build/form-kit";
import type { RequestBody } from "../registry";
import { Badge, Button, Disclosure, Empty, List, ListRow, NumberStepper, SearchField, Section } from "../components";
import { revealInScroller } from "../scroll";
import { PromptEditor, PromptHead } from "./prompt-editor";

/** The request a Test press sends: `text`, as written, tested as text `id`'s on `chatId`. */
export function promptTestRequest(chatId: ChatId, id: string, text: string): Extract<RequestBody, { type: "lre.prompts" }> {
  return { type: "lre.prompts", op: "test", chatId, id, text };
}

/** Whether a text has Test: a role's, whose answer keeps a task's contract. */
export function testable(def: PromptDef): boolean {
  return def.contract !== undefined && ROLE_IDS.some((role) => def.page === rolePageId(role));
}

/** A Test's state on the page: under way, or what it found. */
export type PromptTestState = "running" | PromptTestView;

/**
 * A role text's Test: the button, which tests the text as written (`send`, one model call), then
 * what the last press found: that it passed, or each problem in words. Hook-free.
 */
export function PromptTestRow(props: { label: string; text: string; problems: readonly string[]; busy: boolean; state: PromptTestState | undefined; send(text: string): void }) {
  const { state } = props;
  return (
    <div class="lre-minds-body" data-lre-prompt-test={state === undefined ? "none" : state === "running" ? "running" : state.ok ? "passed" : "failed"}>
      <div class="lre-minds-actions">
        <Button size="sm" variant="secondary" icon="play" label={`Test ${props.label} on this chat`} disabled={props.busy || state === "running" || props.problems.length > 0} onClick={() => props.send(props.text)}>
          Test
        </Button>
      </div>
      <p class="lre-minds-note">Runs the role once on this chat's latest exchange with the text as written (one model call) and checks its answer against the role's contract.</p>
      {state === "running" ? <p class="lre-minds-note">Testing…</p> : null}
      {state !== undefined && state !== "running" && state.ok ? <p class="lre-minds-note">Passed: the role's answer kept its contract.</p> : null}
      {state !== undefined && state !== "running" && !state.ok ? (
        <div class="lre-set-warn" role="note">
          <span>
            Failed: {state.problems.map((p) => `${p.charAt(0).toUpperCase()}${p.slice(1)}`).join("; ")}.
          </span>
        </div>
      ) : null}
      {state !== undefined && state !== "running" && state.left.length > 0 ? <p class="lre-minds-note">{`Left out of its task: ${state.left.join("; ")}.`}</p> : null}
    </div>
  );
}

/**
 * The patch saving `text` as the user's own for `def` (null resets it to the shipped text), or null
 * when it can't be saved (`promptProblems`). The shipped text word for word saves none, so it keeps
 * any later update; anything else, an empty text included, is the user's own.
 */
export function promptTextPatch(def: PromptDef, text: string | null, maxChars: number): JsonObject | null {
  if (text === null) return { prompts: { texts: { [def.id]: null } } };
  if (promptProblems(def, text, maxChars).length > 0) return null;
  return { prompts: { texts: { [def.id]: text.trim() === def.text.trim() ? null : text } } };
}

/** A page's texts under their headings, in the registry's order. */
export function promptGroups(page: PromptPage): { title: string; defs: PromptDef[] }[] {
  const out: { title: string; defs: PromptDef[] }[] = [];
  for (const def of PROMPTS) {
    if (def.page !== page.id) continue;
    const title = def.group ?? page.label;
    const group = out.find((g) => g.title === title);
    if (group) group.defs.push(def);
    else out.push({ title, defs: [def] });
  }
  return out;
}

/** How many texts are the user's own, for Settings' home row and the Yours chip. */
export function ownTextCount(prompts: PromptSettings): number {
  return PROMPTS.filter((def) => hasOwn(prompts.texts, def.id)).length;
}

/**
 * What is wrong with the user's own text for `def` as saved, in words (`promptProblems`, against the
 * length limit in force): a placeholder the text no longer has, or more than the limit since it was
 * lowered. None for a text that is the shipped one.
 */
export function savedProblems(def: PromptDef, prompts: PromptSettings): string[] {
  return hasOwn(prompts.texts, def.id) ? promptProblems(def, prompts.texts[def.id], prompts.maxChars).map((p) => p.message) : [];
}

/** How many of the user's own texts need a fix (`savedProblems`), for the Needs a fix chip and Settings' rows. */
export function fixCount(prompts: PromptSettings): number {
  return PROMPTS.filter((def) => savedProblems(def, prompts).length > 0).length;
}

/** Which texts the page lists: every one, the user's own, or the user's own that need a fix. */
export type PromptFilter = "all" | "yours" | "fix";

/** A heading with more texts than this starts folded. */
export const FOLD_OVER = 12;

/** The index's sections of pages, in order; a page none of them names goes in the last, so every page is listed. */
const PAGE_SECTIONS: readonly { title: string; pages: readonly string[] }[] = [
  { title: "The narrator", pages: [FINAL_OUTPUT_PAGE.id] },
  { title: "Agents", pages: [GM_AGENT_PAGE.id, MAIN_AGENT_PAGE.id, RUNTIME_PROMPT_PAGE.id] },
  { title: "Turn roles", pages: ROLE_PROMPT_PAGES.map((p) => p.id) },
];

/** A page of the index: how many texts it has, how many are the user's own, and how many of those need a fix. */
export interface PageEntry {
  page: PromptPage;
  count: number;
  own: number;
  fix: number;
}

/** The index of the pages, in its sections, each page counted. Every page is in it once, so its counts sum to every text, the user's own and those that need a fix. */
export function promptIndex(prompts: PromptSettings): { title: string; pages: PageEntry[] }[] {
  const entries = new Map<string, PageEntry>(PROMPT_PAGES.map((page) => [page.id, { page, count: 0, own: 0, fix: 0 }]));
  for (const def of PROMPTS) {
    const entry = entries.get(def.page);
    if (!entry) continue;
    entry.count++;
    if (hasOwn(prompts.texts, def.id)) entry.own++;
    if (savedProblems(def, prompts).length > 0) entry.fix++;
  }
  const named = new Set(PAGE_SECTIONS.flatMap((s) => s.pages));
  return PAGE_SECTIONS.map((section, i) => ({
    title: section.title,
    pages: PROMPT_PAGES.filter((p) => section.pages.includes(p.id) || (i === PAGE_SECTIONS.length - 1 && !named.has(p.id))).flatMap((p) => entries.get(p.id) ?? []),
  }));
}

/** A text's searchable parts, lower-cased once: its id, its name, where it sits (its heading and page), what it does and its shipped words. */
interface Hay {
  id: string;
  label: string;
  where: string;
  note: string;
  words: string;
}

const PAGE_BY_ID: ReadonlyMap<string, PromptPage> = new Map(PROMPT_PAGES.map((p) => [p.id, p]));

const HAYS: ReadonlyMap<string, Hay> = new Map(
  PROMPTS.map((d) => [d.id, { id: d.id.toLowerCase(), label: d.label.toLowerCase(), where: `${d.group ?? ""} · ${PAGE_BY_ID.get(d.page)?.label ?? ""}`.toLowerCase(), note: d.note.toLowerCase(), words: d.text.toLowerCase() }]),
);

/**
 * How well one term of a query matches a text, 0 for not at all: its id whole, then its name whole,
 * a word of its name starting with the term, its name, its id, its heading or page, what it does,
 * and last its words, the shipped ones or the user's own (`own`, lower-cased).
 */
function termScore(hay: Hay, own: string | undefined, term: string): number {
  if (hay.id === term) return 1000;
  if (hay.label === term) return 500;
  if (hay.label.startsWith(term) || hay.label.includes(` ${term}`)) return 120;
  if (hay.label.includes(term)) return 90;
  if (hay.id.includes(term)) return 80;
  if (hay.where.includes(term)) return 40;
  if (hay.note.includes(term)) return 20;
  return hay.words.includes(term) || (own !== undefined && own.includes(term)) ? 10 : 0;
}

/**
 * The texts the page lists for `query` and `filter`, best first. Every term of the query (its words
 * apart, any case) must be found in a text: its id, its name, its heading or page, what it does, or
 * its words, the shipped ones or the user's own. A text found by its id or name whole comes first,
 * then by its name, its id, where it sits, what it does and last its words; ties keep the registry's
 * order. No query lists every text the filter keeps, in the registry's order.
 */
export function findTexts(query: string, filter: PromptFilter, prompts: PromptSettings): PromptDef[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t !== "");
  const phrase = terms.join(" ");
  const found: { def: PromptDef; score: number; at: number }[] = [];
  for (const [at, def] of PROMPTS.entries()) {
    const own = hasOwn(prompts.texts, def.id) ? prompts.texts[def.id] : undefined;
    if (filter === "yours" && own === undefined) continue;
    if (filter === "fix" && savedProblems(def, prompts).length === 0) continue;
    const hay = HAYS.get(def.id);
    if (!hay) continue;
    const ownWords = own?.toLowerCase();
    let score = 0;
    for (const term of terms) {
      const s = termScore(hay, ownWords, term);
      if (s === 0) {
        score = -1;
        break;
      }
      score += s;
    }
    if (score < 0) continue;
    found.push({ def, score: terms.length > 1 && hay.label.includes(phrase) ? score + 200 : score, at });
  }
  return found.sort((x, y) => y.score - x.score || x.at - y.at).map((f) => f.def);
}

/** Texts found, by the page each is on, the page with the best of them first. */
function byPage(defs: readonly PromptDef[]): { page: PromptPage; defs: PromptDef[] }[] {
  const out = new Map<string, { page: PromptPage; defs: PromptDef[] }>();
  for (const def of defs) {
    const page = PAGE_BY_ID.get(def.page);
    if (!page) continue;
    const entry = out.get(page.id);
    if (entry) entry.defs.push(def);
    else out.set(page.id, { page, defs: [def] });
  }
  return [...out.values()];
}

/** A text as written and not yet saved, over the saved text it was written from (`base`): once that changes (saved, reset), the draft is spent. */
export interface PromptDraft {
  text: string;
  base: string;
}

/** The saved text of `def` (the user's own, else the shipped one), and the text its editor shows: its draft while what the draft was written over still stands, else the saved text. */
function shownText(def: PromptDef, prompts: PromptSettings, drafts: Readonly<Record<string, PromptDraft>>): { saved: string; text: string } {
  const saved = hasOwn(prompts.texts, def.id) ? prompts.texts[def.id] : def.text;
  const draft = hasOwn(drafts, def.id) ? drafts[def.id] : undefined;
  return { saved, text: draft !== undefined && draft.base === saved ? draft.text : saved };
}

/** How many texts a count is, in words. */
function textsWord(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? "text" : "texts"}`;
}

/** A closed text on the page: its heading, which opens its editor (and closes the one open). Hook-free. */
export function PromptRow(props: { id: string; label: string; note: string; own: boolean; fix: boolean; unsaved: boolean; onOpen(): void }) {
  const onOpen = props.onOpen;
  return (
    <div class="lre-minds-prompt" data-lre-minds-prompt={props.id} data-lre-prompt-row>
      <Disclosure
        open={false}
        onToggle={(open) => {
          if (open) onOpen();
        }}
        summary={
          <PromptHead
            label={props.label}
            note={props.note}
            badges={
              <>
                {props.unsaved ? <Badge tone="warn">Not saved</Badge> : null}
                {props.fix ? <Badge tone="warn">Needs a fix</Badge> : props.own ? <Badge tone="accent">Your own</Badge> : null}
              </>
            }
          />
        }
      />
    </div>
  );
}

/** Everything the Prompts page shows, and what each press asks of it: `PromptsView`'s props, which `PromptsPage` holds. */
export interface PromptsViewProps {
  prompts: PromptSettings;
  busy: boolean;
  /** The search as typed. */
  query: string;
  filter: PromptFilter;
  /** The page open, or null for the index. */
  pageId: string | null;
  /** The text whose editor is open, or null. */
  openId: string | null;
  drafts: Readonly<Record<string, PromptDraft>>;
  /** The headings past `FOLD_OVER` opened, by key. */
  unfolded: ReadonlySet<string>;
  tests: Readonly<Record<string, PromptTestState>>;
  /** Whether a role's text has Test: a chat is open. */
  canTest: boolean;
  onQuery(query: string): void;
  onFilter(filter: PromptFilter): void;
  onPage(pageId: string | null): void;
  /** A text's editor opened, or closed. */
  onEditor(id: string, open: boolean): void;
  onDraft(id: string, draft: PromptDraft): void;
  onFold(key: string, open: boolean): void;
  onTest(def: PromptDef, text: string): void;
  patch(patch: JsonObject): void;
}

/** One text: its row, or, while it is the one open, its editor. `where` adds its heading to what it does, where a list mixes headings. */
function textEntry(def: PromptDef, where: boolean, props: PromptsViewProps): ComponentChildren {
  const { prompts, busy } = props;
  const { saved, text } = shownText(def, prompts, props.drafts);
  const note = where && def.group !== undefined ? `${def.group} · ${def.note}` : def.note;
  if (def.id !== props.openId) return <PromptRow key={def.id} id={def.id} label={def.label} note={note} own={hasOwn(prompts.texts, def.id)} fix={savedProblems(def, prompts).length > 0} unsaved={text !== saved} onOpen={() => props.onEditor(def.id, true)} />;
  const problems = (t: string) => promptProblems(def, t).map((p) => p.message);
  return (
    <PromptEditor
      key={def.id}
      id={def.id}
      label={def.label}
      note={note}
      builtIn={def.text}
      value={hasOwn(prompts.texts, def.id) ? prompts.texts[def.id] : undefined}
      max={prompts.maxChars}
      vars={def.vars}
      problems={problems}
      busy={busy}
      save={(t) => promptTextPatch(def, t, prompts.maxChars)}
      patch={props.patch}
      open
      onOpenChange={(open) => props.onEditor(def.id, open)}
      text={text}
      onText={(t) => props.onDraft(def.id, { text: t, base: saved })}
      {...(props.canTest && testable(def) ? { test: (t: string) => <PromptTestRow label={def.label} text={t} problems={problems(t)} busy={busy} state={props.tests[def.id]} send={(sent) => props.onTest(def, sent)} /> } : {})}
    />
  );
}

/**
 * A heading's texts, counted: folded past `FOLD_OVER` until opened, unless it is the only heading
 * shown or holds the text open; then Fold folds it again (closing the text open in it).
 */
function textGroup(group: { key: string; title: string; defs: readonly PromptDef[]; only: boolean; where: boolean }, props: PromptsViewProps): ComponentChildren {
  const { key, defs } = group;
  const foldable = !group.only && defs.length > FOLD_OVER;
  const holdsOpen = defs.some((d) => d.id === props.openId);
  const folded = foldable && !holdsOpen && !props.unfolded.has(key);
  const fold = () => {
    props.onFold(key, false);
    if (props.openId !== null && holdsOpen) props.onEditor(props.openId, false);
  };
  return (
    <div key={key} data-lre-prompt-group={key} data-lre-folded={folded || undefined}>
      <Section
        title={group.title}
        aside={
          <span class="lre-inline">
            {foldable && !folded ? (
              <Button size="sm" variant="ghost" icon="chevron-up" disabled={props.busy} onClick={fold}>
                Fold
              </Button>
            ) : null}
            <Badge>{defs.length.toLocaleString()}</Badge>
          </span>
        }
        flush
      >
        {folded ? (
          <Button variant="ghost" block icon="chevron-down" label={`Show all ${textsWord(defs.length)} of ${group.title}`} onClick={() => props.onFold(key, true)}>
            {`Show all ${textsWord(defs.length)}`}
          </Button>
        ) : (
          <div class="lre-minds-prompts">{defs.map((def) => textEntry(def, group.where, props))}</div>
        )}
      </Section>
    </div>
  );
}

/** What the search and filter found (`found`, best first), by page, or why nothing. */
function foundView(found: readonly PromptDef[], props: PromptsViewProps): ComponentChildren {
  const query = props.query.trim();
  if (found.length === 0) {
    const among = props.filter === "yours" ? " among your own texts" : props.filter === "fix" ? " among the texts that need a fix" : "";
    return (
      <Empty icon="search">
        {query !== "" ? `No text matches “${query}”${among}.` : props.filter === "fix" ? "None of your own texts needs a fix." : "No texts of your own yet: every text is as shipped."}
      </Empty>
    );
  }
  const pages = byPage(found);
  return (
    <>
      <p class="lre-minds-note" aria-hidden="true" data-lre-prompts-found={found.length}>
        {`${textsWord(found.length)} found, on ${pages.length === 1 ? "1 page" : `${pages.length} pages`}.`}
      </p>
      {pages.map((p) => textGroup({ key: `found/${p.page.id}`, title: p.page.label, defs: p.defs, only: pages.length === 1, where: true }, props))}
    </>
  );
}

/** One page: back to the index, what the page holds, then its texts under their headings. */
function pageView(page: PromptPage, props: PromptsViewProps): ComponentChildren {
  const groups = promptGroups(page);
  const count = groups.reduce((n, g) => n + g.defs.length, 0);
  const own = groups.reduce((n, g) => n + g.defs.filter((d) => hasOwn(props.prompts.texts, d.id)).length, 0);
  return (
    <>
      <div class="lre-stack" data-lre-prompt-page={page.id}>
        <div class="lre-inline">
          <Button size="sm" variant="ghost" icon="chevron-left" label="Back to all pages" onClick={() => props.onPage(null)}>
            All pages
          </Button>
        </div>
        <h3 class="lre-h2">{page.label}</h3>
        <p class="lre-minds-note">{`${textsWord(count)}${own > 0 ? `, ${own.toLocaleString()} your own` : ""}. ${page.note}`}</p>
      </div>
      {groups.map((g) => textGroup({ key: `${page.id}/${g.title}`, title: g.title, defs: g.defs, only: groups.length === 1, where: false }, props))}
    </>
  );
}

/** The index: the pages in their sections, each with its count, then the limit on a text of the user's own. */
function indexView(props: PromptsViewProps): ComponentChildren {
  const { prompts, busy } = props;
  return (
    <>
      {promptIndex(prompts).map((section) => (
        <Section key={section.title} title={section.title} flush>
          <List>
            {section.pages.map((e) => (
              <ListRow
                key={e.page.id}
                row={e.page.id}
                title={e.page.label}
                subtitle={`${textsWord(e.count)}${e.own > 0 ? `, ${e.own.toLocaleString()} your own` : ""}`}
                badge={e.fix > 0 ? <Badge tone="warn">{`${e.fix.toLocaleString()} to fix`}</Badge> : undefined}
                chevron
                onClick={() => props.onPage(e.page.id)}
              />
            ))}
          </List>
        </Section>
      ))}
      <Section title="Limits">
        <div class="lre-minds-body">
          <NumberStepper label="Longest text of your own (characters)" value={prompts.maxChars} min={1} step={1000} integer disabled={busy} onChange={(maxChars) => props.patch({ prompts: { maxChars } })} />
          <p class="lre-minds-note">A text you save may be at most this long. Lowering it leaves a longer text you already saved as it is, until you edit it; Needs a fix lists it.</p>
        </div>
      </Section>
    </>
  );
}

/**
 * The Prompts page as its state stands (`PromptsPage` holds it): the search and its chips, then what
 * they found, the page open, or the index. Hook-free.
 */
export function PromptsView(props: PromptsViewProps) {
  const own = ownTextCount(props.prompts);
  const fix = fixCount(props.prompts);
  const searching = props.query.trim() !== "" || props.filter !== "all";
  const found = searching ? findTexts(props.query, props.filter, props.prompts) : [];
  const page = searching || props.pageId === null ? undefined : PAGE_BY_ID.get(props.pageId);
  const pick = (filter: PromptFilter) => props.onFilter(props.filter === filter ? "all" : filter);
  return (
    <div class="lre-stack" data-lre-prompts-view={searching ? "found" : page ? "page" : "index"}>
      {searching || page ? null : <p class="lre-set-lead">Every text LumiRPEngine sends to a model, as shipped until you write your own. Yours is sent from the next turn; Reset brings back the shipped text. A Re-narrate is sent the texts its turn was made with unless Settings → Swipes says otherwise.</p>}
      <SearchField value={props.query} label="Find a text" placeholder="By name, words or id" status={searching ? `${textsWord(found.length)} found` : undefined} onInput={props.onQuery} />
      <div class="lre-form-chips" role="group" aria-label="Which texts">
        <Chip pressed={props.filter === "all"} onToggle={() => props.onFilter("all")}>
          All
        </Chip>
        <Chip pressed={props.filter === "yours"} disabled={own === 0 && props.filter !== "yours"} onToggle={() => pick("yours")}>
          {`Yours (${own.toLocaleString()})`}
        </Chip>
        <Chip pressed={props.filter === "fix"} tone={fix > 0 ? "warn" : undefined} disabled={fix === 0 && props.filter !== "fix"} onToggle={() => pick("fix")}>
          {`Needs a fix (${fix.toLocaleString()})`}
        </Chip>
      </div>
      {searching ? foundView(found, props) : page ? pageView(page, props) : indexView(props)}
    </div>
  );
}

/** Where a link's `open` points: its page when the registry has it, and its text when that page holds it. */
export function openTarget(open: { page: string; text?: string } | undefined): { pageId: string | null; openId: string | null } {
  if (!open || !PAGE_BY_ID.has(open.page)) return { pageId: null, openId: null };
  const text = open.text;
  return { pageId: open.page, openId: text !== undefined && PROMPTS.some((d) => d.id === text && d.page === open.page) ? text : null };
}

/**
 * Settings → Agents → Prompts. `test`: a role text's Test on the open chat, the press's answer, or
 * null when it failed (the request says why); absent while no chat is open. `open`: a page to show
 * (a `PROMPT_PAGES` id) and a text of it to open, as another page links here; each time it changes,
 * the page shows it, the search cleared. Escape clears the search, else leaves a page for the index.
 */
export function PromptsPage(props: { prompts: PromptSettings; patch(patch: JsonObject): void; busy: boolean; test?(def: PromptDef, text: string): Promise<PromptTestView | null>; open?: { page: string; text?: string } }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PromptFilter>("all");
  const [pageId, setPageId] = useState<string | null>(() => openTarget(props.open).pageId);
  const [openId, setOpenId] = useState<string | null>(() => openTarget(props.open).openId);
  const [drafts, setDrafts] = useState<Readonly<Record<string, PromptDraft>>>({});
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
  const [tests, setTests] = useState<Readonly<Record<string, PromptTestState>>>({});
  const root = useRef<HTMLDivElement>(null);
  // The page last left for the index, whose row gets focus back; and whether the text opened came by a link, so it is brought to the top.
  const left = useRef<string | null>(null);
  const linked = useRef(openTarget(props.open).openId !== null);
  const openPage = props.open?.page;
  const openText = props.open?.text;
  useEffect(() => {
    if (openPage === undefined) return;
    const target = openTarget({ page: openPage, ...(openText !== undefined ? { text: openText } : {}) });
    setQuery("");
    setFilter("all");
    setPageId(target.pageId);
    setOpenId(target.openId);
    linked.current = target.openId !== null;
  }, [openPage, openText]);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (pageId !== null) {
      const back = el.querySelector<HTMLElement>("[data-lre-prompt-page] button");
      back?.focus({ preventScroll: true });
      revealInScroller(back?.closest("[data-lre-prompt-page]") ?? null, "start");
    } else if (left.current !== null) {
      const row = el.querySelector<HTMLElement>(`[data-lre-row="${left.current}"] button`);
      row?.focus({ preventScroll: true });
      revealInScroller(row ?? null, "nearest");
      left.current = null;
    }
  }, [pageId]);
  useEffect(() => {
    if (openId === null) return;
    const block = linked.current ? "start" : "nearest";
    linked.current = false;
    // After the settings page has put focus on its own header, as it does when it opens.
    const timer = setTimeout(() => {
      const head = root.current?.querySelector<HTMLElement>(`[data-lre-minds-prompt="${openId}"] > .lre-disclosure > summary`) ?? null;
      head?.focus({ preventScroll: true });
      revealInScroller(head, block);
    }, 0);
    return () => clearTimeout(timer);
  }, [openId]);
  const run = async (def: PromptDef, text: string): Promise<void> => {
    if (!props.test) return;
    setTests((now) => ({ ...now, [def.id]: "running" }));
    const found = await props.test(def, text);
    setTests((now) => {
      const { [def.id]: _was, ...rest } = now;
      return found ? { ...rest, [def.id]: found } : rest;
    });
  };
  return (
    <div
      ref={root}
      class="lre-stack lre-minds-set"
      data-lre-settings-page="prompts"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        if (query !== "" || filter !== "all") {
          event.preventDefault();
          setQuery("");
          setFilter("all");
        } else if (pageId !== null) {
          event.preventDefault();
          left.current = pageId;
          setPageId(null);
        }
      }}
    >
      <PromptsView
        prompts={props.prompts}
        busy={props.busy}
        query={query}
        filter={filter}
        pageId={pageId}
        openId={openId}
        drafts={drafts}
        unfolded={unfolded}
        tests={tests}
        canTest={props.test !== undefined}
        onQuery={setQuery}
        onFilter={setFilter}
        onPage={(next) => {
          if (next === null) left.current = pageId;
          setPageId(next);
        }}
        onEditor={(id, open) => setOpenId((now) => (open ? id : now === id ? null : now))}
        onDraft={(id, draft) => setDrafts((now) => ({ ...now, [id]: draft }))}
        onFold={(key, open) =>
          setUnfolded((now) => {
            const next = new Set(now);
            if (open) next.add(key);
            else next.delete(key);
            return next;
          })
        }
        onTest={(def, text) => void run(def, text)}
        patch={props.patch}
      />
    </div>
  );
}
