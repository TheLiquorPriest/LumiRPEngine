---
description: The layout of the briefing the lead is given at the start of every turn. Each part appears only when there is something to show. The host's own parts come in the order the host gives them, each under its own name. Take a part out and it is no longer shown. Its last part is the reply contract again, exactly as the opening block holds it, so it is the last thing read before the reply is written, with this turn's folder and, where the lead writes its intent record to a file itself, that file's whole path; take that part out and the contract is in the opening block only. It lays facts out; it asks for nothing.
---
# Briefing for this turn

- This turn: {{turn.kind}}{{#turn.speaker}}, replying as {{turn.speaker}}{{/turn.speaker}}.
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
{{#blocks}}

## {{name}}

{{text}}
{{/blocks}}
{{#prompt_notices}}

## The prompt

{{prompt_notices}}
{{/prompt_notices}}
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
