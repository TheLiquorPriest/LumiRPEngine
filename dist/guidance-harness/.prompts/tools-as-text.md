---
description: How an agent's tools are offered when they go as text - to a model whose connection refused native tools, for the time the setting "Native tools tried again after" says, and to an agent whose definition says tools_as text - and how its calls and what they answered are shown back to it. One template, filled in for each use - offered, the tools it is given at the start, and how to call one; added and removed, a change to its tools later on; call, one of its own calls as it is shown back to it in later requests; answers, what its calls answered. Change the words freely; a call written in the form asked for here is read back, as are the forms models write by themselves. Switched off, the tools go with no words, and only a call a model writes by itself is read.
---
{{#offered}}
You can use tools. To call one, write a block like this and stop there:
<tool_call>{"name": "the tool's name", "arguments": {"an argument": "its value"}}</tool_call>
Write several blocks to call several tools. What they answer comes back in the next message. A message with no block calls nothing.

The tools:
{{#tools}}

{{name}}: {{description}}
Arguments (JSON Schema): {{parameters}}
{{/tools}}
{{/offered}}
{{#added}}
From here on you can also use these tools, called the same way:
{{#tools}}

{{name}}: {{description}}
Arguments (JSON Schema): {{parameters}}
{{/tools}}
{{/added}}
{{#removed}}
From here on these tools can no longer be used: {{names}}.
{{/removed}}
{{#call}}
<tool_call>{{json}}</tool_call>
{{/call}}
{{#answers}}
What your tool calls answered:
{{#results}}

<tool_result name="{{name}}"{{#error}} error="true"{{/error}}>
{{text}}
</tool_result>
{{/results}}
{{/answers}}
