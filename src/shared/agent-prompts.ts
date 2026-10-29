// What the agent runtime itself says to a model (AGENT-LOOP-PLAN §9: everything sent to a model is
// editable): the built-in `scratch_read` tool, the notes it puts on tool results, and the text form
// a connection that refuses native tools is offered them in. Each is a registry text with the
// shipped default, reset per item on Settings → Agents → Prompts (R5), under the page "Every agent".

import type { PromptDef, PromptPage } from "./prompts";

export const RUNTIME_PROMPT_PAGE: PromptPage = { id: "runtime", label: "Every agent", note: "What the agent runtime says to any agent's model besides its role's own prompts: the scratch_read tool, the notes on tool results, and tools offered as text." };

/** The runtime's text ids, so code names them once. */
export const RUNTIME_TEXT = {
  scratchRead: "runtime.scratch_read",
  scratchHandle: "runtime.scratch_read.handle",
  scratchOffset: "runtime.scratch_read.offset",
  scratchLength: "runtime.scratch_read.length",
  scratchPart: "runtime.scratch_part",
  scratchMissing: "runtime.scratch_missing",
  clipped: "runtime.clipped",
  unknownTool: "runtime.unknown_tool",
  toolFailed: "runtime.tool_failed",
  tooManyCalls: "runtime.too_many_calls",
  toolsInText: "runtime.tools_in_text",
  toolInText: "runtime.tool_in_text",
  toolResults: "runtime.tool_results",
  toolResult: "runtime.tool_result",
  toolError: "runtime.tool_error",
  cacheNonce: "runtime.cache_nonce",
} as const;

const page = RUNTIME_PROMPT_PAGE.id;

export const RUNTIME_PROMPTS: readonly PromptDef[] = [
  { id: RUNTIME_TEXT.scratchRead, page, label: "scratch_read: what it does", note: "The description of the built-in tool that reads the rest of a clipped tool result.", text: "Read more of a tool result that came back clipped. Give the scratch handle the clipped result names and where to start; you get the next part.", vars: [] },
  { id: RUNTIME_TEXT.scratchHandle, page, label: "scratch_read: handle", note: "The description of scratch_read's handle argument.", text: "The scratch handle the clipped result names, such as s1.", vars: [] },
  { id: RUNTIME_TEXT.scratchOffset, page, label: "scratch_read: offset", note: "The description of scratch_read's offset argument.", text: "The character to start from; 0 is the start.", vars: [] },
  { id: RUNTIME_TEXT.scratchLength, page, label: "scratch_read: length", note: "The description of scratch_read's length argument.", text: "How many characters to read, at most {{max}}.", vars: [{ name: "max", text: "the most one read returns: Tool results clipped past, in Settings → Agents" }] },
  {
    id: RUNTIME_TEXT.scratchPart,
    page,
    label: "scratch_read: its answer",
    note: "What scratch_read returns.",
    text: "[Scratch {{handle}}, characters {{from}} to {{to}} of {{total}}.]\n{{text}}",
    vars: [
      { name: "handle", text: "the scratch handle read", required: true },
      { name: "from", text: "the first character returned" },
      { name: "to", text: "the character after the last one returned" },
      { name: "total", text: "the whole result's length" },
      { name: "text", text: "the characters read", required: true },
    ],
  },
  {
    id: RUNTIME_TEXT.scratchMissing,
    page,
    label: "scratch_read: no such handle",
    note: "scratch_read's answer to a handle that doesn't exist.",
    text: "There's no scratch {{handle}}. Scratch holds: {{handles}}.",
    vars: [
      { name: "handle", text: "the handle asked for" },
      { name: "handles", text: "the handles there are, or none" },
    ],
  },
  {
    id: RUNTIME_TEXT.clipped,
    page,
    label: "A clipped tool result",
    note: "Follows the part of a long tool result that reaches the model.",
    text: "[Clipped: the first {{shown}} of {{total}} characters. The rest is in scratch {{handle}}; read it with scratch_read from offset {{shown}}.]",
    vars: [
      { name: "shown", text: "the characters shown" },
      { name: "total", text: "the result's length" },
      { name: "handle", text: "where the whole result waits", required: true },
    ],
  },
  {
    id: RUNTIME_TEXT.unknownTool,
    page,
    label: "A tool that doesn't exist",
    note: "The result of a call to a tool the agent wasn't given.",
    text: "There's no tool {{name}}. The tools are: {{tools}}.",
    vars: [
      { name: "name", text: "the name the model called" },
      { name: "tools", text: "the agent's tools" },
    ],
  },
  {
    id: RUNTIME_TEXT.toolFailed,
    page,
    label: "A tool that failed",
    note: "The result of a tool call that failed.",
    text: "{{name}} failed: {{error}}",
    vars: [
      { name: "name", text: "the tool" },
      { name: "error", text: "why", required: true },
    ],
  },
  {
    id: RUNTIME_TEXT.tooManyCalls,
    page,
    label: "Too many calls in one answer",
    note: "The result of each call past Tool calls per answer.",
    text: "Not run: one answer may call at most {{limit}} {{tools}}. Call {{name}} again in your next answer if you still need it.",
    vars: [
      { name: "limit", text: "Tool calls per answer" },
      { name: "tools", text: '"tool" for 1, else "tools"' },
      { name: "name", text: "the tool not run" },
    ],
  },
  {
    id: RUNTIME_TEXT.toolsInText,
    page,
    label: "Tools offered as text",
    note: "Follows an agent's prompt on a connection that refuses native tools, offering them as text instead.",
    text: 'You can use tools. To call one, write a block like this and stop there:\n<tool_call>{"name": "the tool\'s name", "arguments": {"an argument": "its value"}}</tool_call>\nWrite several blocks to call several tools. The results come back in the next message. Once you have what you need, answer with no tool call.\n\nThe tools:\n{{tools}}',
    vars: [{ name: "tools", text: "each tool, as Each tool offered as text writes it", required: true }],
  },
  {
    id: RUNTIME_TEXT.toolInText,
    page,
    label: "Each tool offered as text",
    note: "One tool in Tools offered as text.",
    text: "{{name}}: {{description}}\nArguments (JSON Schema): {{parameters}}",
    vars: [
      { name: "name", text: "the tool's name", required: true },
      { name: "description", text: "what it does" },
      { name: "parameters", text: "its arguments' JSON Schema" },
    ],
  },
  {
    id: RUNTIME_TEXT.toolResults,
    page,
    label: "Tool results sent as text",
    note: "The message that brings tool calls written as text their results.",
    text: "Results of your tool calls:\n\n{{results}}",
    vars: [{ name: "results", text: "each result, as A tool result as text writes it", required: true }],
  },
  {
    id: RUNTIME_TEXT.toolResult,
    page,
    label: "A tool result as text",
    note: "One result in Tool results sent as text.",
    text: '<tool_result name="{{name}}">\n{{result}}\n</tool_result>',
    vars: [
      { name: "name", text: "the tool" },
      { name: "result", text: "its result", required: true },
    ],
  },
  {
    id: RUNTIME_TEXT.toolError,
    page,
    label: "A failed tool result as text",
    note: "One failed result in Tool results sent as text.",
    text: '<tool_result name="{{name}}" error="true">\n{{error}}\n</tool_result>',
    vars: [
      { name: "name", text: "the tool" },
      { name: "error", text: "why it failed", required: true },
    ],
  },
  { id: RUNTIME_TEXT.cacheNonce, page, label: "Cache key", note: "Heads an agent's prompt after Bust, and every call while its caching is off, so the provider's cached prompt no longer matches.", text: "Cache key {{nonce}}; ignore it.", vars: [{ name: "nonce", text: "the key", required: true }] },
];
