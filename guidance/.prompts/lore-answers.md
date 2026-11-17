---
description: The sentences of the lore's tools (lore_index_write), the batch an indexing run is given, the brief of the Lore page's Start indexing press and the words it shows when that press started nothing (job_refused_ and the cause, off, day_count, day_tokens, limit or agent, or job_refused where no line names the cause), the lore a character's agent is given as its own (known_entry, known_text, known_none) and the secrets it holds (held_head, then held_secret for each, with how it came by it), the readable index LORE-INDEX.md, how a secret inside an entry reads where the Author or the GM reads the entry (secret_mark), and each line of the lore map, which says how an entry came into the prompt, whether it changed since it was indexed, and which secrets it holds with who holds each. Each is data from RPE's records plus these lines, filled with that data. One line per name, a name, a colon, then its text. Change the words freely. Delete a line and that text is not shown, and the lore map then lays out each entry itself by the layout in lore-map. Delete secret_mark and a secret's text is left out of the entry where it is read.
format: lines
---
fault: {{tool}} failed by a fault of RPE's own, not by anything in your call. It is logged.
no_entries: entries cannot be read: send a list of entries, one for each entry you index.
needs: Entry {{n}} needs {{fields}}; it was not kept.
unreadable: Entry {{n}}: {{field}} cannot be read, you sent {{value}}; it was not kept.
unknown_entry: Entry {{n}}: there is no entry {{id}} in this chat's lore; it was not kept.
kept: Kept the lines of {{count}} entries.{{#left}} {{left}} entries are not indexed yet.{{/left}}{{^left}} Every entry is indexed.{{/left}}
binding: {{what}}{{#aspect}} ({{aspect}}){{/aspect}}
batch_head: Entries to index: {{count}} of the {{left}} not indexed yet.{{#held}} {{held}} more are with another indexing job.{{/held}}
batch_entry: ### [{{id}}] {{title}} (from {{source}}; revision {{revision}}{{#keys}}; keys: {{keys}}{{/keys}})
batch_text: {{text}}
batch_none: Every entry of this chat's lore is indexed.
joined: Turn {{turn}} was joined to turn {{joined}}; use that turn.
read_note: {{note}} (on turn {{turn}})
secret_mark: {{text}} [secret {{id}}{{#holders}}; held by {{holders}}{{/holders}}{{^holders}}; held by no one yet{{/holders}}]
batch_held: {{held}} entries are with another indexing job just now; none is left for you to index yet.
batch_unreadable: The entries to index could not be read: {{reason}}
no_chat: {{tool}} did nothing: this job belongs to no chat, so there is no chat's lore for it to index.
job_brief: Index this chat's lore.
job_refused_off: The indexing job was not started: jobs are switched off.
job_refused_day_count: The indexing job was not started: {{value}} jobs have started in a day{{#connection}} on {{connection}}{{/connection}}, and {{max}} is the most allowed.
job_refused_day_tokens: The indexing job was not started: jobs sent and wrote {{value}} tokens in a day, and {{max}} is the most allowed.
job_refused_limit: The indexing job was not started: its limit on {{limit}} is {{value}}, and a limit is a whole number above 0.
job_refused_agent: The indexing job was not started: there is no agent named {{agent}}, or it has no model to run on.
job_refused: The indexing job was not started ({{refused}}).
known_entry: ### [{{id}}] {{title}} (from {{source}})
known_text: {{text}}
known_none: No lore is bound to you.
held_head: The secrets you hold:
held_secret: - {{text}}{{#how_authored}} (yours from the start){{/how_authored}}{{#how_witnessed}} (you saw it for yourself){{/how_witnessed}}{{#how_told}} (you were told{{#by}} by {{by}}{{/by}}){{/how_told}}{{#how_inferred}} (you worked it out){{/how_inferred}}{{#how_guessed}} (you guessed it){{/how_guessed}}
index_file_head: # Lore index
index_file_count: The lore this chat reads: {{count}} entries{{#unindexed}}, {{unindexed}} of them not indexed yet{{/unindexed}}. Each line gives the entry's id, its title, where it is from, how it comes into the prompt and its size, then what the index says of it.
index_file_entry: - [{{id}}] {{title}} ({{source}}; {{#activation}}{{activation}}{{/activation}}{{^activation}}never by itself{{/activation}}; {{size}} characters){{#kind}}: {{kind}}{{/kind}}{{#line}}. {{line}}{{/line}}{{#defines}} Defines: {{defines}}.{{/defines}}{{#related}} Related: {{related}}.{{/related}}{{#extras}} {{extras}}.{{/extras}}{{#stale}} Changed since it was indexed.{{/stale}}{{^indexed}}{{^stale}} Not indexed yet. Keys: {{keys}}.{{/stale}}{{/indexed}}
map_in_prompt: [{{id}}] {{title}}{{#kind}} ({{kind}}){{/kind}}{{#line}}: {{line}}{{/line}}{{#defines}} Defines {{defines}}.{{/defines}}{{#extras}} {{extras}}.{{/extras}}{{#notes}} {{note}} (on turn {{turn}}).{{/notes}}{{#secrets}} Secret {{id}}{{#holders}}, held by {{holders}}{{/holders}}.{{/secrets}}{{#how_constant}} (on every turn){{/how_constant}}{{#how_keyword}} (by a key){{/how_keyword}}{{#how_vector}} (by meaning){{/how_vector}}{{#how_sticky}} (still sticky from an earlier turn){{/how_sticky}}{{#stale}} (changed since it was indexed){{/stale}}{{#keys}} (not indexed yet; keys: {{keys}}){{/keys}}
map_changed: [{{id}}] {{title}}:{{#notes}} {{note}} (on turn {{turn}}){{/notes}}{{#secrets}} Secret {{id}}{{#holders}}, held by {{holders}}{{/holders}}.{{/secrets}}
map_world: [{{id}}] {{title}}{{#kind}} ({{kind}}){{/kind}}{{#line}}: {{line}}{{/line}}{{#extras}} {{extras}}.{{/extras}}{{#notes}} {{note}} (on turn {{turn}}).{{/notes}}{{#secrets}} Secret {{id}}{{#holders}}, held by {{holders}}{{/holders}}.{{/secrets}}{{#stale}} (changed since it was indexed){{/stale}}{{#keys}} (not indexed yet; keys: {{keys}}){{/keys}}
map_bound: [{{id}}] {{title}}{{#kind}} ({{kind}}){{/kind}}{{#line}}: {{line}}{{/line}} Bound to {{bound}}.{{#extras}} {{extras}}.{{/extras}}{{#notes}} {{note}} (on turn {{turn}}).{{/notes}}{{#secrets}} Secret {{id}}{{#holders}}, held by {{holders}}{{/holders}}.{{/secrets}}{{#stale}} (changed since it was indexed){{/stale}}{{#keys}} (not indexed yet; keys: {{keys}}){{/keys}}
projection_book: RPE story notes for chat {{chat}}
projection_entry: {{title}}, as this chat's story has it now:{{#notes}} {{.}}{{/notes}}
projection_canon: {{text}}
projection_person: {{name}}{{#tier}} ({{tier}}){{/tier}} came into this chat's story{{#place}} and was last at {{place}}{{/place}}.
projection_place: {{name}}{{#kind}} ({{kind}}){{/kind}} is a place this chat's story made{{#inside}}, inside {{inside}}{{/inside}}.{{#description}} {{description}}{{/description}}
