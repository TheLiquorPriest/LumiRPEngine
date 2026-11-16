// The guidance files RPE lays its own texts out by (plan §5.4, §14): a prompt part (`.prompts/`), a tool's description (`.tools/`) or
// a skill, in force for a scope. RPH's reader of the levels is its own and not a host's to import (`rp-harness/helpers`), so this one
// reads them as RPH does, through the file port: the nearest level that holds a file of the name, passing over one its levels' config
// switches off (`off:`). A part's header and body are laid out by RPH's one template renderer (`renderTemplate`, R-44), the header's
// fields the outermost, as every shipped part is; a part whose header says `format: lines` holds one `name: text` template per line.
// A file that cannot be read whole is no part, as RPH reads it: what it holds is not used.

import type { FilesPort, GuidanceKind, JsonObject, JsonValue, Layer, LayerLevel, Scope, UserScope } from "rp-harness/contract";
import { renderTemplate } from "rp-harness/helpers";
import { type Split, splitFile } from "../iface/texts";

/** A value a template is filled with. */
export type Field = JsonValue;
/** The named fields a template is filled from. An absent or undefined field is absent. */
export type Fields = { readonly [name: string]: Field | undefined };

/** A template filled in: its text, and every field it put in that had no value. */
export interface Rendered {
  text: string;
  missing: string[];
}

interface PartBase {
  /** Its file's name, without `.md`. */
  name: string;
  kind: "prompts" | "tools";
  /** What it is, from its header. */
  description?: string;
  header: JsonObject;
  /** The file in force, as the agents' paths name it, and its level. */
  source: { path: string; level: LayerLevel };
}

export interface TemplatePart extends PartBase {
  format: "template";
  /** The body filled in; the header's fields are the outermost fields, and `fields` stand over them. */
  render(fields?: Fields): Rendered;
}

/** A part whose header says `format: lines`: one `name: text` template per line. */
export interface LinesPart extends PartBase {
  format: "lines";
  /** The lines' names, in the file's order. */
  names: string[];
  /** One line filled in; undefined when the file holds no line of that name, which means it is not shown. */
  line(name: string, fields?: Fields): string | undefined;
}

export type PromptPart = TemplatePart | LinesPart;

/** A skill in force: its header's name and description, and its body as written. */
export interface Skill {
  name: string;
  description: string;
  body: string;
  source: { path: string; level: LayerLevel };
}

/** The guidance in force for a scope: each file read once for this load. */
export interface Guidance {
  readonly scope: Scope | UserScope;
  /** The prompt part in force of that name; undefined when there is none, it is switched off, or it does not read whole. */
  part(name: string): Promise<PromptPart | undefined>;
  /** A tool's description in force (`.tools/<name>.md`), as a part. */
  tool(name: string): Promise<PromptPart | undefined>;
  skill(name: string): Promise<Skill | undefined>;
}

/** A line of a `format: lines` part: a name of letters, digits, `_` and `-`, a colon, and its text. */
const LINE = /^([A-Za-z0-9_-]+):[ \t]?(.*)$/;
const KINDS: readonly GuidanceKind[] = ["agents", "skills", "rules", "hooks", "prompts", "tools"];

/** A text filled in by RPH's renderer, the header's fields under `fields` (a field given as undefined leaves the header's); null where it does not parse. */
function filled(text: string, header: JsonObject, fields: Fields | undefined, path: string): Rendered | null {
  const given = Object.fromEntries(Object.entries(fields ?? {}).filter(([, value]) => value !== undefined));
  const done = renderTemplate(text, { ...header, ...given }, { path });
  return done.text === undefined ? null : { text: done.text, missing: done.missing };
}

/** A part as its file reads: undefined where its header or any template in it does not read. */
function partOf(text: string, name: string, kind: "prompts" | "tools", source: PartBase["source"]): PromptPart | undefined {
  let split: Split;
  try {
    split = splitFile(text, source.path);
  } catch {
    return undefined;
  }
  const header = split.header as JsonObject;
  const base: PartBase = { name, kind, ...(typeof header.description === "string" ? { description: header.description } : {}), header, source };
  if (header.format === "lines") {
    const lines = new Map<string, string>();
    for (const line of split.body.split("\n")) {
      const m = LINE.exec(line);
      if (m?.[1] !== undefined && !lines.has(m[1])) lines.set(m[1], (m[2] ?? "").trimEnd());
    }
    return { ...base, format: "lines", names: [...lines.keys()], line: (line, fields) => {
      const said = lines.get(line);
      return said === undefined ? undefined : (filled(said, header, fields, source.path)?.text ?? undefined);
    } };
  }
  if (header.format !== undefined && header.format !== "template") return undefined;
  if (filled(split.body, header, {}, source.path) === null) return undefined;
  return { ...base, format: "template", render: (fields) => filled(split.body, header, fields, source.path) ?? { text: "", missing: [] } };
}

/** An `off:` entry as RPH keys it (`prompts/notices`), however it was written: with a mount, a level's own folder name, `.md` or `/SKILL.md`. */
function offKey(entry: string, layers: readonly Layer[]): string {
  let s = entry.trim().replace(/^(?:\.\/|\/)+/, "");
  const mounted = layers.find((l) => l.mount !== "" && s.startsWith(l.mount));
  if (mounted !== undefined) s = s.slice(mounted.mount.length);
  s = s.endsWith("/SKILL.md") ? s.slice(0, -"/SKILL.md".length) : s.endsWith(".md") ? s.slice(0, -".md".length) : s;
  const slash = s.indexOf("/");
  if (slash <= 0) return s;
  const folder = s.slice(0, slash);
  const kind = KINDS.find((k) => k === folder || layers.some((l) => l.folders[k]?.replace(/\/+$/, "") === folder));
  return kind === undefined ? s : `${kind}/${s.slice(slash + 1)}`;
}

export function loadGuidance(files: Pick<FilesPort, "layers" | "read">, scope: Scope | UserScope): Guidance {
  let layers: Promise<Layer[]> | undefined;
  let off: Promise<Set<string>> | undefined;
  const memo = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, make: () => Promise<T>): Promise<T> => {
    let made = memo.get(key) as Promise<T> | undefined;
    if (made === undefined) {
      made = make();
      memo.set(key, made);
    }
    return made;
  };
  const levels = (): Promise<Layer[]> => (layers ??= files.layers(scope));
  /** What the levels' config files switch off, as RPH keys it. */
  const switchedOff = (): Promise<Set<string>> =>
    (off ??= (async () => {
      const all = await levels();
      const names = new Set<string>();
      for (const layer of all) {
        if (layer.config === undefined) continue;
        const read = await files.read(scope, `${layer.mount}${layer.config}`);
        if (read.status !== "read") continue;
        let config: unknown;
        try {
          config = Bun.YAML.parse(read.text);
        } catch {
          continue;
        }
        const listed = typeof config === "object" && config !== null && !Array.isArray(config) ? (config as Record<string, unknown>).off : undefined;
        if (Array.isArray(listed)) for (const name of listed) if (typeof name === "string") names.add(offKey(name, all));
      }
      return names;
    })());
  /** The nearest level's file of a kind and name, unless switched off: its text and where it is. */
  const nearest = (kind: "prompts" | "tools" | "skills", name: string): Promise<{ text: string; path: string; level: LayerLevel } | undefined> =>
    once(`${kind}/${name}`, async () => {
      if ((await switchedOff()).has(`${kind}/${name}`)) return undefined;
      for (const layer of [...(await levels())].reverse()) {
        const folder = layer.folders[kind]?.replace(/\/+$/, "");
        if (folder === undefined) continue;
        const path = `${layer.mount}${folder}/${name}${kind === "skills" ? "/SKILL.md" : ".md"}`;
        const read = await files.read(scope, path);
        if (read.status === "read") return { text: read.text, path, level: layer.level };
      }
      return undefined;
    });
  const part = async (kind: "prompts" | "tools", name: string): Promise<PromptPart | undefined> => {
    const found = await nearest(kind, name);
    return found === undefined ? undefined : partOf(found.text, name, kind, { path: found.path, level: found.level });
  };
  return {
    scope,
    part: (name) => part("prompts", name),
    tool: (name) => part("tools", name),
    async skill(name) {
      const found = await nearest("skills", name);
      if (found === undefined) return undefined;
      try {
        const { header, body } = splitFile(found.text, found.path);
        return { name: typeof header.name === "string" ? header.name : name, description: typeof header.description === "string" ? header.description : "", body, source: { path: found.path, level: found.level } };
      } catch {
        return undefined;
      }
    },
  };
}
