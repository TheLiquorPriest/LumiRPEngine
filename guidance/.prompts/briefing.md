---
description: The layout of the briefing the Author is given at the start of every turn. Each part appears only when there is something to show. Take a part out and it is no longer shown. It lays facts out; it asks for nothing.
---
# Briefing for this turn

{{#turn}}
- This turn: {{turn.kind}}{{#turn.speaker}}, replying as {{turn.speaker}}{{/turn.speaker}}{{#turn.story_time}}. Story time: {{turn.story_time}}{{/turn.story_time}}.
{{/turn}}
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
{{#world_state}}

## World state

{{world_state}}
{{/world_state}}
{{#lore_map}}

## Lore map

{{lore_map}}
{{/lore_map}}
{{#prompt_notices}}

## The prompt

{{prompt_notices}}
{{/prompt_notices}}
{{#story_so_far}}

## The story so far (history that is not in the prompt)

{{story_so_far}}
{{/story_so_far}}
{{#story_brief}}

## Story brief

{{story_brief}}
{{/story_brief}}
{{#facts}}

## Counts

{{#facts.lines}}
- {{.}}
{{/facts.lines}}
{{/facts}}
{{#turn_files}}

The same material is on disk for agents you delegate to: {{turn_files}}
{{/turn_files}}
