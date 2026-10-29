// GM → Workspace (frontend/gm/workspace.tsx): a file's text to edit, in the shared monospace text
// area made tall enough to read a note, and the move row. Built on the tokens only.

export const WORKSPACE_CSS = `
textarea.lre-input.lre-workspace-text{min-height:min(50vh,360px);line-height:1.45;tab-size:2;overflow-wrap:anywhere}
.lre-workspace-move{display:flex;flex-wrap:wrap;align-items:flex-start;gap:var(--lre-s2);min-width:0}
.lre-workspace-move>.lre-input{flex:1 1 12rem;min-width:0;font-family:var(--lre-mono);font-size:var(--lre-fs-sm)}
.lre-workspace-move>.lre-btn{flex:none}
`;
