// The choices the composer's controls offer, read from the files that name them as the chat's agents are
// given them (the shipped one, or the nearer one that replaces it): the depths a turn can be asked to run
// at (`TURN.md`'s `depths:`) and the ways a swipe can be played (`SWIPE.md`'s `modes:`). Each is a map from
// the choice's name to a line saying what it is, in the file's front matter; the control offers whatever
// the file lists, in its order, so a choice added to the file is offered with no change here, and no name
// is in code.

import { useEffect, useState } from "preact/hooks";
import type { RpeClient } from "../client";
import { replyOf } from "../client";

/** One choice a file lists: its name, as the ask carries it, and the line saying what it is. */
export interface Choice {
  name: string;
  about: string;
}

/** The files and the front-matter key each control's choices are in, by the kind of ask: each named by its shipped file, whose name's file in force for the chat is read. */
export const CHOICE_FILES = { depth: { file: "@shipped/TURN.md", key: "depths" }, swipe: { file: "@shipped/SWIPE.md", key: "modes" } } as const;

function unquoted(text: string): string {
  const value = text.trim();
  return value.length >= 2 && (value.startsWith('"') || value.startsWith("'")) && value.endsWith(value[0] as string) ? value.slice(1, -1) : value;
}

/** The map under `key` in a file's front matter, in the order written; none where the file has no front matter or no such key. */
export function choicesOf(text: string, key: string): Choice[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return [];
  const end = lines.indexOf("---", 1);
  const head = lines.slice(1, end === -1 ? lines.length : end);
  const at = head.findIndex((line) => line.trimEnd() === `${key}:`);
  if (at === -1) return [];
  const out: Choice[] = [];
  for (const line of head.slice(at + 1)) {
    if (line.trim() === "") continue;
    if (!/^\s/.test(line)) break;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    out.push({ name: unquoted(line.slice(0, colon)), about: unquoted(line.slice(colon + 1)) });
  }
  return out;
}

/** The choices of one kind of ask in force for `chat`, read when the control mounts and again when the chat changes; none until they are read, or where the file cannot be. */
export function useChoices(client: Pick<RpeClient, "call">, chat: string, kind: keyof typeof CHOICE_FILES): readonly Choice[] {
  const [choices, setChoices] = useState<readonly Choice[]>([]);
  useEffect(() => {
    setChoices([]);
    let alive = true;
    const { file, key } = CHOICE_FILES[kind];
    client.call("GET /api/v1/files-in-force/*", { "*": file }, { query: { chat } }).then(
      (answer) => {
        if (alive) setChoices(choicesOf(replyOf(answer).text, key));
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [chat, kind]);
  return choices;
}
