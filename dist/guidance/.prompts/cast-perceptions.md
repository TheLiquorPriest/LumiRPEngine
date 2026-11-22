---
description: The layout of a character's perceptions not yet turned into memory, oldest first, each in full as it reached them, with its id and the reply it is of (the `unprocessed-perceptions` of `cast:self`). Each field appears only when it was written. What they missed and how reliable a telling was are the omniscient side's account, kept on the record for the Author (cast_query reads them); they are left out here so that the character is never handed what did not reach it, and what the character's own agent is given is made without them, whatever this layout says. Their own agent is given the newest of them whole, as far as the setting cast.newlyPerceivedTokens holds - the waiting part counts the earlier ones, with their size and the self_read call that reads them. Take the waiting part out and their agent is given every one whole, as anyone else is. The same layout gives one batch of them, `unprocessed-perceptions[<from>..<to>]`, the range of ids an agent taking in a backlog hands an instance of itself; the batch part names the range and how many of it are still not taken in, or says that all of it has been. When none of the views an agent is given by cast:self has anything in it, the none part says so. It lays out what the record holds; it asks for nothing.
---
{{#name}}
### What {{name}} has perceived and not yet taken in
{{/name}}
{{#batch}}

{{#done}}Every perception of the batch {{from}}..{{to}} has been taken in.{{/done}}{{^done}}The batch {{from}}..{{to}}: {{count}} of its perceptions not yet taken in, oldest first.{{/done}}
{{/batch}}
{{#none}}

Nothing has reached them that they have not taken in.
{{/none}}
{{#waiting}}

Not shown here: {{count}} {{#earlier}}earlier {{/earlier}}{{#one}}perception{{/one}}{{^one}}perceptions{{/one}}, {{tokens}} tokens, still to be taken in. self_read reads them whole: part perceptions, id {{from}}, to {{to}}.
{{/waiting}}
{{#perceptions.items}}

[{{id}}]{{#moment}} {{moment}}{{/moment}}{{#date}} ({{date}}){{/date}}{{#message}}, message {{message}}{{/message}}
- How much reached them: {{reach}}
{{#content}}
- What reached them: {{content}}
{{/content}}
{{#knows}}
- What they now know: {{knows}}
{{/knows}}
{{#told_by}}
- Told by {{told_by}}
{{/told_by}}
{{/perceptions.items}}
