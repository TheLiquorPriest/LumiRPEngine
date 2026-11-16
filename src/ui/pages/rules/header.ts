// A rule's header in words (plan §5.4): the file's front matter read for what the rule looks at and what it does, so the page says in plain
// words what triggers it. RPH reads the file for what holds; this only says what the header says, and a header it cannot read says nothing.

/** A rule file split into its header's fields (each as written) and its text. */
export interface RuleFile {
  fields: ReadonlyMap<string, string>;
  body: string;
}

const KEY = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/;

/** The header of a file (between the two `---` lines) as `name: value` lines, and the text after it. A file with no header has none. */
export function ruleFileOf(text: string): RuleFile {
  const source = (text.startsWith("\uFEFF") ? text.slice(1) : text).replace(/\r\n?/g, "\n");
  const open = /^---[ \t]*\n/.exec(source);
  if (open === null) return { fields: new Map(), body: source };
  const rest = source.slice(open[0].length);
  const close = /(^|\n)---[ \t]*(\n|$)/.exec(rest);
  if (close === null) return { fields: new Map(), body: source };
  const fields = new Map<string, string>();
  for (const line of rest.slice(0, close.index + (close[1] === "" ? 0 : 1)).split("\n")) {
    if (line.startsWith("#") || line.startsWith(" ")) continue;
    const found = KEY.exec(line);
    if (found !== null && !fields.has(found[1] as string)) fields.set(found[1] as string, unquoted((found[2] as string).trim()));
  }
  return { fields, body: rest.slice(close.index + close[0].length) };
}

function unquoted(value: string): string {
  const q = value[0];
  return value.length >= 2 && (q === '"' || q === "'") && value.endsWith(q) ? value.slice(1, -1) : value;
}

/** A flow list `[a, b]` or a single name as its names. */
export function namesOf(value: string | undefined): string[] {
  if (value === undefined || value === "") return [];
  const inner = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return inner.split(",").map((n) => unquoted(n.trim())).filter((n) => n !== "");
}

const SCOPE_WORDS: Readonly<Record<string, string>> = { text: "the agent's text", thinking: "its thinking", reply: "the reply", arguments: "a tool's arguments", result: "a tool's result" };

function scopeWords(value: string | undefined): string {
  const names = namesOf(value);
  const list = names.length === 0 ? ["text"] : names;
  return list
    .map((n) => {
      const [kind, tool] = n.split(":");
      const words = SCOPE_WORDS[kind ?? ""] ?? n;
      return tool === undefined ? words : `${words} of ${tool}`;
    })
    .join(", ");
}

const MOMENT_WORDS: Readonly<Record<string, string>> = { "turn-start": "a turn's start", "run-end": "a run's end", "before-compaction": "before a compaction" };

/** What triggers the rule, in a sentence or two, from its header. */
export function triggerWords(fields: ReadonlyMap<string, string>): string {
  const get = (name: string): string | undefined => fields.get(name);
  const repeat = get("repeat") === undefined ? "" : ` It may fire ${get("repeat")}.`;
  if (get("condition") !== undefined) {
    const stops = get("interrupt") === "never" ? "lets the writing finish and speaks after it" : "stops the call and adds its text";
    return `A pattern, \`${get("condition")}\`${get("case") === "ignore" ? " (case ignored)" : ""}, looked for in ${scopeWords(get("scope"))}; a match ${stops}${get("hold") === "true" ? ", and holds a tool's call until the rule has had its say" : ""}.${repeat}`;
  }
  if (get("question") !== undefined) return `A question put to a judging model${get("judge") === undefined ? " (the agent's own)" : ` on the connection ${get("judge")}`} about ${scopeWords(get("scope"))}: “${get("question")}” It fires on yes.${repeat}`;
  if (get("at") !== undefined) {
    const fact = get("fact") === undefined ? "" : ` while ${get("fact")} holds`;
    const command = get("command") === undefined ? "" : `, when the command ${get("command")} answers yes`;
    return `At ${MOMENT_WORDS[get("at") ?? ""] ?? get("at")}${fact}${command}.${repeat}`;
  }
  if (get("every") !== undefined) return `Every ${get("every")} turns${get("fact") === undefined ? "" : ` while ${get("fact")} holds`}.${repeat}`;
  const turns = namesOf(get("turns"));
  return turns.length === 0 ? "No trigger of its own: it is in the briefing of every turn." : `No trigger of its own: it is in the briefing of the turns of these kinds: ${turns.join(", ")}.`;
}
