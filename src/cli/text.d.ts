// Markdown imported as text (`import guide from "…/AGENT-GUIDE.md" with { type: "text" }`): Bun
// bundles the file's contents into dist/lumirpengine.js as a string.
declare module "*.md" {
  const text: string;
  export default text;
}
