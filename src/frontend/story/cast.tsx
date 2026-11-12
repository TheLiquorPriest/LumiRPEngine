// Harness → Cast (DEPTH2-PLAN §1.4, §1.5): everyone in the story, the player's character first, then
// the principals, supporting characters and extras, each with how the author cast them and why.
// Opening someone shows their standing, with the player's pin to set at a standing or lift; for a
// principal (and the player's character while it has a mind), their mind's files to read and edit
// through the workspace, what last reached them and when their mind took it in, and which model and
// effort their agent runs on, with a way to set it for them alone (`story.models.characters`, keyed
// by the story record's name for them). A supporting character's page has their profile. Read with
// `lre.story cast` when the page opens, `reached` when a page opens; the pin answers the cast after.

import { useEffect, useRef, useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import type { CastStanding } from "../../shared/ledger";
import { CAST_STANDINGS } from "../../shared/ledger";
import type { SettingsResult } from "../../shared/protocol";
import type { StoryModels } from "../../shared/settings";
import type { CastRowView, CastView, ReachedItem, ReachedView, StoryNames } from "../../shared/story-pages";
import { useApp } from "../app";
import { Badge, Button, Empty, List, ListRow, Section, Seg, useBusy } from "../components";
import { GmPage, usePages } from "../gm/ui";
import { type AgentConnections, useAgentConnections } from "./connections";
import { FileEditor } from "./editor";
import { fileTitle, MIND_FILE_LABEL, mindEntries, type StoryFile, type StoryFiles, writerWords } from "./files";
import { ModelPickRows, runsOnText } from "./model-pick";
import { agentWords, agoText, castGroups, castLine, characterAsk, nameIn, pickedBy, reachedText, RUN_WORDS, STANDING_WORDS } from "./model";

export function CastPage(props: { chatId: string; files: StoryFiles; open?: string }) {
  const app = useApp();
  const [view, setView] = useState<CastView | null>(null);
  const [failed, setFailed] = useState(false);
  const [settings, setSettings] = useState<SettingsResult | null>(null);
  const connections = useAgentConnections();
  const pages = usePages<string>();
  useEffect(() => {
    let live = true;
    setView(null);
    setFailed(false);
    void app.request({ type: "lre.story", chatId: props.chatId, op: "cast" }).then((answer) => {
      if (!live) return;
      if (answer?.cast) setView(answer.cast);
      else setFailed(true);
    });
    void app.request({ type: "lre.settings.get" }).then((result) => {
      if (live && result) setSettings(result);
    });
    return () => {
      live = false;
    };
  }, [props.chatId]);
  // A link (the record's names) opens someone once the cast is read.
  useEffect(() => {
    if (props.open !== undefined && view !== null) pages.open(props.open);
  }, [props.open, view !== null]);
  if (failed) return <Empty icon="alert">The cast couldn't be read. Open Cast again to retry.</Empty>;
  if (view === null) return <Empty icon="hourglass">Reading the cast…</Empty>;
  const row = pages.page === null ? undefined : view.cast.find((c) => c.entity === pages.page);
  const patch = async (body: JsonObject) => {
    const result = await app.request({ type: "lre.settings.set", patch: body });
    if (result) setSettings(result);
  };
  return (
    <div ref={pages.host.ref} class="lre-gm-pages lre-story-page" data-lre-story-page="cast" onKeyDown={pages.host.onKeyDown}>
      <div class="lre-stack lre-gm-list" hidden={row !== undefined}>
        <p class="lre-story-lead">Who is in the story, how the author cast them and why. Open a principal to read their mind.</p>
        <CastList view={view} onOpen={(entity) => pages.open(entity)} />
      </div>
      {row ? <PersonPage chatId={props.chatId} files={props.files} row={row} names={view.names} models={settings?.settings.story.models ?? null} connections={connections} patch={patch} onCast={setView} onBack={pages.back} /> : null}
    </div>
  );
}

/** The list, without hooks: the player's character, then each standing's group. */
export function CastList(props: { view: CastView; onOpen(entity: string): void }) {
  const { you, groups } = castGroups(props.view.cast);
  const names = props.view.names;
  const row = (c: CastRowView) => <ListRow key={c.entity} id={c.entity === "player" ? undefined : c.entity} row={c.entity} icon={c.entity === "player" ? "user" : c.standing === "principal" ? "sparkle" : c.standing === "supporting" ? "user" : "users"} title={nameIn(names, c.entity)} subtitle={castLine(c)} badge={c.pinned ? <Badge tone="accent">Pinned</Badge> : undefined} chevron onClick={() => props.onOpen(c.entity)} />;
  return (
    <>
      {you ? (
        <Section title="You" flush>
          <List>{row(you)}</List>
        </Section>
      ) : null}
      {groups.length === 0 ? (
        <Empty icon="users" title="No one is cast yet">
          The author casts people as the story meets them. After a turn, everyone it names shows here: a principal with a mind of their own, a supporting character with a profile, an extra the author voices.
        </Empty>
      ) : (
        groups.map((g) => (
          <Section key={g.standing} title={`${STANDING_WORDS[g.standing].plural} (${g.rows.length})`} flush>
            <List>{g.rows.map(row)}</List>
          </Section>
        ))
      )}
    </>
  );
}

/** Someone's page: their standing and the pin, their mind, what last reached them, and what they run on. */
function PersonPage(props: { chatId: string; files: StoryFiles; row: CastRowView; names: StoryNames; models: StoryModels | null; connections: AgentConnections; patch(body: JsonObject): Promise<void>; onCast(view: CastView): void; onBack(): void }) {
  const app = useApp();
  const { row, names } = props;
  const name = nameIn(names, row.entity);
  const you = row.entity === "player";
  const thinks = row.mind !== null && (you || row.standing === "principal");
  const [busy, run] = useBusy();
  const [mind, setMind] = useState<StoryFile[] | null>(null);
  const [reached, setReached] = useState<ReachedView | null>(null);
  const files = usePages<string>();
  const dirty = useRef(false);
  const readMind = async () => {
    if (row.mind === null) return;
    const listed = await props.files.list(props.chatId, row.mind);
    setMind("failed" in listed ? [] : listed);
  };
  useEffect(() => {
    setMind(null);
    setReached(null);
    void readMind();
    if (thinks) void app.request({ type: "lre.story", chatId: props.chatId, op: "reached", entity: row.entity }).then((answer) => setReached(answer?.reached ?? null));
  }, [row.entity, row.mind]);
  const pin = (standing: CastStanding | null) =>
    run(async () => {
      const answer = await app.request({ type: "lre.story", chatId: props.chatId, op: "pin", entity: row.entity, standing });
      if (answer?.cast) props.onCast(answer.cast);
    });
  const leaveFile = async () => {
    if (dirty.current && !(await app.host.confirm("Leave without saving?", "What you typed in this file isn't saved.", "warning", "Leave"))) return;
    dirty.current = false;
    files.back();
  };
  const open = files.page;
  if (open !== null && row.mind !== null) {
    return (
      <div ref={files.host.ref} class="lre-gm-pages" onKeyDown={files.host.onKeyDown}>
        <GmPage name="mind-file" title={fileTitle(open, row.mind)} subtitle={`${name}'s mind`} backLabel={name} onBack={() => void leaveFile()}>
          <FileEditor files={props.files} chatId={props.chatId} path={open} label={`${name}: ${fileTitle(open, row.mind)}`} note={mindNote(open, row.mind)} dirty={(d) => (dirty.current = d)} onSaved={() => void readMind()} />
        </GmPage>
      </div>
    );
  }
  return (
    <div ref={files.host.ref} class="lre-gm-pages" onKeyDown={files.host.onKeyDown}>
      <GmPage name="person" title={name} subtitle={castLine(row)} backLabel="Cast" onBack={props.onBack}>
        {you ? <p class="lre-story-note">Your character. Their place in the story is yours, so the author doesn't cast them.</p> : <StandingSection row={row} busy={busy} pin={pin} />}
        {row.mind !== null ? <MindSection row={row} files={mind} onOpen={(path) => files.open(path)} /> : you ? <p class="lre-story-note">Your character has a mind only while Sovereign Hand is on and Settings → Story → Minds keeps it.</p> : row.standing === "extra" ? <p class="lre-story-note">An extra has no mind or profile: the author voices them when they're needed. Choose Supporting or Principal above to give them one.</p> : null}
        {thinks ? <ReachedSection row={row} reached={reached} names={names} /> : null}
        {thinks ? <RunsOnSection entity={row.entity} name={name} models={props.models} connections={props.connections} patch={props.patch} /> : null}
      </GmPage>
    </div>
  );
}

/** What a mind's file is for, under its editor. */
function mindNote(path: string, folder: string): string | undefined {
  const id = (Object.keys(MIND_FILE_LABEL) as (keyof typeof MIND_FILE_LABEL)[]).find((m) => path === `${folder}${m}.md`);
  return id ? MIND_FILE_LABEL[id].note : undefined;
}

/** The standing, why, and the pin, without hooks. Choosing a standing pins it there; Lift gives it back to the author. */
export function StandingSection(props: { row: CastRowView; busy: boolean; pin(standing: CastStanding | null): void }) {
  const { row } = props;
  return (
    <Section title="Standing">
      <Seg<CastStanding> label="Standing" value={row.standing} disabled={props.busy} options={CAST_STANDINGS.map((s) => ({ value: s, label: STANDING_WORDS[s].label }))} onChange={(standing) => props.pin(standing)} />
      <p class="lre-story-note">{STANDING_WORDS[row.standing].help}</p>
      <p class="lre-story-why">{row.why !== null ? `Why the author cast them so: ${row.why}` : row.pinned ? "You pinned this standing." : "The author hasn't said why."}</p>
      {row.pinned ? (
        <div class="lre-story-actions">
          <Button icon="undo" busy={props.busy} onClick={() => props.pin(null)}>
            Lift the pin
          </Button>
          <span class="lre-story-note">Pinned: the author can't change their standing until you lift it.</span>
        </div>
      ) : (
        <div class="lre-story-actions">
          <Button icon="pin" busy={props.busy} onClick={() => props.pin(row.standing)}>
            {`Pin as ${STANDING_WORDS[row.standing].label.toLowerCase()}`}
          </Button>
          <span class="lre-story-note">Choosing a standing above pins it there. A pin keeps it: the author can't change it.</span>
        </div>
      )}
    </Section>
  );
}

/** A mind's files, each opening to read and edit; one not written yet says so. */
function MindSection(props: { row: CastRowView; files: StoryFile[] | null; onOpen(path: string): void }) {
  const { row } = props;
  const folder = row.mind ?? "";
  const principal = row.entity === "player" || row.standing === "principal";
  if (props.files === null) return <Empty icon="hourglass">Reading their mind…</Empty>;
  const entries = mindEntries(folder, props.files, principal);
  return (
    <Section title={principal ? "Their mind" : "Their profile"} flush>
      <List>
        {entries.map((e) => (
          <ListRow key={e.path} icon="file" title={fileTitle(e.path, folder)} subtitle={e.file === null ? "Not written yet" : `${e.file.chars.toLocaleString("en-US")} characters · written ${agoText(e.file.at)} by ${writerWords(e.file, (agent) => (agent === "character" ? "them" : agentWords(agent, null, {})))}`} chevron onClick={() => props.onOpen(e.path)} />
        ))}
      </List>
    </Section>
  );
}

/** What last reached them, newest first, and when their mind took it in. */
function ReachedSection(props: { row: CastRowView; reached: ReachedView | null; names: StoryNames }) {
  const { row, reached } = props;
  const took = row.digested !== null ? `Their mind took in everything up to ${row.digested.time.text}.` : "Their mind hasn't taken anything in yet.";
  const waiting = row.waiting > 0 ? ` ${row.waiting} ${row.waiting === 1 ? "beat waits" : "beats wait"} for them to take in after the next reply.` : "";
  return (
    <Section title="What last reached them">
      <p class="lre-story-note">{`${took}${waiting}`}</p>
      {reached === null ? (
        <Empty icon="hourglass">Reading what reached them…</Empty>
      ) : reached.items.length === 0 ? (
        <Empty icon="eye">Nothing has reached them yet. Each beat they see, hear or are told of shows here.</Empty>
      ) : (
        <ol class="lre-story-reached">
          {[...reached.items].reverse().map((item) => {
            const t = reachedText(item, props.names);
            return (
              <li key={item.beat} class="lre-story-reached-item" data-lre-reach={item.reach}>
                <div class="lre-story-reached-head">
                  <span>{t.head}</span>
                  <span class="lre-story-when">{item.time.text}</span>
                  {item.digested ? null : <Badge tone="warn">Not taken in yet</Badge>}
                </div>
                <p class="lre-story-text-line">{t.text}</p>
                {t.quotes.map((q) => (
                  <blockquote key={q} class="lre-story-quote">
                    {q}
                  </blockquote>
                ))}
              </li>
            );
          })}
        </ol>
      )}
      {reached !== null && reached.more > 0 ? <p class="lre-story-note">{`${reached.more} older ${reached.more === 1 ? "beat isn't" : "beats aren't"} shown.`}</p> : null}
    </Section>
  );
}

/** What their agent runs on in each kind of run, and their own choice. */
function RunsOnSection(props: { entity: string; name: string; models: StoryModels | null; connections: AgentConnections; patch(body: JsonObject): Promise<void> }) {
  const [busy, run] = useBusy();
  if (props.models === null) return <Empty icon="hourglass">Reading your settings…</Empty>;
  const models = props.models;
  const own = models.characters[props.entity];
  const set = (fields: JsonObject | null) => run(() => props.patch({ story: { models: { characters: { [props.entity]: fields } } } }));
  return (
    <Section title="Runs on">
      <ul class="lre-story-runs">
        {(["scene", "digest"] as const).map((r) => {
          const words = runsOnText(pickedBy(models, characterAsk(props.entity, r)), props.connections);
          return (
            <li key={r}>
              <span class="lre-story-runs-label">{RUN_WORDS[r].label}</span>
              <span>{words.line}</span>
              <span class="lre-story-note">{words.note}</span>
            </li>
          );
        })}
      </ul>
      <p class="lre-story-note">{`For ${props.name} alone: what you set here comes before every other choice in Settings → Story → Models.`}</p>
      <ModelPickRows id={`character-${props.entity}`} owner={props.name} pick={own} fallsTo="the ladder's choice" connections={props.connections} busy={busy} set={set} />
    </Section>
  );
}
