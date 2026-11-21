---
description: The layout of what a character carried over from the earlier build and has not yet been filed (the `imported` of `cast:self`). Each old mind file whole, word for word, under its name, outside every budget; and the notes the older minds pack kept of them (its summary, notes with how much each mattered, commitments, what they witnessed or were told, and their last mind), as that pack wrote them. A file marked filed is no longer here. When none of the views an agent is given by cast:self has anything in it, the none part says so. It lays out what the record holds; it asks for nothing.
---
### {{name}}'s old mind files, as they were written
{{#none}}

No old mind files of theirs are waiting to be filed.
{{/none}}
{{#files.items}}

#### {{file}}

{{text}}
{{/files.items}}
{{#minds}}

#### The notes the older minds pack kept of them
{{#summary}}

Summary: {{summary}}
{{/summary}}
{{#notes}}

- Note (mattered {{salience}} of 5{{#date}}, {{date}}{{/date}}): {{text}}
{{/notes}}
{{#commitments}}

- Commitment, {{kind}}, {{status}}{{#with}} (with {{with}}){{/with}}{{#due}}, due {{due}}{{/due}}: {{text}}
{{/commitments}}
{{#witness}}

- {{how}}{{#by}} from {{by}}{{/by}}{{#place}} at {{place}}{{/place}}{{#date}}, {{date}}{{/date}}: {{what}}
{{/witness}}
{{#mind}}

Their last mind{{#date}}, {{date}}{{/date}}{{#place}}, at {{place}}{{/place}}, {{level}}:

{{monologue}}
{{#intent}}

What they meant to do: {{intent}}
{{/intent}}
{{#depiction}}

How they seemed: {{depiction}}
{{/depiction}}
{{#reactions}}
- {{.}}
{{/reactions}}
{{/mind}}
{{/minds}}
