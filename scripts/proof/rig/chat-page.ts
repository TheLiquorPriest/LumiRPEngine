// Lumiverse's chat page as the rig has it (PlanScenarios-2 items 6 and 7): the page a person plays a reply in, standing for
// Lumiverse's own, wired to the stand-in over the same routes and the same event socket Lumiverse's page uses. The stand-in has
// no pages (§17.1), and the preview's fake page is no chat page; this is the one page of Lumiverse the rig plays in, as small as
// the steps need and with Lumiverse's own words and markup where the steps look for them (`scripts/proof/live/steps.ts`,
// `scripts/proof/browser/moments.ts`, which cite Lumiverse's source for each): the composer's `Message` field and Send / Stop
// buttons, the connection and persona menus with their search fields, the drawer's Preset tab, a message's `data-part`,
// `data-message-id`, `MessageContent` and reasoning toggle. The steps that play it are the bed's own, so a form plays the same
// steps on both roads.
//
// What it does is Lumiverse's page's own work, over the wire and nothing else: sign in at its sign-in page; read the messages
// (`GET /api/v1/chats/:id/messages`), the connections, personas and presets; on Send, append the player's message
// (`POST /api/v1/chats/:id/messages`) then start the generation (`POST /api/v1/generate`), and show the reply as the events
// tell it: `STREAM_TOKEN_RECEIVED` (reasoning or content, `generate.service.ts:3320-3365`), `GENERATION_ENDED`,
// `GENERATION_STOPPED`, to a socket that said it shows this chat (`stream_focus`, `ws/handler.ts:306`). A Stop sends
// `POST /api/v1/generate/stop`. Nothing is shown that an event or an answer did not tell it. The page notes what it was not
// told: `window.__rig.tokens` counts the stream tokens it heard, `errors` what failed.

const LOGIN = `<!doctype html><meta charset="utf-8"><title>Lumiverse</title>
<form id="f"><label for="username">Username</label><input id="username" name="username" type="text" placeholder="Enter your username">
<label for="password">Password</label><input id="password" name="password" type="password" placeholder="Enter your password">
<button type="submit">Sign In</button></form>
<p id="problem" hidden></p>
<script>
document.getElementById("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = await fetch("/api/auth/sign-in/username", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: username.value, password: password.value }) });
  if (r.ok) location.href = new URLSearchParams(location.search).get("next") || "/";
  else { const p = document.getElementById("problem"); p.hidden = false; p.textContent = "Sign in failed: " + r.status; }
});
</script>`;

const CHAT = `<!doctype html><meta charset="utf-8"><title>Lumiverse</title>
<style>
  body { margin: 0; font: 15px/1.4 sans-serif; }
  [hidden] { display: none !important; }
  #drawer { position: fixed; top: 0; left: 0; width: 280px; height: 300px; background: #eee; transform: translateX(-2000px); }
  #drawer.open { transform: none; }
  #drawerBtn { position: fixed; top: 0; right: 0; width: 28px; height: 28px; }
  #composer { position: fixed; bottom: 0; left: 0; right: 0; background: #fff; border-top: 1px solid #aaa; padding: 6px; }
  #list { padding: 8px 8px 160px; }
  #notice { position: fixed; top: 32px; right: 8px; background: #fee; border: 1px solid #c88; padding: 4px; max-width: 60%; }
  .pop { position: absolute; bottom: 48px; background: #f6f6f6; border: 1px solid #aaa; padding: 6px; }
</style>
<div data-component="MessageList" id="list"></div>
<p id="notice" hidden></p>
<div id="composer">
  <div style="position: relative">
    <button type="button" id="conn" title="Switch connection"><svg width="14" height="14"></svg></button>
    <div class="pop" id="connPop" hidden>
      <input type="text" id="connSearch" placeholder="Search connections, providers, models, folders…">
      <div id="connRows"></div>
    </div>
    <button type="button" id="persona" title="Switch persona for this chat"><svg width="14" height="14"></svg></button>
    <div class="pop" id="personaPop" hidden>
      <label><input type="search" id="personaSearch" aria-label="Search personas…" placeholder="Search personas…"></label>
      <div id="personaRows"></div>
    </div>
  </div>
  <textarea name="chat-message" aria-label="Message" placeholder="Type a message…" rows="1" style="width: 70%"></textarea>
  <button type="button" id="send" aria-label="Send message">Send</button>
</div>
<button type="button" id="drawerBtn"></button><div data-lumiverse-surface="viewport-drawer" id="drawer">
  <button type="button" data-tab-id="loom" title="Preset">Preset</button>
  <div id="panel" hidden><select id="presetSelect"><option value="">(none)</option></select></div>
</div>
<script>
(() => {
const $ = (id) => document.getElementById(id);
const chat = decodeURIComponent(location.pathname.split("/").pop());
// What Lumiverse keeps on its server for the player (the active connection, preset and persona) is kept here in the browser's own storage, so a reloaded page has it.
const kept = JSON.parse(localStorage.getItem("kept:" + chat) ?? "{}");
const state = { connection: kept.connection ?? null, persona: kept.persona ?? null, preset: kept.preset ?? null, generation: null, streaming: false, bubble: null, reasoned: "", seen: new Set() };
const lists = { connections: [], personas: [], presets: [] };
window.__rig = { ready: false, tokens: 0, reasoningTokens: 0, frames: [], errors: [] };
const keep = () => localStorage.setItem("kept:" + chat, JSON.stringify({ connection: state.connection, persona: state.persona, preset: state.preset }));
const fail = (what, e) => { const words = what + ": " + ((e && e.message) || e); window.__rig.errors.push(words); $("notice").hidden = false; $("notice").textContent = words; };
const rowsOf = (x) => (Array.isArray(x) ? x : (x && x.data) || []);
const byName = (list, name) => list.find((x) => x.name === name);

async function api(method, path, body) {
  const r = await fetch(path, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let data = null;
  try { data = text === "" ? null : JSON.parse(text); } catch { data = text; }
  if (r.status === 401) { location.href = "/login?next=" + encodeURIComponent(location.pathname); throw new Error("not signed in"); }
  if (!r.ok) throw new Error(method + " " + path + " answered " + r.status + ": " + String((data && data.error) || text).slice(0, 200));
  return data;
}

function rows(into, items, filter, pick) {
  into.replaceChildren(...items.filter((x) => x.name.toLowerCase().includes(filter.toLowerCase())).map((x) => {
    const b = document.createElement("button"); b.type = "button";
    const name = document.createElement("span"); name.textContent = x.name;
    const more = document.createElement("span"); more.textContent = x.provider ? " " + x.provider + " / " + (x.model ?? "") : "";
    b.append(name, more);
    b.addEventListener("click", () => pick(x));
    return b;
  }));
}
function titleOfConnection() { $("conn").title = state.connection === null ? "Switch connection" : "Connection: " + state.connection; }
$("conn").addEventListener("click", () => { $("connPop").hidden = !$("connPop").hidden; rows($("connRows"), lists.connections, $("connSearch").value, pickConnection); });
$("connSearch").addEventListener("input", () => rows($("connRows"), lists.connections, $("connSearch").value, pickConnection));
$("connSearch").addEventListener("focus", () => rows($("connRows"), lists.connections, $("connSearch").value, pickConnection));
function pickConnection(c) { state.connection = c.name; keep(); titleOfConnection(); $("connPop").hidden = true; }
$("persona").addEventListener("click", () => { $("personaPop").hidden = !$("personaPop").hidden; rows($("personaRows"), lists.personas, "", pickPersona); });
$("personaSearch").addEventListener("input", () => rows($("personaRows"), lists.personas, $("personaSearch").value, pickPersona));
function pickPersona(p) { state.persona = p.name; keep(); $("personaPop").hidden = true; }
$("drawerBtn").addEventListener("click", () => $("drawer").classList.toggle("open"));
document.querySelector('[data-tab-id="loom"]').addEventListener("click", () => {
  $("panel").hidden = false;
  $("presetSelect").replaceChildren(...[{ name: "(none)" }, ...lists.presets].map((p) => { const o = document.createElement("option"); o.textContent = p.name; return o; }));
  if (state.preset !== null) $("presetSelect").value = state.preset;
});
$("presetSelect").addEventListener("change", (e) => { state.preset = e.target.value === "(none)" ? null : e.target.value; keep(); });

function showMessage(m, part) {
  state.seen.add(m.id);
  const row = document.createElement("div"); row.setAttribute("data-item-type", "message");
  const bubble = document.createElement("div"); bubble.setAttribute("data-component", "BubbleMessage"); bubble.setAttribute("data-part", part); bubble.setAttribute("data-message-id", m.id);
  const content = document.createElement("div"); content.setAttribute("data-component", "MessageContent"); content.textContent = m.content ?? "";
  bubble.append(content); row.append(bubble); $("list").append(row);
  return bubble;
}
const isUser = (m) => m.is_user === true || m.role === "user";

function setStreaming(on) {
  state.streaming = on;
  $("send").setAttribute("aria-label", on ? "Stop generation" : "Send message");
}

// A reply begins as a streaming bubble with nothing in it: its reasoning button mounts with the first reasoning token, its text with the first word.
function streamingBubble(generation) {
  state.generation = generation; state.reasoned = "";
  const b = showMessage({ id: "stream-" + generation, content: "" }, "streaming");
  b.querySelector('[data-component="MessageContent"]').hidden = true;
  state.bubble = b;
  setStreaming(true);
}
function onToken(payload) {
  if (payload.generationId !== state.generation || state.bubble === null) return;
  const b = state.bubble;
  if (payload.type === "reasoning") {
    window.__rig.reasoningTokens += 1;
    state.reasoned += payload.token;
    if (b.querySelector("[data-reasoning-toggle]") === null) { const t = document.createElement("button"); t.type = "button"; t.setAttribute("data-reasoning-toggle", "true"); t.textContent = "Thinking"; b.prepend(t); }
    return;
  }
  window.__rig.tokens += 1;
  const content = b.querySelector('[data-component="MessageContent"]');
  content.hidden = false; content.textContent += payload.token;
}
function onEnd(payload, stopped) {
  if (payload.generationId !== state.generation || state.bubble === null) return;
  const b = state.bubble; state.bubble = null; state.generation = null;
  const content = b.querySelector('[data-component="MessageContent"]');
  if (payload.error) fail("the generation ended with an error", { message: payload.error });
  if (typeof payload.content === "string" && payload.content !== "") { content.hidden = false; content.textContent = payload.content; }
  // The bubble keeps the id it was shown under: a message that changes its id while it is read is not the one being watched (the real page's streaming message is the staged one, with its own id from the start).
  if (typeof payload.messageId === "string") state.seen.add(payload.messageId);
  content.setAttribute("data-display-pending", "");
  b.setAttribute("data-part", "character");
  setStreaming(false);
  setTimeout(() => content.removeAttribute("data-display-pending"), 20);
}
function handle(frame) {
  const p = frame.payload ?? {};
  if (p.chatId !== undefined && p.chatId !== chat) return;
  if (frame.event === "STREAM_TOKEN_RECEIVED") onToken(p);
  else if (frame.event === "GENERATION_ENDED") onEnd(p, false);
  else if (frame.event === "GENERATION_STOPPED") onEnd(p, true);
  else if (frame.event === "MESSAGE_SENT" && p.message && !state.seen.has(p.message.id) && isUser(p.message)) showMessage(p.message, "user");
}

async function listen() {
  const { ticket } = await api("POST", "/api/v1/ws-ticket", {});
  const { promise, resolve, reject } = Promise.withResolvers();
  const ws = new WebSocket(location.origin.replace(/^http/, "ws") + "/api/ws?ticket=" + encodeURIComponent(ticket));
  ws.onmessage = (e) => {
    let frame; try { frame = JSON.parse(e.data); } catch { return; }
    window.__rig.frames.push(frame.event);
    if (frame.event === "CONNECTED") { ws.send(JSON.stringify({ type: "stream_focus", chatId: chat })); resolve(); }
    else if (frame.event === "AUTH_ERROR") reject(new Error("Lumiverse refused the socket's ticket"));
    else handle(frame);
  };
  ws.onclose = (e) => { if (!window.__rig.ready) reject(new Error("the event socket closed before it was let in (" + e.code + ")")); else fail("the event socket closed", { message: e.code + " " + e.reason }); };
  await promise;
}

$("send").addEventListener("click", async () => {
  try {
    if (state.streaming) { await api("POST", "/api/v1/generate/stop", { chat_id: chat, ...(state.generation === null ? {} : { generation_id: state.generation }) }); return; }
    const area = document.querySelector("textarea");
    const text = area.value.trim(); if (text === "") return;
    area.value = "";
    const connection = state.connection === null ? undefined : byName(lists.connections, state.connection);
    const persona = state.persona === null ? undefined : byName(lists.personas, state.persona);
    const preset = state.preset === null ? undefined : byName(lists.presets, state.preset);
    const sent = await api("POST", "/api/v1/chats/" + encodeURIComponent(chat) + "/messages", { name: persona ? persona.name : "User", content: text, is_user: true });
    if (sent && !state.seen.has(sent.id)) showMessage({ id: sent.id, content: text }, "user");
    const started = await api("POST", "/api/v1/generate", { chat_id: chat, ...(connection ? { connection_id: connection.id } : {}), ...(persona ? { persona_id: persona.id } : {}), ...(preset ? { preset_id: preset.id } : {}) });
    if (!state.seen.has("stream-" + started.generationId) && state.generation === null) streamingBubble(started.generationId);
  } catch (e) { fail("Send", e); setStreaming(false); }
});

(async () => {
  try {
    const [connections, personas, presets, messages] = await Promise.all([
      api("GET", "/api/v1/connections?limit=200"), api("GET", "/api/v1/personas?limit=200"), api("GET", "/api/v1/presets?limit=200"),
      api("GET", "/api/v1/chats/" + encodeURIComponent(chat) + "/messages?tail=true&limit=100&full=true"),
    ]);
    lists.connections = rowsOf(connections); lists.personas = rowsOf(personas); lists.presets = rowsOf(presets);
    titleOfConnection();
    for (const m of rowsOf(messages)) showMessage(m, isUser(m) ? "user" : "character");
    await listen();
    window.__rig.ready = true;
  } catch (e) { fail("the page could not be set up", e); }
})();
})();
</script>`;

/** The pages the door serves: Lumiverse's sign-in and its chat page (`/chat/<id>`). */
export function rigPages(path: string): string | null {
  if (path === "/login") return LOGIN;
  if (path === "/") return "<title>Lumiverse</title><p>Landing</p>";
  if (path.startsWith("/chat/")) return CHAT;
  return null;
}
