---
description: The sentences of the lore's tools (lore_index_write), the batch an indexing run is given, the lore a character's agent is given as its own, the readable index LORE-INDEX.md, and each line of the lore map. Each is data from RPE's records plus these lines, filled with that data. One line per name, a name, a colon, then its text. Change the words freely. Delete a line and that text is not shown.
format: lines
---
no_entries: entries cannot be read: send a list of entries, one for each entry you index.
needs: Entry {{n}} needs {{fields}}; it was not kept.
unreadable: Entry {{n}}: {{field}} cannot be read, you sent {{value}}; it was not kept.
unknown_entry: Entry {{n}}: there is no entry {{id}} in this chat's lore; it was not kept.
kept: Kept the lines of {{count}} entries.{{#left}} {{left}} entries are not indexed yet.{{/left}}{{^left}} Every entry is indexed.{{/left}}
binding: {{what}}{{#aspect}} ({{aspect}}){{/aspect}}
batch_head: Entries to index: {{count}} of the {{left}} not indexed yet.
batch_entry: ### [{{id}}] {{title}} (from {{source}}; revision {{revision}}{{#keys}}; keys: {{keys}}{{/keys}})
batch_text: {{text}}
batch_none: Every entry of this chat's lore is indexed.
known_entry: ### [{{id}}] {{title}} (from {{source}})
known_text: {{text}}
known_none: No lore is bound to you.
index_file_head: # Lore index
index_file_count: The lore this chat reads: {{count}} entries{{#unindexed}}, {{unindexed}} of them not indexed yet{{/unindexed}}. Each line gives the entry's id, its title, where it is from, how it comes into the prompt and its size, then what the index says of it.
index_file_entry: - [{{id}}] {{title}} ({{source}}; {{#activation}}{{activation}}{{/activation}}{{^activation}}never by itself{{/activation}}; {{size}} characters){{#kind}}: {{kind}}{{/kind}}{{#line}}. {{line}}{{/line}}{{#defines}} Defines: {{defines}}.{{/defines}}{{#related}} Related: {{related}}.{{/related}}{{#stale}} Changed since it was indexed.{{/stale}}{{^indexed}}{{^stale}} Not indexed yet. Keys: {{keys}}.{{/stale}}{{/indexed}}
map_in_prompt: [{{id}}] {{title}}{{#kind}} ({{kind}}){{/kind}}{{#line}}: {{line}}{{/line}}{{#defines}} Defines {{defines}}.{{/defines}}{{#keys}} (not indexed yet; keys: {{keys}}){{/keys}}
map_changed: [{{id}}] {{title}}:{{#notes}} {{.}}{{/notes}}
map_world: [{{id}}] {{title}}{{#kind}} ({{kind}}){{/kind}}{{#line}}: {{line}}{{/line}}{{#keys}} (not indexed yet; keys: {{keys}}){{/keys}}
map_bound: [{{id}}] {{title}}{{#kind}} ({{kind}}){{/kind}}{{#line}}: {{line}}{{/line}} Bound to {{bound}}.{{#keys}} (not indexed yet; keys: {{keys}}){{/keys}}
projection_book: RPE story notes for chat {{chat}}
projection_entry: {{title}}, as this chat's story has it now:{{#notes}} {{.}}{{/notes}}
