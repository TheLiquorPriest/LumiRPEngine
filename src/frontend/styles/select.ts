// A list's multi-select mode (frontend/multi-select.tsx): the row's box and the bar under the list,
// in GM mode and Build alike, opaque as the tab bar is so the rows it's pinned over don't show
// through; and a bulk change's line on how the picked stand now. Built on the tokens only.

export const SELECT_CSS = `
.lre-pick{flex:none;width:22px;height:22px;margin:0;accent-color:var(--lre-accent);pointer-events:none}
.lre-selectbar{position:sticky;bottom:0;z-index:1;display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0;padding:var(--lre-s2) var(--lre-s3);border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-bar-bg);box-shadow:var(--lre-shadow-sm)}
.lre-selectbar-row{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s1) var(--lre-s2);min-width:0}
.lre-selectbar-count{flex:1 1 auto;min-width:0;font-weight:600;font-variant-numeric:tabular-nums}
.lre-selectbar-groups{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s1) var(--lre-s2);min-width:0}
.lre-selectbar-groups-label{font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre-selectbar-actions{display:flex;flex-wrap:wrap;gap:var(--lre-s2);min-width:0}
.lre-selectbar-actions>.lre-btn{flex:1 1 auto}
.lre-batch-now{margin:0;font-size:var(--lre-fs-sm);font-variant-numeric:tabular-nums}
`;
