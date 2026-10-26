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
  "lre.job": { start: { tools: ["lre_job_start"] }, cancel: { tools: ["lre_job_cancel"] }, list: { tools: ["lre_jobs", "lre_job", "lre_job_apply"] }, dismiss: { tools: ["lre_job_dismiss"] } },
  "lre.lore": {
    drift: { tools: ["lre_lore_drift"] },
    save: { tools: ["lre_lore_save"] },
    books: { tools: ["lre_lore_books"] },
    entries: { tools: ["lre_lore_entries"] },
    pins: { tools: ["lre_lore_pins"] },
    fields: { tools: ["lre_lore_fields"] },
    check: { excluded: "Build's World Info entry form checks a gate as it is typed; an agent's lre_lore_fields answers the same problem when it saves." },
  },
  "lre.preset": {
    get: { tools: ["lre_preset", "lre_preset_add_blocks"] },
    add: { tools: ["lre_preset_add_blocks"] },
  },
  "lre.diag": { get: { tools: ["lre_diag"] }, clear: { tools: ["lre_diag_clear"] }, dismiss: { tools: ["lre_activity_dismiss"] } },
  "lre.agents": {
    get: { excluded: "The update notice and Settings → MCP server read the MCP servers the extension knows of; an agent's own server state is lre_status." },
    kit: { excluded: "The MCP server's own check for a newer kit of tools, which its core runs on connect and on a timer, never an agent's call." },
    update: { excluded: "The notice's Update now button, which asks another MCP server to reload; the user presses it, not an agent through one." },
    reconnect: { excluded: "Reconnect in Lumiverse, which ends a Lumiverse-run MCP server's process so Lumiverse connects it again; only the user's press on its line does that, never an agent." },
    dismiss: { excluded: "Dismissing the update notice in the drawer is the user's acknowledgement of it, so no agent tool does it for them." },
    forget: { excluded: "Settings → MCP server's Forget, which drops a server the user no longer runs from the list; the user's call, on the page." },
  },
  "lre.cancel": { excluded: "Cancel on the activity line, the player's own stop for a turn in flight in the chat they watch; a tool's turn is the player's chat too, so the page that shows it stops it." },
};
