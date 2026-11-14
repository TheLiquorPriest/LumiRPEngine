---
description: The layout of the story so far, shown in the briefing for the history the window leaves out of the prompt. Its parts come from the story record, oldest first, each with the messages it stands for, so any of them can be read in the chat. Chapter and scene summaries are printed as they were written; beats are printed where no summary covers them yet. Where there was no room, a line says what was not shown. It lays out what the record holds; it asks for nothing.
---
{{#parts}}
{{#chapter}}
Chapter summary, messages {{chapter.from}} to {{chapter.to}}:
{{chapter.text}}

{{/chapter}}
{{#scene}}
Scene summary, messages {{scene.from}} to {{scene.to}}:
{{scene.text}}

{{/scene}}
{{#beats}}
Beats with no summary yet, messages {{beats.from}} to {{beats.to}}:
{{#beats.lines}}
- Message {{at}}: {{text}}
{{/beats.lines}}

{{/beats}}
{{#left_out}}
Not shown, for want of room: messages {{left_out.from}} to {{left_out.to}}{{#left_out.chapters}}, chapter summaries: {{left_out.chapters}}{{/left_out.chapters}}{{#left_out.scenes}}, scene summaries: {{left_out.scenes}}{{/left_out.scenes}}{{#left_out.beats}}, beats: {{left_out.beats}}{{/left_out.beats}}.

{{/left_out}}
{{/parts}}
