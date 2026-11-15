// A site made up for the bed's host's tests (PlanScenarios-3 item 11): it stands for Lumiverse's pages and its
// REST as far as the host uses them, with the markup Lumiverse's own source gives (the labels of the composer, the
// connection and persona menus, the drawer's Preset tab, a message's `data-part`, the reasoning toggle, the
// content's `data-component`; each cited in `scripts/proof/browser/moments.ts` and `scripts/proof/live/steps.ts`).
// A reply streams from a script of delays. Nothing here is Lumiverse: every name is invented, and the pages are
// as small as the host's steps need. The tests that rest on it say so; the bed itself is what proves the real ones.

export interface SiteScript {
  /** Ms from Send to the reply's message appearing (streaming, no text yet). */
  begin: number;
  /** Ms after that to its reasoning block, or null for a reply with none. */
  thinking: number | null;
  /** Ms after the message appears to its first word. */
  firstWord: number;
  /** The words of the reply, one every `gap` ms, the last one ending it. */
  words: string[];
  gap: number;
}

export const DEFAULT_SCRIPT: SiteScript = { begin: 40, thinking: 60, firstWord: 140, words: ["The", "lamp", "turns", "above", "you."], gap: 30 };

export interface Site {
  base: string;
  /** What each Send carried, as the page held its choices when it was pressed. */
  sent: { text: string; connection: string | null; persona: string | null; preset: string | null }[];
  /** Sign-ins the page took. */
  signIns: number;
  /** Chats made through the REST, by id. */
  chats: Map<string, { id: string; name: string; character_id: string }>;
  script: SiteScript;
  stop(): void;
}

export const USER = "user-marlow";
export const TOKEN = "invented-session-token";
export const CONNECTIONS = [
  { id: "conn-plain", name: "Plain lamp", provider: "deepseek", model: "model-a" },
  { id: "conn-rpe", name: "RPE lamp", provider: "openai-compatible", model: "model-a" },
];
export const PERSONAS = [{ id: "pers-traveller", name: "The traveller" }];
export const PRESETS = [
  { id: "pre-other", name: "Other preset" },
  { id: "pre-floor", name: "Floor preset" },
];

const LOGIN = `<!doctype html><meta charset="utf-8"><title>Lumiverse</title>
<form id="f"><label for="username">Username</label><input id="username" name="username" type="text" placeholder="Enter your username">
<label for="password">Password</label><input id="password" name="password" type="password" placeholder="Enter your password">
<button type="submit">Sign In</button></form>
<script>
document.getElementById("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = await fetch("/api/auth/sign-in/username", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: username.value, password: password.value }) });
  if (r.ok) location.href = "/";
});
</script>`;

const chatPage = (script: SiteScript): string => `<!doctype html><meta charset="utf-8"><title>Lumiverse</title>
<style>
  body { margin: 0; font: 15px/1.4 sans-serif; }
  [hidden] { display: none !important; }
  #drawer { position: fixed; top: 0; left: 0; width: 280px; height: 300px; background: #eee; transform: translateX(-2000px); }
  #drawer.open { transform: none; }
  #drawerBtn { position: fixed; top: 0; right: 0; width: 28px; height: 28px; }
  #composer { position: fixed; bottom: 0; left: 0; right: 0; background: #fff; border-top: 1px solid #aaa; padding: 6px; }
  #list { padding: 8px 8px 160px; }
  .pop { position: absolute; bottom: 48px; background: #f6f6f6; border: 1px solid #aaa; padding: 6px; }
</style>
<div data-component="MessageList" id="list"></div>
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
const SCRIPT = ${JSON.stringify(script)};
// What Lumiverse keeps on its server (the active connection and preset, the chat's persona) is kept here in the browser's storage, so a reloaded page has it.
const kept = JSON.parse(localStorage.getItem("kept") ?? "{}");
const state = { connection: kept.connection ?? null, persona: kept.persona ?? null, preset: kept.preset ?? null, streaming: false, n: 0 };
const keep = () => localStorage.setItem("kept", JSON.stringify({ connection: state.connection, persona: state.persona, preset: state.preset }));
if (state.connection !== null) document.getElementById("conn").title = "Connection: " + state.connection;
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CONNECTIONS = ${JSON.stringify(CONNECTIONS)};
const PERSONAS = ${JSON.stringify(PERSONAS)};
const PRESETS = ${JSON.stringify(PRESETS)};

function rows(into, items, filter, pick) {
  into.replaceChildren(...items.filter((x) => x.name.toLowerCase().includes(filter.toLowerCase())).map((x) => {
    const b = document.createElement("button"); b.type = "button";
    b.innerHTML = "<span>" + x.name + "</span><span> " + (x.provider ? x.provider + " / " + x.model : "") + "</span>";
    b.addEventListener("click", () => pick(x));
    return b;
  }));
}
$("conn").addEventListener("click", () => { $("connPop").hidden = !$("connPop").hidden; rows($("connRows"), CONNECTIONS, $("connSearch").value, () => {}); });
$("connSearch").addEventListener("input", () => rows($("connRows"), CONNECTIONS, $("connSearch").value, pickConnection));
function pickConnection(c) { state.connection = c.name; keep(); $("conn").title = "Connection: " + c.name; $("connPop").hidden = true; }
$("connSearch").addEventListener("focus", () => rows($("connRows"), CONNECTIONS, $("connSearch").value, pickConnection));
$("persona").addEventListener("click", () => { $("personaPop").hidden = !$("personaPop").hidden; rows($("personaRows"), PERSONAS, "", pickPersona); });
$("personaSearch").addEventListener("input", () => rows($("personaRows"), PERSONAS, $("personaSearch").value, pickPersona));
function pickPersona(p) { state.persona = p.name; keep(); $("personaPop").hidden = true; }
$("drawerBtn").addEventListener("click", () => $("drawer").classList.toggle("open"));
document.querySelector('[data-tab-id="loom"]').addEventListener("click", () => {
  $("panel").hidden = false;
  const s = $("presetSelect");
  s.replaceChildren(...[{ name: "(none)" }, ...PRESETS].map((p) => { const o = document.createElement("option"); o.textContent = p.name; return o; }));
});
$("presetSelect").addEventListener("change", (e) => { state.preset = e.target.value || e.target.selectedOptions[0].textContent; keep(); });

function message(part) {
  state.n += 1;
  const row = document.createElement("div"); row.setAttribute("data-item-type", "message");
  const bubble = document.createElement("div"); bubble.setAttribute("data-component", "BubbleMessage"); bubble.setAttribute("data-part", part); bubble.setAttribute("data-message-id", "m" + state.n);
  row.append(bubble); $("list").append(row);
  return bubble;
}
$("send").addEventListener("click", async () => {
  if (state.streaming) return;
  const area = document.querySelector("textarea");
  const text = area.value.trim(); if (text === "") return;
  area.value = "";
  await fetch("/__sent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, connection: state.connection, persona: state.persona, preset: state.preset }) });
  message("user").textContent = text;
  state.streaming = true; $("send").setAttribute("aria-label", "Stop generation");
  await sleep(SCRIPT.begin);
  const reply = message("streaming"); const hint = document.createElement("span"); hint.textContent = ""; reply.append(hint);
  if (SCRIPT.thinking !== null) { await sleep(SCRIPT.thinking); const t = document.createElement("button"); t.type = "button"; t.setAttribute("data-reasoning-toggle", "true"); t.textContent = "Thinking"; reply.prepend(t); }
  await sleep(Math.max(0, SCRIPT.firstWord - (SCRIPT.thinking ?? 0)));
  const content = document.createElement("div"); content.setAttribute("data-component", "MessageContent"); reply.append(content);
  for (let i = 0; i < SCRIPT.words.length; i++) { content.textContent += (i === 0 ? "" : " ") + SCRIPT.words[i]; if (i < SCRIPT.words.length - 1) await sleep(SCRIPT.gap); }
  content.setAttribute("data-display-pending", "");
  reply.setAttribute("data-part", "character"); $("send").setAttribute("aria-label", "Send message"); state.streaming = false;
  await sleep(20); content.removeAttribute("data-display-pending");
});
</script>`;

/** Serves the site on a free loopback port. */
export function serveSite(script: SiteScript = DEFAULT_SCRIPT): Site {
  const site: Site = { base: "", sent: [], signIns: 0, chats: new Map(), script, stop: () => undefined };
  let made = 0;
  const json = (value: unknown, status = 200): Response => Response.json(value, { status });
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      const signedIn = (request.headers.get("cookie") ?? "").includes("lumiverse_session=ok") || request.headers.get("authorization") === `Bearer ${TOKEN}`;
      const html = (body: string): Response => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
      if (url.pathname === "/login") return html(LOGIN);
      if (url.pathname === "/") return html(signedIn ? "<title>Lumiverse</title><p>Landing</p>" : '<script>location.href = "/login"</script>');
      if (url.pathname.startsWith("/chat/")) return html(signedIn ? chatPage(site.script) : '<script>location.href = "/login"</script>');
      if (url.pathname === "/api/auth/sign-in/username" && request.method === "POST") {
        site.signIns += 1;
        return new Response("{}", { headers: { "content-type": "application/json", "set-cookie": "lumiverse_session=ok; Path=/" } });
      }
      if (url.pathname === "/__sent" && request.method === "POST") {
        site.sent.push((await request.json()) as Site["sent"][number]);
        return json({});
      }
      if (!signedIn) return json({ error: "no session" }, 401);
      if (url.pathname === "/api/auth/get-session") return json({ user: { id: USER, username: "marlow" } });
      if (url.pathname === "/api/v1/system/info") return json({ backend: { version: "9.9.9" } });
      if (url.pathname === "/api/v1/connections") return json({ data: CONNECTIONS });
      for (const [kind, rows] of [["personas", PERSONAS], ["presets", PRESETS]] as const) {
        const one = new RegExp(`^/api/v1/${kind}/([^/]+)$`).exec(url.pathname)?.[1];
        if (one !== undefined) {
          const found = rows.find((r) => r.id === one);
          return found === undefined ? json({}, 404) : json(found);
        }
      }
      if (url.pathname === "/api/v1/chats" && request.method === "POST") {
        const body = (await request.json()) as { character_id: string; name: string };
        made += 1;
        const chat = { id: `chat-${made}`, name: body.name, character_id: body.character_id };
        site.chats.set(chat.id, chat);
        return json(chat);
      }
      const one = /^\/api\/v1\/chats\/([^/]+)$/.exec(url.pathname)?.[1];
      if (one !== undefined) return site.chats.has(one) ? json(site.chats.get(one)) : json({}, 404);
      return json({ error: `no route ${url.pathname}` }, 404);
    },
  });
  site.base = `http://127.0.0.1:${server.port}`;
  site.stop = () => void server.stop(true);
  return site;
}
