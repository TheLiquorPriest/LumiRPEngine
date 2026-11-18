// What the door hears of each chat's running generation on its event socket (STANDALONE-PLAN §4.2
// l.221, l.246-258; READINGS N-18): that it started, on which model; the lore Lumiverse activated for it
// (`WORLD_INFO_ACTIVATED`, the turn's activated lore, never the context's list), told as it is heard
// (`activation.ts`); whether its tagged request came; and that it ended. Lumiverse runs one generation
// per chat at a time (`generate.service.ts:1601-1651`), so a chat's next replaces its last.
//
// Nothing the event socket says tells whose connection a generation is on: `GENERATION_STARTED` names a
// model, and another connection of Lumiverse (the user's default one, say) may name the same. Nor does the
// extension's question: it asks one for every generation of every chat, before the connection is known
// (`ext/question.ts`). What does tell is a request that reaches RPE's provider route naming that model while
// the generation runs. A generation that ends with no tagged request is told, with the untagged requests
// that came on RPE's connection for its model meanwhile, only where one came; a generation that sent RPE
// nothing was not on RPE's connection, or sent it nothing to get wrong. RPE cannot know whether an untagged
// request in that time is that generation's own or a side request (a title, a summary, another extension's
// call): nothing in an untagged request ties it to one.

import type { ChatChange } from "./events";
import type { TagLore } from "./wire";

interface Running {
  generation: string;
  /** The model it started on, as Lumiverse named it; null where it named none. */
  model: string | null;
  /** Lumiverse's list of what activated, told as it was heard; null where none was heard (none activated). */
  lore: Promise<TagLore[]> | null;
  /** Its tagged request came. */
  tagged: boolean;
  /** Untagged requests on RPE's connection, for its model, while it awaited its tag. */
  untagged: number;
}

export interface HeardDeps {
  /** A generation ended with no tagged request, after untagged requests came on RPE's connection for its model: told in RPE's log. */
  untaggedEnd(what: { chat: string; generation: string; model: string | null; untagged: number; stopped: boolean }): void;
  /** Tells how each activated entry of the chat's running generation came in, and names its book (`Activations.tell`); never rejects. */
  tell(chat: string, lore: readonly TagLore[]): Promise<TagLore[]>;
}

export class HeardGenerations {
  readonly #byChat = new Map<string, Running>();

  readonly #targets = new Map<string, { generation: string; message: string }>();

  constructor(private readonly deps: HeardDeps) {}

  /** A change the event socket heard. For lore Lumiverse activated, the entries told, once they are; null for any other change. */
  heard(change: ChatChange): Promise<TagLore[]> | null {
    if (change.kind === "generation-started") {
      this.#byChat.set(change.chat, { generation: change.generation, model: change.model, lore: null, tagged: false, untagged: 0 });
    } else if (change.kind === "lore-activated") {
      const told = this.deps.tell(change.chat, change.lore);
      const running = this.#byChat.get(change.chat);
      if (running !== undefined) running.lore = running.lore === null ? told : Promise.all([running.lore, told]).then(([had, now]) => [...had, ...now]);
      return told;
    } else if (change.kind === "generation-ended") {
      const running = this.#byChat.get(change.chat);
      if (running === undefined || running.generation !== change.generation) return null;
      this.#byChat.delete(change.chat);
      if (!running.tagged && running.untagged > 0) {
        this.deps.untaggedEnd({ chat: change.chat, generation: change.generation, model: running.model, untagged: running.untagged, stopped: change.stopped === true });
      }
    }
    return null;
  }

  /**
   * The tagged request of the chat's generation came: the lore Lumiverse activated for it, told, as heard so far (none heard: none activated); and the message
   * the tag names as the one the reply is written to, kept while the generation runs (`named`).
   */
  async tagged(chat: string, generation: string, target: string | null = null): Promise<TagLore[]> {
    if (target !== null) this.#targets.set(chat, { generation, message: target });
    const running = this.#byChat.get(chat);
    if (running === undefined || running.generation !== generation) return [];
    running.tagged = true;
    return running.lore === null ? [] : running.lore;
  }

  /**
   * A generation's end as the turn lane is to be told it: Lumiverse's stop names no message (`GENERATION_STOPPED` carries the generation and the
   * partial text, `generate.service.ts:3013-3021`, `:4520-4536`), and the partial text was saved to the message the tag named, which the change then names.
   * Call it before `heard`, which forgets the generation at its end.
   */
  named(change: ChatChange): ChatChange {
    if (change.kind !== "generation-ended") return change;
    const kept = this.#targets.get(change.chat);
    if (kept?.generation !== change.generation) return change;
    this.#targets.delete(change.chat);
    return change.stopped === true && change.message === null ? { ...change, message: kept.message } : change;
  }

  /** Whether a generation heard to start on this model awaits its tagged request now; each counts this untagged request on RPE's connection. A request that names no model is counted against none. */
  untagged(model: string | null): boolean {
    let awaiting = false;
    for (const running of this.#byChat.values()) {
      if (running.tagged || model === null || running.model !== model) continue;
      running.untagged++;
      awaiting = true;
    }
    return awaiting;
  }
}
