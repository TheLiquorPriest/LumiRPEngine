---
description: How what a session carries from its earlier turns is laid out for the lead, as text after the assembled prompt, and how the turns a compaction summarizes are laid out for its call, where `compacting` is set. It asks for nothing. `summary` is the summary the turns after it follow - the newest of a compaction's, or before any compaction the one the session opened with; once a session is compacted, `opened` is the one it opened with, carried beside the compaction's and never sent to a compaction's call. Its header's `record` names the file, in each turn's folder, that holds the lead's own record of that turn, which is what the records mode carries.
record: output/record.md
---
{{^compacting}}
# Carried from earlier in this scene
{{/compacting}}
{{#compacting}}
# Earlier turns of this scene, to be summarized
{{/compacting}}

{{#continuing}}
{{^compacting}}
What you did in this scene's earlier turns, oldest first. This is your own work, already done. It is not part of the chat.
{{/compacting}}
{{#compacting}}
What the lead did in these turns, oldest first: its intent records, its calls and what came back.
{{/compacting}}
{{/continuing}}
{{#records}}
{{^compacting}}
Your records of this scene's earlier turns, oldest first.
{{/compacting}}
{{#compacting}}
The lead's records of these turns, oldest first.
{{/compacting}}
{{/records}}
{{#opened}}

## Where this scene began

{{opened}}
{{/opened}}
{{#summary}}

{{^compacting}}
## Before that, in short
{{/compacting}}
{{#compacting}}
## The summary so far, which these turns follow
{{/compacting}}

{{summary}}
{{/summary}}
{{#turns}}

## Turn {{n}}
{{#text}}

{{text}}
{{/text}}
{{#items}}
{{#intent}}

{{^compacting}}Your intent record:{{/compacting}}{{#compacting}}The lead's intent record:{{/compacting}}

{{intent}}
{{/intent}}
{{#call}}

{{^compacting}}You called{{/compacting}}{{#compacting}}The lead called{{/compacting}} `{{tool}}` with {{args}}.
{{#result}}
{{^error}}It answered:{{/error}}{{#error}}It failed:{{/error}}

{{result}}
{{/result}}
{{#reports}}
- {{.}}
{{/reports}}
{{/call}}
{{/items}}
{{/turns}}
