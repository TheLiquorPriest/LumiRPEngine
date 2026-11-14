// The secrets file (plan §4.5, §16): the model layer's keys and sign-ins, the values of connections'
// headers, and whatever else an area must keep secret (the Lumiverse session the adapter signs in
// with), each as a part under a name of its own. It is readable by its owner alone, in a folder only
// its owner may enter, outside the file tree agents see, and never sent to a page. Each part is
// written whole, one write after another, and the file is replaced in one step.

import type { JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import { OneAtATime, readText, writeWhole } from "./disk";

const FORMAT = 1;

export class SecretsFile {
  private readonly writes = new OneAtATime();

  constructor(readonly path: string) {}

  /** Every part as the file holds it. */
  private async parts(): Promise<Record<string, JsonValue>> {
    const text = await readText(this.path);
    if (text === null) return {};
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      // The parser's own words are left out: they may quote the file, which holds secrets.
      throw new Error(`The secrets file (${this.path}) is not JSON: fix it or remove it, then start RPE again.`);
    }
    if (!isRecord(doc) || doc.v !== FORMAT || !isRecord(doc.parts)) throw new Error(`The secrets file (${this.path}) is not in a form this RPE reads: fix it or remove it, then start RPE again.`);
    return doc.parts as Record<string, JsonValue>;
  }

  /** A part as last written; null when there is none. */
  async read(part: string): Promise<JsonValue | null> {
    const parts = await this.parts();
    return Object.hasOwn(parts, part) ? (parts[part] ?? null) : null;
  }

  /** Replaces a part whole; null takes it away. Waits for every write asked for before it. */
  write(part: string, value: JsonValue | null): Promise<void> {
    return this.writes.run(async () => {
      const parts = await this.parts();
      if (value === null) delete parts[part];
      else parts[part] = value;
      await writeWhole(this.path, `${JSON.stringify({ v: FORMAT, parts }, null, 2)}\n`);
    });
  }
}
