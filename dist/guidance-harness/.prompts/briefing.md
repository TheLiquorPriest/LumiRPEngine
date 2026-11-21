---
description: The layout of the briefing the lead is given at the start of every turn. Each part appears only when there is something to show. The host's own parts come in the order the host gives them, each under its own name. What the player's hooks added at the turn's start comes after what the rules say, under its own heading. Take a part out and it is no longer shown. Its last part is the reply contract again, as the files stand now (the opening block holds it as it stood when the session opened, and a change since is told under the files changed), so it is the last thing read before the reply is written, with this turn's folder and, where the lead writes its intent record to a file itself, that file's whole path; take that part out and the contract is in the opening block only. It lays facts out; it asks for nothing.
---
# Briefing for this turn

- This turn: {{turn.kind}}{{#turn.speaker}}, replying as {{turn.speaker}}{{/turn.speaker}}.
- The chat's latest messages are this conversation's user and assistant turns, oldest first: each user turn a message of the player's, each assistant turn a reply.
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
It could not be read: {{reason}} You hold nothing of this session's earlier turns this turn. The turn goes on, and the next one reads the file again.
{{/reason}}
{{^reason}}
Some lines of it could not be read and were passed over, so what this session carries is short of them. The turn goes on, and the next one reads the file again. The lines:
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
{{#blocks}}

## {{name}}

{{text}}
{{/blocks}}
{{#prompt_notices}}

## The prompt

{{prompt_notices}}
{{/prompt_notices}}
{{#cache}}

## What this session has already looked up

It is kept in the session's cache folder, {{cache.folder}}, to be read from there; nothing writes in it.
{{#cache.carried}}
- Carried into this turn as it stood: {{path}}
{{/cache.carried}}
{{#cache.lore}}
- Lore entry [{{id}}] {{title}}, read in full: {{path}}
{{/cache.lore}}
{{#cache.prompt_map}}
- The prompt map as this session has it: {{cache.prompt_map}}
{{/cache.prompt_map}}
{{#cache.host}}
- From the host: {{path}}
{{/cache.host}}
{{/cache}}
{{#turn_files}}

This turn's files are in {{turn_files}}
{{/turn_files}}
{{#reply_contract}}

## How the reply is marked

{{reply_contract}}
{{#turn_files}}

This turn's folder: `{{turn_files}}`
{{/turn_files}}
{{#intent_path}}
This turn's intent file: `{{intent_path}}`
{{/intent_path}}
{{/reply_contract}}
