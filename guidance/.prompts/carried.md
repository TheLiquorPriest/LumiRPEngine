---
description: How what a session carries from its earlier turns is laid out for the Author, as text after the assembled prompt. It asks for nothing. Its header's `record` names the file, in each turn's folder, that holds the Author's own record of that turn, which is what the records mode carries.
record: output/record.md
---
# Carried from earlier in this scene

{{#continuing}}
What you did in this scene's earlier turns, oldest first. This is your own work, already done. It is not part of the chat.
{{/continuing}}
{{#records}}
Your records of this scene's earlier turns, oldest first.
{{/records}}
{{#summary}}

## Before that, in short

{{summary}}
{{/summary}}
{{#turns}}

## Turn {{n}}{{#story_time}}, {{story_time}}{{/story_time}}
{{#text}}

{{text}}
{{/text}}
{{#items}}
{{#intent}}

Your intent record:

{{intent}}
{{/intent}}
{{#call}}

You called `{{tool}}` with {{args}}.
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
