// What the door hears of each chat's running generation on its event socket (STANDALONE-PLAN §4.2
// l.221, l.246-258; READINGS N-18): that it started, on which model; the lore Lumiverse activated for it
// (`WORLD_INFO_ACTIVATED`, the turn's activated lore, never the context's list), told as it is heard
// (`activation.ts`); whether its tagged request came; and that it ended. Lumiverse runs one generation
// per chat at a time (`generate.service.ts:1601-1651`), so a chat's next replaces its last. A generation
// on RPE's connection (its model one of RPE's connection's names, or one whose question RPE answered)
// that ends with no tagged request is told, with the untagged requests that came on RPE's connection
// meanwhile. RPE cannot know whether an untagged request in that time is that generation's own or a side
// request (a title, a summary, another extension's call): nothing in an untagged request ties it to one.

import type { ChatChange } from "./events";
import type { TagLore } from "./wire";

interface Running {
  generation: string;
  /** On RPE's connection, by its model or by the question RPE answered for it. */
  ours: boolean;
  /** Lumiverse's list of what activated, told as it was heard; null where none was heard (none activated). */
  lore: Promise<TagLore[]> | null;
  /** Its tagged request came. */
  tagged: boolean;
  /** Untagged requests on RPE's connection while it awaited its tag. */
  untagged: number;
}

export interface HeardDeps {
  /** Whether a model name is one RPE's connection in Lumiverse may name. */
  rpeModel(model: string): boolean;
  /** Whether RPE answered the question for this generation of the chat. */
  asked(chat: string, generation: string): boolean;
  /** A generation on RPE's connection ended with no tagged request: told in RPE's log. */
  untaggedEnd(what: { chat: string; generation: string; untagged: number; stopped: boolean }): void;
  /** Tells how each activated entry of the chat's running generation came in, and names its book (`Activations.tell`); never rejects. */
  tell(chat: string, lore: readonly TagLore[]): Promise<TagLore[]>;
}

export class HeardGenerations {
  readonly #byChat = new Map<string, Running>();

  constructor(private readonly deps: HeardDeps) {}

  /** A change the event socket heard. For lore Lumiverse activated, the entries told, once they are; null for any other change. */
  heard(change: ChatChange): Promise<TagLore[]> | null {
    if (change.kind === "generation-started") {
      this.#byChat.set(change.chat, { generation: change.generation, ours: change.model !== null && this.deps.rpeModel(change.model), lore: null, tagged: false, untagged: 0 });
    } else if (change.kind === "lore-activated") {
      const told = this.deps.tell(change.chat, change.lore);
      const running = this.#byChat.get(change.chat);
      if (running !== undefined) running.lore = running.lore === null ? told : Promise.all([running.lore, told]).then(([had, now]) => [...had, ...now]);
      return told;
    } else if (change.kind === "generation-ended") {
      const running = this.#byChat.get(change.chat);
      if (running === undefined || running.generation !== change.generation) return null;
      this.#byChat.delete(change.chat);
      if (!running.tagged && (running.ours || this.deps.asked(change.chat, change.generation))) {
        this.deps.untaggedEnd({ chat: change.chat, generation: change.generation, untagged: running.untagged, stopped: change.stopped === true });
      }
    }
    return null;
  }

  /** The tagged request of the chat's generation came: the lore Lumiverse activated for it, told, as heard so far (none heard: none activated). */
  async tagged(chat: string, generation: string): Promise<TagLore[]> {
    const running = this.#byChat.get(chat);
    if (running === undefined || running.generation !== generation) return [];
    running.tagged = true;
    return running.lore === null ? [] : running.lore;
  }

  /** Whether a generation heard to start on RPE's connection, or asked about, awaits its tagged request now; each counts this untagged request. */
  untagged(): boolean {
    let awaiting = false;
    for (const [chat, running] of this.#byChat) {
      if (running.tagged || !(running.ours || this.deps.asked(chat, running.generation))) continue;
      running.untagged++;
      awaiting = true;
    }
    return awaiting;
  }
}
