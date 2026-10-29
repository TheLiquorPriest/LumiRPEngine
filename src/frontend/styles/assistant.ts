// GM → Assistant (frontend/gm/assistant.tsx): the thread, your messages set off to the right, each
// answer with its folded trace and its proposal card, the answer under way in GM gold, and the
// message box kept above GM mode's bar (and above an edit's notice when one shows). Built on the
// tokens and the shared atoms only.

export const ASSISTANT_CSS = `
.lre-gm-assist-tab{display:flex;flex-direction:column;min-width:0}
.lre-gm-assist{gap:var(--lre-s3)}
.lre-gm-assist-tools{display:flex;justify-content:flex-end;gap:var(--lre-s2);min-width:0}
.lre-gm-assist-thread{display:flex;flex-direction:column;gap:var(--lre-s4);min-width:0}
.lre-gm-assist-msg{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.lre-gm-assist-msg.mine{align-self:flex-end;max-width:min(100%,34em);padding:var(--lre-s2) var(--lre-s3);border-radius:var(--lre-r-lg);background:var(--lre-well);box-shadow:inset 0 0 0 1px var(--lre-hairline)}
.lre-gm-assist-msg-head{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s1) var(--lre-s2);min-width:0;font-size:var(--lre-fs-sm)}
.lre-gm-assist-msg-who{font-weight:600}
.lre-gm-assist-msg-at{margin-left:auto;color:var(--lre-muted);font-variant-numeric:tabular-nums}
.lre-gm-assist-msg-text{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.lre-gm-assist-msg-why{margin:0;font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-gm-assist-msg-usage{font-size:var(--lre-fs-xs);color:var(--lre-muted);font-variant-numeric:tabular-nums}
.lre-gm-assist-trace>.lre-disclosure>summary{min-height:32px;font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre-gm-assist-trace-rows{margin:0;padding:0 0 0 var(--lre-s3);list-style:none;display:flex;flex-direction:column;gap:var(--lre-s1);border-left:2px solid var(--lre-hairline)}
.lre-gm-assist-trace-rows>li{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px var(--lre-s2);min-width:0;font-size:var(--lre-fs-sm)}
.lre-gm-assist-trace-tool{font:var(--lre-fs-sm)/1.3 var(--lre-mono)}
.lre-gm-assist-trace-args{flex:1 1 12em;min-width:0;color:var(--lre-muted);overflow-wrap:anywhere}
.lre-gm-assist-trace-ms{flex:none;color:var(--lre-muted);font-variant-numeric:tabular-nums}
.lre-gm-assist-trace-error{flex:1 1 100%;color:var(--lre-neg);overflow-wrap:anywhere}
.lre-gm-assist-proposal{min-width:0}
.lre-gm-assist-ops{display:flex;flex-direction:column;min-width:0}
.lre-gm-assist-op{display:flex;align-items:flex-start;gap:var(--lre-s2);min-width:0;padding:var(--lre-s2) 0}
.lre-gm-assist-op:first-child{padding-top:0}
.lre-gm-assist-op:last-child{padding-bottom:0}
.lre-gm-assist-op+.lre-gm-assist-op{border-top:1px solid var(--lre-hairline)}
.lre-gm-assist-op>.lre-check{margin:calc(-1 * var(--lre-s2)) 0 calc(-1 * var(--lre-s2)) calc(-1 * var(--lre-s2))}
.lre-gm-assist-op-mark{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;min-height:22px;color:var(--lre-muted)}
.lre-gm-assist-op-mark.lre-pos{color:var(--lre-pos)}
.lre-gm-assist-op-mark.lre-neg{color:var(--lre-neg)}
.lre-gm-assist-op-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;overflow-wrap:anywhere}
.lre-gm-assist-op>.lre-check+.lre-gm-assist-op-body{padding-top:var(--lre-s1)}
.lre-gm-assist-op-note{font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre-gm-assist-op-note.lre-neg{color:var(--lre-neg)}
.lre-gm-assist-actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2);min-width:0}
.lre-gm-assist-run{display:flex;align-items:center;gap:var(--lre-s2);min-width:0;padding:var(--lre-s2) var(--lre-s2) var(--lre-s2) var(--lre-s3);border:1px solid color-mix(in srgb,var(--lre-gm) 35%,transparent);border-radius:var(--lre-r-lg);background:var(--lre-gm-soft);color:var(--lre-gm-text)}
.lre-gm-assist-run>.lre-icon{flex:none}
.lre-gm-assist-run-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.lre-gm-assist-run-label{font-weight:600;overflow-wrap:anywhere}
.lre-gm-assist-run-tokens{font-size:var(--lre-fs-sm);color:var(--lre-muted);font-variant-numeric:tabular-nums}
.lre-gm-assist-run>.lre-btn{flex:none}
.lre-gm-assist-compose{position:sticky;bottom:calc(var(--lre-gm-nav-h,0px) + var(--lre-s2));z-index:1;display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0;padding:var(--lre-s2);border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-bar-bg);box-shadow:var(--lre-shadow-sm)}
.lre-gm:has(.lre-gm-notice) .lre-gm-assist-compose{bottom:calc(var(--lre-gm-nav-h,0px) + var(--lre-gm-notice-h,0px) + 2 * var(--lre-s2))}
.lre-gm-assist-compose>textarea.lre-input{resize:vertical;min-height:4.5em}
.lre-gm-assist-compose-row{display:flex;align-items:center;justify-content:flex-end;gap:var(--lre-s2);min-width:0}
.lre-gm-assist-compose-row>.lre-gm-note{flex:1;min-width:0;overflow-wrap:anywhere}
.lre-gm-assist-compose-row>.lre-btn{flex:none}
`;
