---
description: The words of the window tool's answers - the list of what an agent's window holds, what becomes of each thing it lets go of or brings back (whole, or with what inside it stays let go), its handoff, what the change spares and costs, and why a change cannot be made - and the line that stands in the place of a thing let go, with or without the agent's own note. A lore entry's line also gives the line the host's index of the lore keeps for it, where it keeps one, and the lore_read call that reads it whole. One line per name, a name, a colon, then its text. Change the words freely. Delete a line and that answer is given with no words; delete line or note_line and a thing let go leaves nothing in its place.
format: lines
---
line: [Let go: {{name}}, {{tokens}} tokens{{#title}}, {{title}}{{/title}}{{#tool}}, the result of {{tool}}{{/tool}}. window {"bring_back": ["{{name}}"]} brings it back whole{{#lore}}, and lore_read {"ids": ["{{id}}"]} reads it{{/lore}}.{{#gist}} The lore's index says of it - {{gist}}{{/gist}}]
note_line: [Let go: {{name}}, {{tokens}} tokens. window {"bring_back": ["{{name}}"]} brings it back whole{{#lore}}, and lore_read {"ids": ["{{id}}"]} reads it{{/lore}}. Your note: {{note}}]
ledger: Your window as of your last request, {{tokens}} tokens with your opening instructions and tools, holds {{count}} things:
nothing: Your window holds nothing after your opening instructions and tools.
item: {{name}}: {{#prompt}}a slice of the prompt ({{slice}}){{/prompt}}{{#lore}}a lore entry, {{title}}{{/lore}}{{#briefing}}a section of the briefing{{/briefing}}{{#given}}an item given by name{{/given}}{{#carry}}what the session carries{{/carry}}{{#call}}the result of {{tool}}{{/call}}{{#work}}your work from call {{from}} to call {{to}}{{/work}}, {{tokens}} tokens, age {{age}}, {{#carried}}carried{{/carried}}{{#let_go}}let go{{#note}} with your note{{/note}}{{/let_go}}{{#inside}}inside {{within}}, which is let go{{/inside}}{{#gone}}not in your window{{#handoff}} since your handoff{{/handoff}}{{#summary}} since a compaction summarized it{{/summary}}{{/gone}}.
let_go: {{name}} is let go from your next call: its {{tokens}} tokens become a line of {{line}}.
noted: {{name}} is let go from your next call, your note in its place: its {{tokens}} tokens become {{line}}.
back: {{name}} comes back {{^partly}}whole {{/partly}}at your next call{{#partly}}, with {{inside}} inside it still let go{{/partly}}: its line of {{line}} tokens becomes its {{tokens}}.
back_after: {{name}} comes back whole at your next call, after your work so far: {{added}} tokens more.
unknown: {{name}} is not in your window as of your last request; window with nothing asked lists what is.
already: {{name}} is let go already.
not_let_go: {{name}} is not let go: it is carried whole.
inside: {{name}} stands inside {{within}}, which is let go; bring that back first.
reversed: {{name}} names its last call before its first.
twice: {{name}} is asked for twice before your next call; the first stands.
handoff: From your next call you go on in a fresh window: your opening instructions, your tools and your note{{#keeps}}, with {{kept}} whole{{/keeps}}. Everything else leaves the window and can be brought back.
handoff_unknown: {{name}} is not in your window, so it is not kept.
spared: From your next call each call is spared {{spared}} tokens ({{saved}} at the cached weight of {{cached_weight}}), and that call writes {{following}} tokens to the cache again, once ({{cost}} at the write weight of {{write_weight}}).
added: From your next call each call carries {{added}} tokens more, and that call writes {{following}} tokens to the cache again, once ({{cost}} at the write weight of {{write_weight}}).
no_window: There is no window of yours to change here.
