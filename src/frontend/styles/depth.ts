// The depth views (DEPTH-PLAN §7): GM → Minds on a depth chat, GM → Depth (Notebook, Drafts,
// Treatments, Archive, Bootstrap), GM → This chat → Depth and Settings → Depth. Mobile first at 390
// px: one column, every control at least a tap high, long texts wrapping; the spot checks' made/source
// pairs stack and go side by side only where there is room.

export const DEPTH_CSS = `
.lre .lre-depth-note{margin:0;overflow-wrap:anywhere}
.lre .lre-depth-subhead{margin:var(--lre-s2) 0 0;font-size:var(--lre-fs-sm);font-weight:600;color:var(--lre-muted)}
.lre .lre-depth-md{min-width:0;overflow-wrap:anywhere}
.lre .lre-depth-md>:first-child{margin-top:0}
.lre .lre-depth-md>:last-child{margin-bottom:0}
.lre .lre-depth-editor{width:100%;min-height:10em;font-family:inherit;resize:vertical}
.lre .lre-depth-threshold{width:100%;resize:vertical}
.lre .lre-depth-reasoning,.lre .lre-depth-pov-text,.lre .lre-depth-answer-text,.lre .lre-depth-snippet{margin:0;white-space:pre-line;overflow-wrap:anywhere}
.lre .lre-depth-snippet{color:var(--lre-muted)}
.lre .lre-depth-quote{margin:0;font-style:italic;overflow-wrap:anywhere}
.lre .lre-depth-beats{display:flex;flex-direction:column;gap:var(--lre-s1);margin:0;padding:0;list-style:none}
.lre .lre-depth-beat{display:flex;align-items:center;gap:var(--lre-s2);min-height:var(--lre-tap);min-width:0}
.lre .lre-depth-beat-text{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;font-size:var(--lre-fs-sm)}
.lre .lre-depth-beat>.lre-btn{flex:none}
.lre .lre-depth-status{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2)}
.lre .lre-depth-changes{display:flex;flex-direction:column;gap:var(--lre-s1);margin:0;padding:0;list-style:none}
.lre .lre-depth-changes>li{display:flex;flex-wrap:wrap;justify-content:space-between;gap:var(--lre-s1) var(--lre-s3)}
.lre .lre-depth-change-label{font-weight:600}
.lre .lre-depth-change-move{color:var(--lre-muted);font-size:var(--lre-fs-sm)}
.lre .lre-depth-role{display:flex;flex-direction:column;gap:var(--lre-s2)}
.lre .lre-depth-model{display:flex;flex-direction:column;gap:var(--lre-s2);padding-left:var(--lre-s3);border-left:2px solid var(--lre-border)}
.lre .lre-depth-span{display:grid;grid-template-columns:1fr 1fr;gap:var(--lre-s2)}
.lre .lre-depth-span .lre-input{width:100%;min-width:0}
.lre .lre-depth-cap{gap:var(--lre-s2)}
.lre .lre-depth-notes{margin:0;padding-left:1.2em;font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre .lre-depth-log{margin:0;padding-left:1.6em;font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre .lre-depth-spot-item{display:flex;flex-direction:column;gap:var(--lre-s2);padding:var(--lre-s2) 0;border-top:1px solid var(--lre-border)}
.lre .lre-depth-spot-item:first-child{border-top:0;padding-top:0}
.lre .lre-depth-spot-item[data-lre-marked=right]{border-left:3px solid var(--lre-pos);padding-left:var(--lre-s2)}
.lre .lre-depth-spot-item[data-lre-marked=wrong]{border-left:3px solid var(--lre-neg);padding-left:var(--lre-s2)}
.lre .lre-depth-spot-head{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2)}
.lre .lre-depth-spot-kind{font-weight:600}
.lre .lre-depth-spot-pair{display:grid;grid-template-columns:1fr;gap:var(--lre-s2)}
.lre .lre-depth-spot-pair p{margin:0;overflow-wrap:anywhere}
.lre .lre-depth-spot-made,.lre .lre-depth-spot-source{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0;padding:var(--lre-s2);border-radius:var(--lre-r-lg);background:var(--lre-card)}
.lre .lre-depth-spot-source{border:1px dashed var(--lre-border)}
.lre .lre-depth-at{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--lre-s2);min-width:0}
.lre .lre-depth-draft-beats{display:flex;flex-direction:column;gap:var(--lre-s2);margin:0;padding:0;list-style:none}
.lre .lre-depth-draft-beat{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0;padding-top:var(--lre-s2);border-top:1px solid var(--lre-border)}
.lre .lre-depth-draft-beat:first-child{padding-top:0;border-top:0}
.lre .lre-depth-put{gap:var(--lre-s1);padding-left:var(--lre-s2);border-left:3px solid var(--lre-warn)}
.lre .lre-depth-put-head{font-weight:600}
.lre .lre-depth-ceiling,.lre .lre-depth-allowance{gap:var(--lre-s1);min-width:0}
.lre .lre-depth-ceiling-label{font-weight:600;overflow-wrap:anywhere}
@media (min-width:640px){.lre .lre-depth-spot-pair{grid-template-columns:1fr 1fr}}
`;
