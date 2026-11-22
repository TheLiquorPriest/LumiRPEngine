---
description: The layout of what a character carried over from the earlier build and has not yet been filed (the `imported` of `cast:self`). Each old mind file whole, word for word, under its name; and the notes the older minds pack kept of them (its summary, notes with how much each mattered, commitments, what they witnessed or were told, and their last mind), as that pack wrote them. Their own agent is given them whole only as far as the setting cast.importedTokens holds, which as shipped is none - the listed part names the others, each with its size, and the self_read call that reads one. Take the listed part out and their agent is given every one whole, as anyone else is. A file marked filed is no longer here. When none of the views an agent is given by cast:self has anything in it, the none part says so. It lays out what the record holds; it asks for nothing.
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
{{#listed}}

Not shown here: {{count}} {{#one}}file{{/one}}{{^one}}files{{/one}}, {{tokens}} tokens. self_read reads one whole: part imported, name and the file's name.
{{/listed}}
{{#listed.files.items}}
- {{file}}: {{tokens}} tokens
{{/listed.files.items}}
{{#listed.minds}}
- The notes the older minds pack kept of them (minds): {{tokens}} tokens
{{/listed.minds}}
