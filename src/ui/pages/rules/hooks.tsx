// The Rules page's hooks (plan §5.4 "Hooks", §16, R-46): each hook of each level's hooks file, the moment it runs at, its command and timeout, whether RPH
// runs it and why not (switched off in an `off:` list, replaced by a nearer file's hook of its name, waiting for the server's `rpe allow`), its file's text
// edited and saved as his at a level, and the hook switched off and on in its `off:` list. Only the server's command line switches a command on; no page can.

import { useState } from "preact/hooks";
import type { HookEvent, LayerLevel, TreeFileRow, TreeHook } from "../../../shared/api";
import { useApp } from "../../app";
import { Badge, Banner, Button, Pre, Section, type Tone } from "../../atoms";
import type { RpeClient } from "../../client";
import { useRead } from "../../reading";
import { useUiSetting } from "../../ui-settings";
import { errorWords, LEVEL_WORDS } from "../../words";
import { filesCalls, type WriteLevel, writeLevels } from "../files/model";

/** The view of the hooks, in a rule address: `rules/~hooks/<level>/<name>`. */
export const HOOKS = "~hooks";

/** A hook with the hooks file that names it. */
export interface HookRow {
  hook: TreeHook;
  file: TreeFileRow;
}

export const HOOK_WORDS: Readonly<Record<HookEvent, string>> = {
  "turn-start": "a turn's start",
  "before-tool": "before a tool call; it may block the call",
  "after-tool": "after a tool call",
  "before-release": "before a reply is released; it may block it",
  "after-release": "after a reply is released",
  "run-end": "a run's end",
  "session-close": "a session's close",
  "before-compaction": "before a compaction",
  "job-start": "a job's start; it may refuse the job",
  "job-end": "a job's end",
};

/** A hook's place in the page's address. */
export function hookAddress(row: HookRow): string[] {
  return [HOOKS, row.file.level, row.hook.name];
}

/** The row an address `[~hooks, level, name]` names, if there is one. */
export function hookAt(rows: readonly HookRow[], at: readonly string[]): HookRow | null {
  return rows.find((r) => r.file.level === at[1] && r.hook.name === at[2]) ?? null;
}

/** Whether RPH runs the hook and, if not, why, in words; the line to run on the server where it waits. */
export function hookStanding(row: HookRow): { inForce: boolean; words: string; tone: Tone | undefined } {
  const { hook } = row;
  if (hook.off) return { inForce: false, words: `switched off in the off: list of ${hook.offIn.map((l) => LEVEL_WORDS[l].toLowerCase()).join(", ")}`, tone: "warn" };
  if (hook.replacedBy !== null) return { inForce: false, words: `replaced by the hook of its name in ${hook.replacedBy}`, tone: undefined };
  if (hook.state === "waiting") return { inForce: false, words: `waiting for the server's command line: rpe allow ${hook.name}`, tone: "warn" };
  if (hook.state === "off") return { inForce: false, words: `its command is switched off on the server: rpe allow ${hook.name} switches it on`, tone: "warn" };
  if (hook.state === "on" && hook.applies) return { inForce: true, words: "in force", tone: "pos" };
  if (hook.state === undefined) return { inForce: false, words: "RPH does not list it: see what it found wrong with the file", tone: "neg" };
  return { inForce: false, words: "not in force", tone: undefined };
}

/** The hook rows in the order the list shows them: in force first, then the rest, each by name and level. */
export function sortedHooks(rows: readonly HookRow[]): HookRow[] {
  return [...rows].sort((a, b) => Number(hookStanding(b).inForce) - Number(hookStanding(a).inForce) || a.hook.name.localeCompare(b.hook.name) || a.file.level.localeCompare(b.file.level));
}

/** The timeout, in seconds, a hook's own entry in its file gives; null where the entry names none. */
export function timeoutOf(text: string, name: string): number | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const indentOf = (line: string): number => line.length - line.trimStart().length;
  const named = (line: string): boolean => {
    const found = /^\s*(?:-\s+)?name:\s*(.*?)\s*(?:#.*)?$/.exec(line);
    const value = found?.[1]?.replace(/^(["'])(.*)\1$/, "$2");
    return value === name;
  };
  const at = lines.findIndex(named);
  if (at < 0) return null;
  let start = at;
  while (start > 0 && !/^\s*-(\s|$)/.test(lines[start] as string)) start--;
  const dash = indentOf(lines[start] as string);
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end] as string;
    if (line.trim() !== "" && !line.trim().startsWith("#") && indentOf(line) <= dash) break;
    end++;
  }
  for (const line of lines.slice(start, end)) {
    const found = /^\s*(?:-\s+)?timeout:\s*(\d+)\s*(?:#.*)?$/.exec(line);
    if (found !== null) return Number(found[1]);
  }
  return null;
}

/** Every hook of every level's hooks file as the chat's tree lists them, and the hooks files RPH found something wrong with (one that will not parse names no hook), the pages of the search read one after another to its end. */
async function readHooks(client: Pick<RpeClient, "call">, chat: string | null, limit: number): Promise<{ rows: HookRow[]; broken: TreeFileRow[]; stopped: boolean }> {
  const files = filesCalls(client, chat);
  const rows: HookRow[] = [];
  const broken: TreeFileRow[] = [];
  let after: string | undefined;
  let stopped = false;
  for (;;) {
    const page = await files.folder("", "hooks.yml", after, limit);
    for (const item of page.items) {
      if (item.entry?.hooks === undefined) continue;
      for (const hook of item.entry.hooks) rows.push({ hook, file: item.entry });
      if ((item.entry.problems ?? []).length > 0) broken.push(item.entry);
    }
    if (page.stopped !== null) stopped = true;
    if (page.next === null || page.next === after) return { rows, broken, stopped };
    after = page.next;
  }
}

/** The hooks of the chat open (or the shipped and global levels with none), read again when `again` changes. */
export function useHooks(chat: string | null, again: number) {
  const app = useApp();
  const limit = useUiSetting("rowsAtOnce");
  return useRead(() => readHooks(app.client, chat, limit), [chat, again]);
}

export function HooksList(props: { rows: readonly HookRow[]; broken: readonly TreeFileRow[]; loading: boolean; problem: string | null; stopped: boolean; open: HookRow | null; onOpen(row: HookRow): void }) {
  const rows = sortedHooks(props.rows);
  return (
    <Section id="hooks" title="Hooks">
      <p class="rpe-meta">A hook is a command of his that runs at a moment of a turn. The server's command line switches a hook's command on; no page can.</p>
      {props.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The hooks could not be read">
          <span>{props.problem}</span>
        </Banner>
      )}
      {props.broken.map((file) => (
        <Banner key={file.path} tone="warn" icon="alert" title={`What RPH found wrong with ${file.path} (${LEVEL_WORDS[file.level]})`}>
          <ul class="rpe-plain" data-hooks-file-problems={file.path}>
            {(file.problems ?? []).map((p, i) => (
              <li key={i} class="rpe-line">
                {p}
              </li>
            ))}
          </ul>
        </Banner>
      ))}
      {rows.length === 0 && !props.loading && props.problem === null && props.broken.length === 0 ? <p class="lre-muted rpe-line" data-hooks-none>No hooks file names a hook.</p> : null}
      {props.loading && props.rows.length === 0 ? <p class="lre-muted rpe-line">Reading the hooks…</p> : null}
      <ul class="lre-list" data-hooks>
        {rows.map((row) => {
          const standing = hookStanding(row);
          const open = props.open !== null && props.open.hook === row.hook;
          return (
            <li key={`${row.file.path}:${row.hook.name}`} class="lre-listrow">
              <button type="button" class="lre-listrow-hit" onClick={() => props.onOpen(row)} data-hook-line={row.hook.name} aria-current={open ? "page" : undefined}>
                <span class="lre-listrow-content">
                  <span class="lre-listrow-text">
                    <span class="lre-listrow-title">{row.hook.name}</span>
                    <span class="lre-listrow-sub">
                      {HOOK_WORDS[row.hook.on]}
                      {standing.inForce ? "" : ` · ${standing.words}`}
                    </span>
                  </span>
                  <span class="lre-inline">
                    <Badge>{LEVEL_WORDS[row.file.level]}</Badge>
                    <Badge tone={standing.inForce ? "pos" : "warn"}>{standing.inForce ? "in force" : row.hook.state === "waiting" ? "waiting" : "not in force"}</Badge>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {props.stopped ? <p class="rpe-meta">The search for hooks files ran out of its time before it had looked everywhere; some hooks may be missing.</p> : null}
    </Section>
  );
}

export function HookOpen(props: { chat: string | null; row: HookRow; onChanged(): void; onFile(path: string): void }) {
  const app = useApp();
  const { chat, row } = props;
  const { hook, file } = row;
  const files = filesCalls(app.client, chat);
  const piece = useUiSetting("filePieceBytes");
  const text = useRead(() => files.read(file.path, 0, piece), [file.path, chat]);
  const [draft, setDraft] = useState<string | null>(null);
  const [level, setLevel] = useState<WriteLevel>(chat === null ? "global" : "chat");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const levels = writeLevels(chat);
  const shown = draft ?? text.value?.text ?? "";
  const whole = text.value !== null && text.value.more !== true;
  const standing = hookStanding(row);
  const timeout = text.value === null ? null : timeoutOf(text.value.text, hook.name);
  const press = (what: string, go: () => Promise<void>): void => {
    if (busy !== null) return;
    setBusy(what);
    setProblem(null);
    go().then(
      () => setBusy(null),
      (error: unknown) => {
        setBusy(null);
        setProblem(errorWords(error));
      },
    );
  };
  const save = (): void =>
    press("save", async () => {
      await files.save(file.path, level, shown);
      setDraft(null);
      setSaid(`Saved as yours, ${level === "global" ? "for every chat" : level === "chat" ? "for this chat" : "for this character"}; the list now shows what is in force.`);
      text.again();
      props.onChanged();
    });
  const switchTo = (off: boolean, at: "chat" | "global"): void =>
    press("switch", async () => {
      await app.client.call("PUT /api/v1/files-off/*", { "*": file.path }, { body: { level: at, off, hook: hook.name, ...(chat === null ? {} : { chat }) } });
      setSaid(`${hook.name} is ${off ? "switched off" : "taken out of the off: list"} ${at === "global" ? "for every chat" : "for this chat"}.`);
      props.onChanged();
    });
  const onAt = hook.offIn.filter((l): l is "chat" | "global" => l === "chat" || l === "global");
  return (
    <div class="lre-stack" data-hook={hook.name}>
      <p class="rpe-line">
        <Badge tone={standing.inForce ? "pos" : "warn"}>{standing.inForce ? "in force" : "not in force"}</Badge> <Badge>{LEVEL_WORDS[file.level]}</Badge> {standing.inForce ? "" : standing.words}
      </p>
      <p class="rpe-line" data-hook-event>
        Runs at {HOOK_WORDS[hook.on]}.
      </p>
      <div class="lre-stack" data-hook-command>
        <span class="rpe-caption">Its command</span>
        <Pre text={hook.runs} mono />
        <p class="rpe-meta" data-hook-timeout>
          {timeout === null ? "No timeout of its own: the hooks.timeout setting's seconds hold." : `Stopped after ${timeout} seconds.`}
        </p>
      </div>
      {hook.state === "waiting" || hook.state === "off" ? (
        <p class="rpe-meta" data-hook-allow>
          Its command {hook.state === "waiting" ? "waits for" : "is switched off by"} the server's own command line: run <code>rpe allow {hook.name}</code> on the server. No page switches it on.
        </p>
      ) : null}
      {(file.problems ?? []).length === 0 ? null : (
        <Banner tone="warn" icon="alert" title="What RPH found wrong with its file">
          <ul class="rpe-plain">
            {(file.problems ?? []).map((p, i) => (
              <li key={i} class="rpe-line">
                {p}
              </li>
            ))}
          </ul>
        </Banner>
      )}
      {said === null ? null : (
        <Banner tone="info" icon="check" title="Done">
          <span data-said>{said}</span>
        </Banner>
      )}
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Not done">
          <span data-problem>{problem}</span>
        </Banner>
      )}
      <div class="lre-inline rpe-wrap" data-switches>
        {hook.off ? (
          onAt.map((at) => (
            <Button key={at} small busy={busy === "switch"} onClick={() => switchTo(false, at)}>
              {at === "global" ? "Switch on for every chat" : "Switch on for this chat"}
            </Button>
          ))
        ) : hook.replacedBy !== null ? null : (
          <>
            {chat === null ? null : (
              <Button small busy={busy === "switch"} onClick={() => switchTo(true, "chat")}>
                Switch off for this chat
              </Button>
            )}
            <Button small kind="ghost" busy={busy === "switch"} onClick={() => switchTo(true, "global")}>
              Switch off for every chat
            </Button>
          </>
        )}
        <Button small kind="ghost" onClick={() => props.onFile(file.path)}>
          Open its file on Files
        </Button>
      </div>
      <Section id="text" title="Its hooks file">
        <p class="rpe-meta">
          {file.path}: {hook.off ? "" : "every hook this file names is in the text below. "}A hook is edited here like a rule and saved as his at a level.
        </p>
        {text.problem === null ? null : <p class="rpe-line">{text.problem}</p>}
        {text.value === null ? (
          text.problem === null ? <p class="lre-muted rpe-line">Reading its file…</p> : null
        ) : whole ? (
          <>
            <textarea class="lre-input rpe-editor" value={shown} spellcheck={false} onInput={(e) => setDraft((e.currentTarget as HTMLTextAreaElement).value)} aria-label="The hooks file" />
            <div class="lre-inline rpe-wrap">
              <label class="lre-field">
                <span class="label">Save it as yours at</span>
                <select class="lre-input" value={level} onChange={(e) => setLevel((e.currentTarget as HTMLSelectElement).value as WriteLevel)}>
                  {levels.map((l) => (
                    <option key={l} value={l}>
                      {l === "global" ? "every chat" : l === "chat" ? "this chat" : "this character"}
                    </option>
                  ))}
                </select>
              </label>
              <Button busy={busy === "save"} disabled={draft === null || draft === text.value.text} onClick={save}>
                Save as mine
              </Button>
            </div>
          </>
        ) : (
          <p class="rpe-line">This file is longer than a piece; edit it on Files.</p>
        )}
      </Section>
    </div>
  );
}
