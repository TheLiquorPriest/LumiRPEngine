---
description: The layout of `persona.md` and `character.md` in each turn's folder. The player's persona and the character card as they appear in this prompt, each part under its block's name in the preset. It lays them out; it asks for nothing.
---
{{#persona}}
# The player's persona{{#name}}: {{name}}{{/name}}
{{/persona}}
{{#character}}
# The character{{#name}}: {{name}}{{/name}}
{{/character}}
{{#blocks}}

## {{name}}

{{text}}
{{/blocks}}
