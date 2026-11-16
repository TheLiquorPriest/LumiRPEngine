---
description: The layout of the briefing the Author is given at the start of every turn. Each part appears only when there is something to show. Take a part out and it is no longer shown. What the player's hooks added at the turn's start comes after what the rules say, under its own heading. Its last part is the reply contract again, as the files stand now (the opening block holds it as it stood when the session opened), so that it is the last thing read before the reply is written, with the intent file's whole path where the Author writes its intent record to a file itself; take that part out and the contract is in the opening block only. It lays facts out; it asks for nothing. The counts under the turn's own lines are facts the template names - the chat's story choice (story.from, story.newest), a previous run stopped (previous.run.stopped), lore entries not indexed (lore.unindexed), a base older than its source (cast.base.older), growth proposed (cast.growth.proposed) and messages left out of the prompt with no summary (history.unsummarized). A count of 0 is not shown, and a line taken out is a count that is no longer read. Its header's on_stage_views names which of the cast's views of the characters on stage are shown under On stage, in that order - a view by its name (history), or a view of one casting (history:principal); take a name out and that view is no longer given.
on_stage_views:
  - history:principal
  - imported:supporting
---
# Briefing for this turn

{{#turn}}
- This turn: {{turn.kind}}{{#turn.speaker}}, replying as {{turn.speaker}}{{/turn.speaker}}{{#turn.story_time}}. Story time: {{turn.story_time}}{{/turn.story_time}}.
- The chat's latest messages are this conversation's user and assistant turns, oldest first: each user turn a message of the player's, each assistant turn a reply.
{{/turn}}
{{#turn_facts}}
{{turn_facts}}
{{/turn_facts}}
{{#story.from}}
- The chat's story choice: story.from is {{story.from.names}}, story.newest is {{story.newest.names}}.
{{/story.from}}
{{#previous.run.stopped}}
- The last turn's work was still going when this one began, and was stopped where it stood. What it had recorded is kept.
{{/previous.run.stopped}}
{{#lore.unindexed}}
- Lore entries no indexing run has written lines for yet: {{lore.unindexed}}.
{{/lore.unindexed}}
{{#cast.base.older}}
- A principal's base is older than a source bound to it:
{{#cast.base.older.sources}}
  - {{who}}: {{kind}} {{id}}{{#title}} ("{{title}}"){{/title}}{{#gone}}, gone{{/gone}}{{#defines}}, which defines their {{defines}}{{/defines}}
{{/cast.base.older.sources}}
{{/cast.base.older}}
{{#cast.growth.proposed}}
- {{cast.growth.proposed}} character(s) have growth a reflection proposed that you have not accepted.
{{/cast.growth.proposed}}
{{#history.unsummarized}}
- {{history.unsummarized}} message(s), {{history.unsummarized.range.from}} to {{history.unsummarized.range.to}}, are out of the prompt with beats recorded and lie in no scene with a summary.
{{/history.unsummarized}}
{{#asked}}
- The player asked for: {{.}}
{{/asked}}
{{#prefill}}

The reply already begins with these words. The chat application puts them in front of whatever is written:

{{prefill}}
{{/prefill}}
{{#since}}

## Since the last turn

{{#since.items}}
- {{.}}
{{/since.items}}
{{/since}}
{{#session_unreadable}}

## This session's file

{{#reason}}
It could not be read: {{reason}} You hold nothing of this scene's earlier turns this turn. The turn goes on, and the next one reads the file again.
{{/reason}}
{{^reason}}
Some lines of it could not be read and were passed over, so what this scene carries is short of them. The turn goes on, and the next one reads the file again. The lines:
{{#lines}}
- {{.}}
{{/lines}}
{{/reason}}
{{/session_unreadable}}
{{#files_changed}}

## Files changed since this session opened

{{files_changed}}
{{/files_changed}}
{{#files_added}}

## Added for this turn

{{files_added}}
{{/files_added}}
{{#rules_due}}

## From your rules

{{rules_due}}
{{/rules_due}}
{{#hooks}}

## From the player's hooks

{{hooks}}
{{/hooks}}
{{#world_state}}

## World state

{{world_state}}
{{/world_state}}
{{#on_stage}}

## On stage

{{on_stage}}
{{/on_stage}}
{{#lore_map}}

## Lore map

{{lore_map}}
{{/lore_map}}
{{#prompt_notices}}

## The prompt

{{prompt_notices}}
{{/prompt_notices}}
{{#prompt_cut}}

## The prompt as it arrived

{{prompt_cut}}
{{/prompt_cut}}
{{#not_given}}

## Not given to you

{{not_given}}
{{/not_given}}
{{#story_so_far}}

## The story so far (history that is not in the prompt)

{{story_so_far}}
{{/story_so_far}}
{{#story_brief}}

## Story brief

{{story_brief}}
{{/story_brief}}
{{#cache}}

## What this scene has already looked up

It is kept in the session's cache folder, {{cache.folder}}, to be read from there; nothing writes in it.
{{#cache.carried}}
- Carried into this turn as it stood: {{path}}
{{/cache.carried}}
{{#cache.lore}}
- Lore entry [{{id}}] {{title}}, read in full: {{path}}
{{/cache.lore}}
{{#cache.prompt_map}}
- The prompt map as this scene has it: {{cache.prompt_map}}
{{/cache.prompt_map}}
{{#cache.host}}
- From the host: {{path}}
{{/cache.host}}
{{/cache}}
{{#turn_files}}

The same material is on disk for agents you delegate to: {{turn_files}}
{{/turn_files}}
{{#reply_contract}}

## How the reply is marked

{{reply_contract}}
{{#intent_path}}

This turn's intent file: `{{intent_path}}`
{{/intent_path}}
{{/reply_contract}}
