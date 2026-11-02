// GM → Live (frontend/gm/live.tsx): a turn's agents at work as a terminal-like feed. Monospace,
// on a sunken panel; each group folds under its summary line; a long text folds under its first
// line; each tool call is a raised card whose caret's colour carries how it stands (muted running,
// accent done, negative failed), its arguments in one line beside its name, folding over its
// arguments laid out and its result. Statuses and failures in the tone tokens. Built on the tokens only.

export const LIVE_CSS = `
.lre-live{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}
.lre-live-head{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
.lre-live-head>.lre-btn{align-self:flex-start}
.lre-live-title,.lre-live-state{margin:0;display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2)}
.lre-live-said{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.lre-live-feed{list-style:none;margin:0;padding:var(--lre-s2);display:flex;flex-direction:column;gap:var(--lre-s2);background:var(--lre-well);border:1px solid var(--lre-border);border-radius:var(--lre-radius);font-family:var(--lre-mono);font-size:var(--lre-fs-sm);line-height:1.45;min-width:0}
.lre-live-item{min-width:0}
.lre-live-group{border-left:2px solid var(--lre-border);padding-left:var(--lre-s2);min-width:0}
.lre-live-group[data-status=working]{border-left-color:var(--lre-accent)}
.lre-live-group[data-status=failed]{border-left-color:var(--lre-neg)}
.lre-live-group[data-status=stopped]{border-left-color:var(--lre-warn)}
.lre-live-group-head{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2);cursor:pointer;min-width:0}
.lre-live-group-body{display:flex;flex-direction:column;gap:var(--lre-s1);padding-top:var(--lre-s1);min-width:0}
.lre-live-agent{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
.lre-live-agent-head{display:flex;flex-wrap:wrap;gap:var(--lre-s2);align-items:baseline}
.lre-live-model{font-weight:600}
.lre-live-dim{color:var(--lre-muted)}
.lre-live-warn{color:var(--lre-neg)}
.lre-live-line{margin:0;overflow-wrap:anywhere}
.lre-live-arrow{color:var(--lre-accent)}
.lre-live-block>summary{display:flex;gap:var(--lre-s2);cursor:pointer;min-width:0}
.lre-live-block-head{flex:none}
.lre-live-preview{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--lre-muted)}
.lre-live-block[open] .lre-live-preview{display:none}
.lre-live-text{margin:var(--lre-s1) 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}
.lre-live-result.failed>summary{color:var(--lre-neg)}
.lre-live-reasoning .lre-live-text{color:var(--lre-muted);font-style:italic}
.lre-live-tools{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
.lre-live-tool{border:1px solid var(--lre-border);border-radius:var(--lre-r-sm);background:var(--lre-card);overflow:hidden;min-width:0;transition:border-color var(--lre-fast)}
.lre-live-tool:hover{border-color:var(--lre-accent-soft)}
.lre-live-tool-head{display:flex;align-items:center;gap:var(--lre-s2);padding:var(--lre-s1) var(--lre-s2);min-height:calc(var(--lre-tap) - var(--lre-s2));cursor:pointer;user-select:none;list-style:none;min-width:0}
.lre-live-tool-head::-webkit-details-marker{display:none}
.lre-live-tool-head:hover{background:var(--lre-hover)}
.lre-live-tool-caret{flex:none;color:var(--lre-muted);transition:transform var(--lre-fast)}
.lre-live-tool[open] .lre-live-tool-caret{transform:rotate(90deg)}
.lre-live-tool.is-done .lre-live-tool-caret{color:var(--lre-accent)}
.lre-live-tool.is-error .lre-live-tool-caret,.lre-live-tool.is-error .lre-live-tool-state{color:var(--lre-neg)}
.lre-live-tool-name{flex:none;font-weight:600;color:var(--lre-accent-text)}
.lre-live-tool-preview{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--lre-muted)}
.lre-live-tool-state{flex:none;font-size:var(--lre-fs-xs);font-weight:600;letter-spacing:.04em;text-transform:uppercase;padding:0 var(--lre-s1);border:1px solid currentColor;border-radius:var(--lre-r-sm);color:var(--lre-muted)}
.lre-live-tool-body{border-top:1px solid var(--lre-hairline);padding:var(--lre-s2);display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
.lre-live-tool-body>.lre-live-text{margin:0;max-height:24em;overflow:auto;background:var(--lre-well);border-radius:var(--lre-r-sm);padding:var(--lre-s1) var(--lre-s2)}
.lre-live-tool-label{margin:0;font-size:var(--lre-fs-xs);letter-spacing:.04em;text-transform:uppercase;color:var(--lre-muted)}
.lre-live-writes{margin:0;padding-left:var(--lre-s3)}
.lre-live-write[data-lre-live-write=refused]{color:var(--lre-neg)}
.lre-live-mark{color:var(--lre-muted);text-align:center}
.lre-live-mark.failed{color:var(--lre-neg);text-align:left}
.lre-live-mark.review{color:var(--lre-fg);text-align:left}
.lre-live-mark.review.failed{color:var(--lre-neg)}
.lre-live-review{margin:var(--lre-s1) 0 0;padding-left:var(--lre-s3);color:var(--lre-fg);overflow-wrap:anywhere}
.lre-live-follow{position:sticky;bottom:var(--lre-s2);display:flex;justify-content:center;pointer-events:none}
.lre-live-follow>.lre-btn{pointer-events:auto}
`;
