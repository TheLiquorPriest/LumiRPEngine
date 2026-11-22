---
description: The layout of the story so far, shown in the briefing for the history the window leaves out of the prompt. Its parts come from the story record, oldest first, each with the messages it stands for, so any of them can be read in the chat. Chapter and scene summaries are printed as they were written; beats are printed where no summary covers them yet. Where there was no room, a line says what was not shown and the call that reads it. It lays out what the record holds; it asks for nothing.
---
{{#parts}}
{{#chapter}}
{{#chapter.gone}}
Chapter summary; its messages are gone from the chat, it was written at message {{chapter.from}}:
{{/chapter.gone}}
{{^chapter.gone}}
Chapter summary, messages {{chapter.from}} to {{chapter.to}}:
{{/chapter.gone}}
{{chapter.text}}

{{/chapter}}
{{#scene}}
{{#scene.gone}}
Scene summary; its messages are gone from the chat, it was written at message {{scene.from}}:
{{/scene.gone}}
{{^scene.gone}}
Scene summary, messages {{scene.from}} to {{scene.to}}:
{{/scene.gone}}
{{scene.text}}

{{/scene}}
{{#gap}}
Not covered by the record: messages {{gap.from}} to {{gap.to}}.

{{/gap}}
{{#beats}}
Beats with no summary yet, messages {{beats.from}} to {{beats.to}}:
{{#beats.lines}}
- Message {{at}}{{#through}} to {{through}}{{/through}}{{#gone}} (its messages are gone from the chat; written there){{/gone}}: {{text}}
{{/beats.lines}}

{{/beats}}
{{#left_out}}
Not shown, for want of room: messages {{left_out.from}} to {{left_out.to}}{{#left_out.chapters}}, chapter summaries: {{left_out.chapters}}{{/left_out.chapters}}{{#left_out.scenes}}, scene summaries: {{left_out.scenes}}{{/left_out.scenes}}{{#left_out.beats}}, beats: {{left_out.beats}}{{/left_out.beats}}. story_query reads them: from {{left_out.from}}, to {{left_out.to}}.

{{/left_out}}
{{/parts}}
