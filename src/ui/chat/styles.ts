// The chat surfaces' stylesheet (put in the page by the extension shell's mount): the rules for what RPE
// draws inside Lumiverse's chat, all under `rpe-chat-` and drawn on the `.lre` tokens, which follow
// Lumiverse's theme. A surface's root carries `lre`, so the tokens reach it.

export const CHAT_SURFACES_CSS = `
.rpe-chat-controls{display:inline-flex;align-items:center;gap:var(--lre-s1);min-width:0;max-width:100%}
.rpe-chat-ctl{position:relative;display:inline-flex;min-width:0}
.rpe-chat-ctl-btn{min-height:32px;padding:2px var(--lre-s2);border-radius:var(--lre-r-pill);border:1px solid var(--lre-border);background:var(--lre-subtle);font-size:var(--lre-fs-sm);display:inline-flex;align-items:center;gap:var(--lre-s1);max-width:100%;min-width:32px;line-height:1.2}
.rpe-chat-ctl-btn[data-set=true]{border-color:var(--lre-accent);background:var(--lre-accent-soft)}
.rpe-chat-ctl-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rpe-chat-ctl-value{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:9em}
.rpe-chat-pop{position:fixed;z-index:2147483000;box-sizing:border-box;width:min(20rem,calc(100vw - 16px));max-height:min(60vh,26rem);overflow:auto;overscroll-behavior:contain;padding:var(--lre-s2);border-radius:var(--lre-r-lg);border:1px solid var(--lre-border);background:var(--lre-surface);color:var(--lre-fg);box-shadow:var(--lre-shadow-lg);display:flex;flex-direction:column;gap:var(--lre-s1)}
.rpe-chat-pop-head{font-size:var(--lre-fs-xs);font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--lre-muted);padding:0 var(--lre-s1)}
.rpe-chat-opt{display:flex;flex-direction:column;align-items:flex-start;gap:0;min-height:var(--lre-tap);padding:var(--lre-s1) var(--lre-s2);border-radius:var(--lre-r);border:1px solid transparent;background:transparent;text-align:left;width:100%}
.rpe-chat-opt:hover{background:var(--lre-hover)}
.rpe-chat-opt[aria-checked=true]{border-color:var(--lre-accent);background:var(--lre-accent-soft)}
.rpe-chat-opt-name{font-weight:600}
.rpe-chat-opt-about{font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.rpe-chat-words{width:100%;min-height:4.5em;resize:vertical;font:inherit;padding:var(--lre-s2);border-radius:var(--lre-r);border:1px solid var(--lre-border);background:var(--lre-well);color:inherit}
.rpe-chat-row{display:flex;flex-wrap:wrap;gap:var(--lre-s2);justify-content:flex-end}
.rpe-chat-note{font-size:var(--lre-fs-sm);color:var(--lre-neg);padding:0 var(--lre-s1);overflow-wrap:anywhere}
`;
