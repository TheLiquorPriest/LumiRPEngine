// Going back to the previous build (STANDALONE-PLAN §15.6), in its four steps: the words `rpe down`
// prints when it has stopped RPE's service, and the Migration page's list. They are the application's
// own texts, kept with the command line's other output, and sent to no model. Today's data was never
// changed and the connection in Lumiverse neither (at the swap RPE answered on it as it was, in its
// runtime's place), so these steps are all going back takes; a fifth names the chats the user moved
// to a connection of RPE's own, where RPE answered on one.

/**
 * The permissions the previous build asks for, as its manifest names them (`spindle.json` of the build
 * kept for going back, RPEngine 71e30e33). Lumiverse withdrew those the light extension doesn't ask
 * for when it took the previous build's place, and treats them as new on the way back.
 */
export const PREVIOUS_PERMISSIONS = ["generation", "context_handler", "chats", "chat_mutation", "world_books", "presets", "regex_scripts", "decisions", "ui_panels", "mcp_servers", "interceptor", "embeddings", "memories", "databanks", "web_search", "generation_parameters", "cors_proxy"] as const;

export interface GoingBackFacts {
  /** The extension's identifier in Lumiverse. */
  identifier: string;
  /** Today's runtime the swap took the place of, as the last run's report names it: its name and the file it was set up from (null: not known). Null where no run took one. */
  runtime: { name: string; source: string | null } | null;
  /** RPE's own connection in Lumiverse, by its id, where RPE answered on one of its own rather than on today's; absent or null where it took today's over. */
  own?: string | null;
}

/** A word of a shell line, quoted where it must be. */
function shellWord(word: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/** The steps of going back, as lines; the first is what `rpe down` has just done, or, where it has not been run (`facts.downRun` false), what it does. */
export function goingBack(facts: GoingBackFacts & { downRun?: boolean }): string[] {
  const name = facts.runtime === null ? "<its name>" : shellWord(facts.runtime.name);
  const source = facts.runtime?.source ?? null;
  const script = source === null ? "<the extension's folder>/dist/lumiah.js" : shellWord(source);
  const down = "RPE's service is stopped and removed, and its data stays where it is: what you played on RPE does not flow back, and a later cutover finds it as you left it.";
  return [
    "To go back to the previous build: today's data was never changed, and neither was its connection in Lumiverse.",
    facts.downRun === false ? `  1. Run rpe down: ${down}` : `  1. rpe down: done. ${down}`,
    `  2. In Lumiverse, switch the installed extension (${facts.identifier}) to the branch the previous build is kept on: switching keeps its storage. Do not remove the extension and install it again: removing an extension deletes its storage (the migration's backup holds a copy).`,
    `  3. In Lumiverse's extension settings, approve the permissions the previous build asks for, then switch the extension off and on again, so that it starts with them in hand: ${PREVIOUS_PERMISSIONS.join(", ")}.`,
    `  4. Run the previous build's own install line, the one you use when you update it: bun ${script} up --name ${name} --systemd. It reads its address from its own config, keeps its registration, and takes up its service's unit, which the swap only switched off, with the memory cap it holds: all as the swap left them.`,
    ...(facts.own ? [`  5. In Lumiverse, give every chat you moved to RPE's connection ${facts.own} the connection it had before: RPE no longer answers there.`] : []),
  ];
}
