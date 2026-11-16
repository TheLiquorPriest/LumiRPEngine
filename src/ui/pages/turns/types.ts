// The Turn page's shared shapes: what a section is drawn from, what a section is, and the turn's folder as the page holds it.

import type { ComponentChildren } from "preact";
import type { FolderEntry, RequestReply, TurnReply } from "../../../shared/api";
import type { RunNode } from "../../live-model";
import type { NoticeLines } from "../../notice-words";

/** A model call's request as the harness kept it and rebuilt it: every message as it was sent, and each tool declared with the file its words came from. */
export type RequestShown = Pick<RequestReply, "same" | "messages" | "tools">;

/** The file open: a file of the turn's folder by its text, or a model call's request rebuilt as it was sent; read, or RPE's reason it gave none. */
export interface OpenShown {
  name: string;
  text: string | null;
  request: RequestShown | null;
  problem: string | null;
}

/**
 * A turn's folder as the page has read it: its entries as RPE lists them (null until read), why the
 * list could not be read, and the file open, with its text once read or RPE's reason it gave none.
 */
export interface FolderShown {
  files: FolderEntry[] | null;
  problem: string | null;
  open: OpenShown | null;
}

export const NO_FOLDER: FolderShown = { files: null, problem: null, open: null };

/** What a part of the Turn page is drawn from: the turn as last read, its runs as the page holds them (the first first), now, and its folder. */
export interface TurnParts {
  turn: TurnReply;
  runs: readonly RunNode[];
  now: number;
  folder: FolderShown;
  /** The notices file's words, for the records of a run's trace that are notices. */
  notices?: NoticeLines;
  onOpenFile(name: string): void;
  onOpenRequest(name: string, held: string | null): void;
  onCloseFile(): void;
}

/** One part of the Turn page, a module of its own under `sections/`: its place, its title, whether it sits behind the spoiler gate, and its body (null when the turn has nothing for it). */
export interface TurnSection {
  id: string;
  /** Where it stands among the sections, the lowest first. */
  order: number;
  title: string;
  spoiler: boolean;
  body(parts: TurnParts): ComponentChildren | null;
}
