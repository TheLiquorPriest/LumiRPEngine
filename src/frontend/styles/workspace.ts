// GM → Workspace (frontend/gm/workspace.tsx): a two-pane browser, the list beside what you opened
// once the tab is wide enough, else one pane at a time (the opened one takes the list's place, with
// Back), as the drawer is. The list's areas are cards that fold, folders indent under a hairline,
// a row is its icon, its name in monospace, its size and its chips (small outlined uppercase words in
// their tone); the row open is marked in the accent. The pane: the chips, the editor's bar (saved or
// not, Revert, Save) over the shared monospace text area made tall enough to read a note, the
// actions row; the path dialog; the main session's messages as bubbles, what's sent to the main
// agent on one side in the accent and its answers on the other, raised; one not sent now dashed. A
// turn's transcript is read-only monospace text. Built on the tokens only.

export const WORKSPACE_CSS = `
.lre-ws-wrap{container-type:inline-size;min-width:0}
.lre-ws{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--lre-s3);align-items:start;min-width:0}
.lre-ws.has-preview>.lre-ws-browser,.lre-ws-placeholder{display:none}
.lre-ws-browser{min-width:0}
@container (min-width:720px){
.lre-ws{grid-template-columns:minmax(15rem,2fr) minmax(0,3fr)}
.lre-ws.has-preview>.lre-ws-browser{display:block}
.lre-ws-placeholder{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--lre-s2);min-height:12rem;padding:var(--lre-s4);color:var(--lre-muted);border:1px dashed var(--lre-border);border-radius:var(--lre-r);text-align:center}
.lre-ws>.lre-gm-page{border-left:1px solid var(--lre-hairline);padding-left:var(--lre-s3);min-width:0}
}
.lre-ws-list{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.lre-ws-toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--lre-s2)}
.lre-ws-count{color:var(--lre-muted);font-size:var(--lre-fs-sm)}
.lre-ws-group{border:1px solid var(--lre-border);border-radius:var(--lre-r);background:var(--lre-card);overflow:hidden;min-width:0}
.lre-ws-group-head,.lre-ws-folder-head{list-style:none;cursor:pointer}
.lre-ws-group-head::-webkit-details-marker,.lre-ws-folder-head::-webkit-details-marker{display:none}
.lre-ws-group-head{display:flex;align-items:center;gap:var(--lre-s2);min-height:var(--lre-tap);padding:var(--lre-s1) var(--lre-s3);font-weight:600}
.lre-ws-group-head:hover{background:var(--lre-hover)}
.lre-ws-group-count{color:var(--lre-muted);font-weight:400;font-size:var(--lre-fs-sm)}
.lre-ws-group-chev{margin-left:auto;color:var(--lre-muted);transition:transform var(--lre-fast)}
.lre-ws-group:not([open]) .lre-ws-group-chev{transform:rotate(-90deg)}
.lre-ws-group-note{margin:0;padding:0 var(--lre-s3) var(--lre-s2)}
.lre-ws-tree{list-style:none;margin:0;padding:0;min-width:0}
.lre-ws-tree .lre-ws-tree{margin-left:var(--lre-s4);border-left:1px solid var(--lre-hairline)}
.lre-ws-item{min-width:0}
.lre-ws-row,.lre-ws-folder-head{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;column-gap:var(--lre-s2);row-gap:var(--lre-s1);width:100%;min-height:var(--lre-tap);padding:var(--lre-s1) var(--lre-s3);border:0;border-top:1px solid var(--lre-hairline);background:none;color:inherit;text-align:left;min-width:0}
.lre-ws-row:hover,.lre-ws-folder-head:hover{background:var(--lre-hover)}
.lre-ws-row[aria-current=true]{background:var(--lre-accent-soft);box-shadow:inset 3px 0 0 var(--lre-accent)}
.lre-ws-row>.lre-ws-chips,.lre-ws-row>.lre-id{grid-column:2/-1}
.lre-ws-row-icon{color:var(--lre-muted)}
.lre-ws-row-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--lre-mono);font-size:var(--lre-fs-sm)}
.lre-ws-row-size{color:var(--lre-muted);font-size:var(--lre-fs-xs);white-space:nowrap}
.lre-ws-session-row{border:1px solid var(--lre-border);border-radius:var(--lre-r);background:var(--lre-card)}
.lre-ws-session-row>.lre-ws-row-name{font-family:inherit;font-size:var(--lre-fs-md);font-weight:600}
.lre-ws-chips{display:flex;flex-wrap:wrap;gap:var(--lre-s1);min-width:0}
.lre-ws-chip{display:inline-block;padding:0 var(--lre-s1);border:1px solid currentColor;border-radius:var(--lre-r-sm);font-family:var(--lre-font);font-size:var(--lre-fs-xs);font-weight:600;line-height:1.45;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;color:var(--lre-muted)}
.lre-ws-chip[data-chip=who]{color:var(--lre-fg)}
.lre-ws-chip[data-chip=pinned]{color:var(--lre-accent-text)}
.lre-ws-chip[data-chip=learned],.lre-ws-chip[data-chip=global]{color:var(--lre-pos)}
.lre-ws-chip[data-chip=system]{color:var(--lre-accent-text)}
.lre-ws-chip[data-chip=read-only],.lre-ws-chip[data-chip=unsent],.lre-ws-chip[data-chip=warn]{color:var(--lre-warn)}
.lre-ws-pane{min-width:0}
.lre-ws-editor-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--lre-s2)}
.lre-ws-saved{font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre-ws-saved.dirty{color:var(--lre-warn);font-weight:600}
.lre-ws-editor-buttons,.lre-ws-actions{display:flex;flex-wrap:wrap;gap:var(--lre-s2)}
textarea.lre-input.lre-workspace-text{min-height:min(50vh,360px);line-height:1.45;tab-size:2;overflow-wrap:anywhere}
.lre-workspace-session-text{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--lre-mono);font-size:var(--lre-fs-sm);line-height:1.45;background:var(--lre-well);border-radius:var(--lre-radius);padding:var(--lre-s2)}
.lre-ws-dialog{width:min(28rem,calc(100vw - 2 * var(--lre-s4)));max-width:100%;padding:var(--lre-s4);border:1px solid var(--lre-border);border-radius:var(--lre-r-lg);background:var(--lre-surface);color:var(--lre-fg);box-shadow:var(--lre-shadow-lg)}
.lre-ws-dialog::backdrop{background:rgba(0,0,0,.45)}
.lre-ws-dialog-form{display:flex;flex-direction:column;gap:var(--lre-s3);margin:0}
.lre-ws-dialog-title{margin:0;font-size:var(--lre-fs-lg);overflow-wrap:anywhere}
.lre-ws-path{font-family:var(--lre-mono);font-size:var(--lre-fs-sm)}
.lre-ws-dialog-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:var(--lre-s2)}
.lre-ws-turn{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.lre-ws-turn-head{margin:0;font-size:var(--lre-fs-xs);font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--lre-muted)}
.lre-ws-msgs{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}
.lre-ws-msg{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
.lre-ws-msg.to{align-items:flex-end}
.lre-ws-msg.from{align-items:flex-start}
.lre-ws-msg-meta{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s1);font-size:var(--lre-fs-xs);color:var(--lre-muted)}
.lre-ws-msg-bubble{max-width:92%;max-height:24em;overflow:auto;padding:var(--lre-s2) var(--lre-s3);border:1px solid var(--lre-border);border-radius:var(--lre-r-lg);white-space:pre-wrap;overflow-wrap:anywhere;font-size:var(--lre-fs-sm);line-height:1.5}
.lre-ws-msg.to .lre-ws-msg-bubble{background:var(--lre-accent-soft);border-color:color-mix(in srgb,var(--lre-accent) 30%,transparent);border-bottom-right-radius:var(--lre-r-sm)}
.lre-ws-msg.from .lre-ws-msg-bubble{background:var(--lre-card);border-bottom-left-radius:var(--lre-r-sm)}
.lre-ws-msg[data-lre-session-read=unread] .lre-ws-msg-bubble{border-style:dashed}
.lre-ws-msg-foot{margin:0;max-width:92%;font-size:var(--lre-fs-xs);color:var(--lre-muted);overflow-wrap:anywhere}
`;
