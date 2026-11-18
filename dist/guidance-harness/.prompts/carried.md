---
description: How what a session carries from its earlier turns is laid out for the lead, as text after the assembled prompt, and how the turns a compaction summarizes are laid out for its call, where `compacting` is set. It asks for nothing. `summary` is the summary the turns after it follow - the newest of a compaction's, or before any compaction the one the session opened with; once a session is compacted, `opened` is the one it opened with, carried beside the compaction's and never sent to a compaction's call. `run` lays out an agent's own older work in its run for a summary call (`compacting`), and the summary that then stands in its place; its one entry has no number, and its items are what the agent wrote (`said`), its calls, and what it was told (`heard`). Its header's `record` names the file, in each turn's folder, that holds the lead's own record of that turn, which is what the records mode carries.
record: output/record.md
---
{{^run}}
{{^compacting}}
# Carried from earlier in this scene
{{/compacting}}
{{#compacting}}
# Earlier turns of this scene, to be summarized
{{/compacting}}
{{/run}}
{{#run}}
{{^compacting}}
# Your earlier work in this run, in short
{{/compacting}}
{{#compacting}}
# This agent's earlier work in this run, to be summarized
{{/compacting}}
{{/run}}

{{#run}}
{{#compacting}}
What the agent wrote, called and was told in its older calls of this run, oldest first. Its newest calls follow the summary as they are.
{{/compacting}}
{{/run}}
{{#continuing}}
{{^compacting}}
What you did in this scene's earlier turns, oldest first. This is your own work, already done, and what it read and found still stands. It is not part of the chat.
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
{{#compacting}}

## The summary so far, which these turns follow

{{/compacting}}
{{^compacting}}
{{^run}}

## Before that, in short

{{/run}}
{{/compacting}}
{{summary}}
{{/summary}}
{{#turns}}
{{#n}}

## Turn {{n}}
{{/n}}
{{#text}}

{{text}}
{{/text}}
{{#items}}
{{#intent}}

{{^compacting}}Your intent record:{{/compacting}}{{#compacting}}The lead's intent record:{{/compacting}}

{{intent}}
{{/intent}}
{{#said}}

{{^compacting}}You wrote:{{/compacting}}{{#compacting}}The agent wrote:{{/compacting}}

{{said}}
{{/said}}
{{#heard}}

{{^compacting}}You were told:{{/compacting}}{{#compacting}}The agent was told:{{/compacting}}

{{heard}}
{{/heard}}
{{#call}}

{{^compacting}}You called{{/compacting}}{{#compacting}}{{#run}}The agent called{{/run}}{{^run}}The lead called{{/run}}{{/compacting}} `{{tool}}` with {{args}}.
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
