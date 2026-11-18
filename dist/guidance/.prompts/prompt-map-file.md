---
description: The layout of PROMPT-MAP.md, the file at the top of a chat's folder that shows the prompt map of the preset the chat is played on, for the agents who read it and for you. It lays out what the map holds and asks for nothing. `learned` says whether a map has been learned; `preset` is the preset it is for; each of `slices` is one named part of the prompt with its marker, kind, line, behaviour, whether you changed it on the Prompt page (`edited`), and how it is found again (`signature` for its text, `block` for the chat application's block name, `after` and `before` for its place among the slices around it); `blocks` are the chat application's own blocks, with their number, name, type and kind, which are all there is until a map is learned. Change the words freely; take a part out and it is no longer shown.
---
# The prompt map
{{#preset}}

This is the map of {{#name}}{{name}}{{/name}}{{^name}}the preset {{id}}{{/name}}{{#revision}}, revision {{revision}}{{/revision}}.
{{/preset}}
{{^preset}}

The chat application did not name the preset this prompt is from.
{{/preset}}
{{#learned}}

## The slices

A slice is one named part of the prompt. It is read by its marker.

How a slice behaves from turn to turn: `fixed`, its text does not change; `scene`, it changes with the scene; `turn`, it changes every turn.

How a slice is found again on a later turn: by its text, where it is fixed and its text is as it was; else by the name of the chat application's block, where the chat application names one; else by its place between the slices around it (`history` stands for the chat's messages).

A slice marked edited was changed on the Prompt page. A new mapping keeps the change.
{{#slices}}

- **{{marker}}** ({{kind}}, {{behaviour}}{{#edited}}, edited{{/edited}}): {{line}}
  Found again by:
{{#signature}}
  - its text
{{/signature}}
{{#block}}
  - the chat application's block {{block}}
{{/block}}
{{#after}}
  - its place after {{after}}
{{/after}}
{{#before}}
  - its place before {{before}}
{{/before}}
{{/slices}}
{{/learned}}
{{^learned}}

## Not mapped yet

This preset's prompt has not been mapped yet, so its parts have only the names the chat application gave its blocks.
{{/learned}}

## The chat application's blocks

{{#learned}}
The names the chat application's own breakdown gave the preset's blocks, as the last prompt had them. A slice's block, above, is one of these.

{{/learned}}
{{^blocks}}
The chat application named no blocks.
{{/blocks}}
{{#blocks}}
{{n}}. {{name}} ({{type}}, {{kind}})
{{/blocks}}
