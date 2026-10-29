// Every request LumiRPEngine's protocol accepts, and every op of one that has ops, mapped to the
// tools that send it, or to why no tool does (DESIGN §23). The type is complete by construction:
// a new request type or op (a GM edit's included) without a row fails the typecheck, so no surface
// ships without tools or a stated reason, and the tests check that every tool named here exists.

import type { FrontendToBackend } from "../shared/protocol";

type RequestType = FrontendToBackend["type"];

/** The ops one request of the union takes: its `op` (an optional op counts, without its absence), else those of its list of `ops` (a GM edit's); never when it has neither. */
type OpOf<R> = R extends unknown ? ("op" extends keyof R ? Exclude<R[keyof R & "op"], undefined> : "ops" extends keyof R ? (R[keyof R & "ops"] extends readonly { op: infer O }[] ? O : never) : never) : never;
type OpsOf<T extends RequestType> = OpOf<Extract<FrontendToBackend, { type: T }>>;

/** The tools that send a request, or why none does. */
export type CoverageRow = { readonly tools: readonly string[] } | { readonly excluded: string };

/** A row per request type; per op for a type that has ops. */
export type Coverage = { readonly [T in RequestType]: [OpsOf<T>] extends [never] ? CoverageRow : { readonly [O in OpsOf<T> & string]: CoverageRow } };

const PATCHED = "lre_edit's JSON Patch (the patch op) writes any item or part of the draft, all of it or none and at the version read, which this one-item save of Build's forms can't promise";

export const COVERAGE: Coverage = {
  "lre.hello": { excluded: "The connection's own handshake, sent once as it opens (naming this client and checking the agent API): every live tool rides on it." },
  "lre.state.resync": { excluded: "A page asking again for the state push it missed while away; an outside client holds no pushed state." },
  "lre.page": { excluded: "Which chat a browser page shows, and whether on screen: it decides which page starts a prepared reply, and an outside client is no page." },
  "lre.state.get": { tools: ["lre_chat_state", "lre_chips", "lre_inspector", "lre_fix", "lre_chip", "lre_timelapse"] },
  "lre.action": { tools: ["lre_action", "lre_timelapse"] },
  "lre.chip": { tools: ["lre_chip"] },
  "lre.view.open": { tools: ["lre_view_open"] },
  "lre.fix": { tools: ["lre_fix"] },
  "lre.edit": {
    set: { tools: ["lre_gm_edit"] },
    add: { tools: ["lre_gm_edit"] },
    link: { tools: ["lre_gm_edit"] },
    unlink: { tools: ["lre_gm_edit"] },
    move: { tools: ["lre_gm_edit"] },
    put: { tools: ["lre_gm_edit"] },
    adjust: { tools: ["lre_gm_edit"] },
    stage: { tools: ["lre_gm_edit"] },
    entity: { tools: ["lre_gm_edit"] },
    classify: { tools: ["lre_gm_edit"] },
    life: { tools: ["lre_gm_edit"] },
    spawn: { tools: ["lre_gm_edit"] },
    despawn: { tools: ["lre_gm_edit"] },
    restore: { tools: ["lre_gm_edit"] },
    mind_pin: { tools: ["lre_gm_edit", "lre_mind_edit"] },
    mind_refresh: { tools: ["lre_gm_edit", "lre_mind_edit"] },
    mind_memory: { tools: ["lre_gm_edit", "lre_mind_edit"] },
    mind_intent: { tools: ["lre_gm_edit", "lre_mind_edit"] },
    mind_knowledge: { tools: ["lre_gm_edit", "lre_mind_edit"] },
    routine_follow: { tools: ["lre_gm_edit", "lre_routine_edit"] },
    routine_block: { tools: ["lre_gm_edit", "lre_routine_edit"] },
    schedule_override: { tools: ["lre_gm_edit", "lre_routine_edit"] },
    effect: { tools: ["lre_gm_edit"] },
    feed: { tools: ["lre_gm_edit"] },
  },
  "lre.gm": { tools: ["lre_gm", "lre_minds"] },
  "lre.sections": { tools: ["lre_sections"] },
  "lre.marker": { tools: ["lre_marker", "lre_upgrade"] },
  "lre.keep": { tools: ["lre_keep"] },
  "lre.minds": { run: { tools: ["lre_minds_run"] }, cancel: { tools: ["lre_minds_cancel"] }, status: { tools: ["lre_minds"] } },
  "lre.routine": { day: { tools: ["lre_day"] }, changed: { tools: ["lre_routine_changes"] } },
  "lre.character": { get: { excluded: "The Character page's and sheet's read, shaped for their pickers: lre_draft reads the same person from the draft and lre_gm from the chat, with nothing this view adds that a tool needs." } },
  "lre.restart": { excluded: "A page claiming a reply the engine prepared before starting it with Lumiverse's own commands: only the page holding the turn can." },
  "lre.settings.get": { tools: ["lre_settings", "lre_settings_set"] },
  "lre.settings.set": { tools: ["lre_settings_set"] },
  "lre.settings.caveats": { tools: ["lre_settings_caveats", "lre_settings_set"] },
  "lre.editor": {
    get: { tools: ["lre_worlds", "lre_world", "lre_search", "lre_draft", "lre_edit", "lre_commit", "lre_discard", "lre_restore", "lre_diff", "lre_world_delete", "lre_playtest", "lre_check_world", "lre_lore_save", "lre_job_apply", "lre_profile", "lre_sheet", "lre_routines", "lre_routine", "lre_routine_put", "lre_routine_delete", "lre_routine_settings", "lre_schedules", "lre_schedule", "lre_schedule_put", "lre_schedule_delete"] },
    discard: { tools: ["lre_discard"] },
    put: { excluded: PATCHED },
    remove: { excluded: PATCHED },
    set: { excluded: PATCHED },
    profile: { tools: ["lre_profile"] },
    patch: { tools: ["lre_edit", "lre_job_apply", "lre_routine_put", "lre_routine_delete", "lre_routine_settings", "lre_schedule_put", "lre_schedule_delete"] },
    restore: { tools: ["lre_restore"] },
  },
  "lre.world": {
    list: { tools: ["lre_worlds", "lre_search", "lre_world", "lre_draft", "lre_history", "lre_diff", "lre_restore", "lre_world_delete", "lre_world_export", "lre_attach", "lre_upgrade", "lre_lint"] },
    get: { tools: ["lre_world", "lre_history", "lre_diff", "lre_search", "lre_draft", "lre_commit", "lre_discard", "lre_world_delete"] },
    create: { tools: ["lre_world_create"] },
    delete: { tools: ["lre_world_delete"] },
    commit: { tools: ["lre_commit"] },
    import: { tools: ["lre_world_import"] },
    export: { tools: ["lre_world_export"] },
    lint: { tools: ["lre_lint"] },
    attach: { tools: ["lre_attach"] },
    upgrade: { tools: ["lre_upgrade"] },
    sheet: { tools: ["lre_sheet"] },
    templates: { tools: ["lre_world_create"] },
    chats: { tools: ["lre_chats", "lre_upgrade", "lre_world_delete"] },
  },
  "lre.ui": { close_drawer: { excluded: "Closes the drawer on the user's screen: the page's own presentation, which nothing an agent does needs." } },
  "lre.map": { display: { tools: ["lre_map_display"] }, walk: { tools: ["lre_map_walk"] } },
  "lre.chat.knowledge": { tools: ["lre_chat_knowledge"] },
  "lre.job": { start: { tools: ["lre_job_start"] }, cancel: { tools: ["lre_job_cancel"] }, list: { tools: ["lre_jobs", "lre_job", "lre_job_apply"] }, dismiss: { tools: ["lre_job_dismiss"] } },
  "lre.lore": {
    drift: { tools: ["lre_lore_drift"] },
    save: { tools: ["lre_lore_save"] },
    books: { tools: ["lre_lore_books"] },
    entries: { tools: ["lre_lore_entries"] },
    pins: { tools: ["lre_lore_pins"] },
    fields: { tools: ["lre_lore_fields"] },
    mark: { excluded: "Writes a secret mark into the text of one of the user's World Info entries, or takes one out: Build's Make secret, Add a secret line, Make public and Save the names, each the user's own press, never an agent's call." },
  },
  "lre.preset": {
    get: { tools: ["lre_preset", "lre_preset_add_blocks"] },
    add: { tools: ["lre_preset_add_blocks"] },
  },
  "lre.diag": {
    get: { tools: ["lre_diag"] },
    clear: { tools: ["lre_diag_clear"] },
    dismiss: { tools: ["lre_activity_dismiss"] },
    text: { excluded: "An agent call's whole text, read one at a time by Diagnostics' Show text behind its curtain; lre_diag with spoilers lists the agent calls themselves (role, model, tokens, outcome, the tools called), which is what a client debugging a chat reads." },
  },
  "lre.agents": {
    get: { excluded: "The update notice and Settings → MCP server read the MCP servers the extension knows of; an agent's own server state is lre_status." },
    kit: { excluded: "The MCP server's own check for a newer kit of tools, which its core runs on connect and on a timer, never an agent's call." },
    update: { excluded: "The notice's Update now button, which asks another MCP server to reload; the user presses it, not an agent through one." },
    reconnect: { excluded: "Reconnect in Lumiverse, which ends a Lumiverse-run MCP server's process so Lumiverse connects it again; only the user's press on its line does that, never an agent." },
    dismiss: { excluded: "Dismissing the update notice in the drawer is the user's acknowledgement of it, so no agent tool does it for them." },
    forget: { excluded: "Settings → MCP server's Forget, which drops a server the user no longer runs from the list; the user's call, on the page." },
  },
  "lre.secrecy": {
    books: { excluded: "Build's secrecy page lists the user's books with where each one's move to secret marks stands; lre_lore_books lists the books for an agent, and a move is the user's own go." },
    preview: { excluded: "What Build's secrecy page shows of a book's move before the user presses Apply; a move writes the user's World Info only on that press, so no agent takes a step of it." },
    apply: { excluded: "Writes the user's World Info books (each secret's mark, each twin put back as it stood): only the user's own press on Build's secrecy page does that, never an agent." },
    confirm: { excluded: "Takes LumiRPEngine's old secrecy fields off the user's World Info entries once the user has checked the book reads right: the user's own check and press on the page." },
    restore: { excluded: "Puts the user's World Info book back exactly as it stood before its move: the user's own press on Build's secrecy page, never an agent's call." },
  },
  "lre.cancel": { excluded: "Cancel on the activity line, the player's own stop for a turn in flight in the chat they watch; a tool's turn is the player's chat too, so the page that shows it stops it." },
  "lre.acceptance": {
    get: { excluded: "Settings → Agents and the drawer's counter read the acceptance run; an agent learns of a refused call from the call itself." },
    open: { excluded: "Opening an acceptance run is the user's own GM action in Settings → Agents, refused to outside clients, so no agent arms a connection the runs guard." },
    close: { excluded: "Closing an acceptance run is the user's own GM action in Settings → Agents, refused to outside clients, as opening one is." },
  },
  "lre.assistant": {
    get: { excluded: "GM → Assistant's thread with the extension's own GM agent, behind the GM gate; an outside agent is an agent already, reading the chat itself with lre_gm and lre_chat_state." },
    send: { excluded: "Asks the extension's GM agent, on the user's own connection and budgets, from GM → Assistant; an outside agent answers the user itself, through lre_gm and lre_edit." },
    cancel: { excluded: "Stops the GM agent's answer under way in GM → Assistant: the user's own press on the running row, for an answer only that page asked for." },
    apply: { excluded: "Applies a change the GM agent proposed in GM → Assistant on the user's own Apply; an outside agent makes its own edits with lre_edit, each with its own Undo." },
    reject: { excluded: "Turns down a change the GM agent proposed, the user's own No on its card in GM → Assistant; nothing an outside agent does goes through those cards." },
    clear: { excluded: "Forgets the chat's thread with the GM agent, the user's own press in GM → Assistant; an outside agent keeps no thread there." },
  },
  "lre.workspace": {
    list: { excluded: "GM → Workspace's list of the agents' workspace files; the MCP server's tools reach the workspace when they move onto the agent tool layer (AGENT-LOOP-PLAN §11, Increment 3)." },
    read: { excluded: "GM → Workspace reads an agent's workspace file for the user; the MCP server's tools reach the workspace when they move onto the agent tool layer (Increment 3)." },
    write: { excluded: "GM → Workspace's own save of a file the user edited, held while a turn runs; the MCP server's tools write the workspace once they move onto the agent tool layer (Increment 3)." },
    delete: { excluded: "GM → Workspace's Delete of a file, the user's own press with its Undo; the MCP server's tools reach the workspace once they move onto the agent tool layer (Increment 3)." },
    move: { excluded: "GM → Workspace's Move of a file to another path, the user's own; the MCP server's tools reach the workspace once they move onto the agent tool layer (Increment 3)." },
    pin: { excluded: "GM → Workspace's pin of a file for the agents, the user's own choice; the MCP server's tools reach the workspace once they move onto the agent tool layer (Increment 3)." },
    readers: { excluded: "GM → Workspace's choice of whose knowledge may read a file, the user's own; the MCP server's tools reach the workspace once they move onto the agent tool layer (Increment 3)." },
    session: { excluded: "GM → Workspace's view of the main agent's session in the chat (its summary, turns and rollback), GM data for the page; the MCP server's tools reach the main agent once they move onto the agent tool layer (Increment 3)." },
    rollback: { excluded: "GM → Workspace's rollback of the main agent's latest compaction, the user's own press, which the next agent turn carries; an outside agent keeps no main session." },
  },
  "lre.review": {
    get: { excluded: "An agent turn's review card in the chat's chips area, which the page reads to show it; lre_chips reads the chips the card rides on, and the MCP server's tools reach agent turns once they move onto the agent tool layer (AGENT-LOOP-PLAN §11, Increment 3)." },
    apply: { excluded: "Applies changes an agent turn asked to make, the player's own Apply or pick on its review card; an outside agent makes its own changes with lre_edit, each with its own Undo." },
    reject: { excluded: "Turns down the changes an agent turn asked to make, the player's own No on its review card; nothing an outside agent does goes through those cards." },
  },
  "lre.prompts": {
    test: { excluded: "Settings → Agents → Prompts' Test of a role's text, the user's own press that runs the role once on the chat; an outside agent edits no prompt texts." },
  },
};
