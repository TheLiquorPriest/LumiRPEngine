// @bun
// src/shared/json.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// src/ext/generations.ts
var str = (v) => typeof v === "string" && v !== "" ? v : null;
var num = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
function factsOf(payload) {
  if (!isRecord(payload))
    return null;
  const id = str(payload.generationId);
  const chat = str(payload.chatId);
  const type = str(payload.generationType);
  if (id === null || chat === null || type === null)
    return null;
  return {
    chat,
    facts: {
      id,
      type,
      target: { message: str(payload.targetMessageId), swipe: num(payload.targetSwipeId) },
      speaker: { id: str(payload.characterId), name: str(payload.characterName) },
      model: str(payload.model)
    }
  };
}

class Generations {
  announced = new Map;
  held = new Map;
  started(payload, user) {
    const read = factsOf(payload);
    if (read === null || user === undefined)
      return;
    const key = `${user}\x00${read.chat}`;
    this.announced.set(key, read.facts);
    this.held.delete(key);
  }
  over(payload, user) {
    if (!isRecord(payload) || user === undefined)
      return;
    const chat = str(payload.chatId);
    const id = str(payload.generationId);
    if (chat === null || id === null)
      return;
    const key = `${user}\x00${chat}`;
    if (this.announced.get(key)?.id === id)
      this.announced.delete(key);
    if (this.held.get(key)?.generation === id)
      this.held.delete(key);
  }
  pending(user, chat) {
    return this.announced.get(`${user}\x00${chat}`) ?? null;
  }
  hold(user, chat, generation, handoff) {
    this.held.set(`${user}\x00${chat}`, { generation, handoff });
  }
  take(user, chat, type) {
    const key = `${user}\x00${chat}`;
    const facts = this.announced.get(key);
    if (facts === undefined || facts.type !== type)
      return null;
    this.announced.delete(key);
    return facts;
  }
  handoffFor(user, chat, generation) {
    const key = `${user}\x00${chat}`;
    const h = this.held.get(key);
    if (h === undefined || h.generation !== generation)
      return null;
    this.held.delete(key);
    return h.handoff;
  }
}

// src/ext/permissions.ts
var NEEDS = [
  { permission: "interceptor", why: "to leave history beyond your window out of a reply's prompt, and to mark the replies RPE plays" },
  { permission: "generation_parameters", why: "to carry that mark to RPE with the reply's request; without it RPE's replies are stopped" },
  { permission: "generation", why: "to hear when a reply starts, and to keep lore secrets out of prompts" },
  { permission: "cors_proxy", why: "to reach RPE on this machine, for the questions before each reply and for pages that cannot reach RPE themselves" },
  { permission: "ui_panels", why: "to open RPE's heads-up display and its panels in your chat" }
];
function missing(granted) {
  const have = new Set(granted);
  return NEEDS.filter((n) => !have.has(n.permission));
}

// src/adapter/lumiverse/pipe-wire.ts
var USER_HEADER = "x-rpe-user";
var START_PATH = "/api/v1/ext/start";
var LIVE_PATH = "/api/v1/ext/live";
var CONFIRM_PATH = "/api/v1/ext/confirm";
var STOPPED_PATH = "/api/v1/ext/stopped";
var ARRIVED_PATH = "/api/v1/ext/arrived";
var REGISTRATION_FILE = "rpe/registration.json";
var RPE_MARK_KEY = "rpe";
var RPE_MARK = Object.freeze({ v: 1 });
function rpeMarked(metadata) {
  return isRecord(metadata) && isRecord(metadata[RPE_MARK_KEY]);
}
var str2 = (v) => typeof v === "string" && v !== "";
var count = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
function headersOf(v) {
  if (v === undefined)
    return {};
  if (!isRecord(v))
    return null;
  const out = {};
  for (const [k, value] of Object.entries(v)) {
    if (typeof value !== "string")
      return null;
    out[k.toLowerCase()] = value;
  }
  return out;
}
function readRegistration(v) {
  if (!isRecord(v) || v.v !== 1 || !str2(v.base) || !str2(v.key) || !Array.isArray(v.connections) || !v.connections.every(str2) || !str2(v.relay) || typeof v.build !== "string")
    return null;
  if (!isRecord(v.values) || !count(v.values.questionMs) || !count(v.values.logChars) || v.values.whoseMs !== undefined && !count(v.values.whoseMs))
    return null;
  const { questionMs, logChars, whoseMs } = v.values;
  return { v: 1, base: v.base, key: v.key, connections: [...v.connections], relay: v.relay, build: v.build, values: { questionMs, logChars, ...whoseMs !== undefined ? { whoseMs } : {} } };
}
function readConfirmed(v) {
  return isRecord(v) && v.rpe === "confirmed" && str2(v.user) && str2(v.relay) ? { rpe: "confirmed", user: v.user, relay: v.relay } : null;
}
function readFromRpe(v) {
  if (!isRecord(v))
    return null;
  if (v.rpe === "register") {
    const registration = readRegistration(v.registration);
    return registration === null ? null : { rpe: "register", registration };
  }
  if (v.rpe === "live") {
    const part = partOf(v.part);
    if (!str2(v.key) || !str2(v.page) || !count(v.seq) || typeof v.data !== "string" || part === null)
      return null;
    return { rpe: "live", key: v.key, page: v.page, seq: v.seq, data: v.data, ...part !== undefined ? { part } : {} };
  }
  return null;
}
function partOf(v) {
  if (v === undefined)
    return;
  if (!isRecord(v))
    return null;
  const { index, count: total } = v;
  return count(index) && count(total) && index < total ? { index, count: total } : null;
}
function readFromPage(v) {
  if (!isRecord(v))
    return null;
  switch (v.rpe) {
    case "start":
      return { rpe: "start" };
    case "request": {
      const headers = headersOf(v.headers);
      if (!str2(v.id) || !str2(v.method) || !str2(v.path) || headers === null || v.body !== undefined && typeof v.body !== "string")
        return null;
      return { rpe: "request", id: v.id, method: v.method.toUpperCase(), path: v.path, headers, ...typeof v.body === "string" ? { body: v.body } : {} };
    }
    case "follow":
    case "unfollow":
      return str2(v.chat) ? { rpe: v.rpe, chat: v.chat } : null;
    case "drawer":
      return str2(v.id) ? { rpe: "drawer", id: v.id } : null;
    default:
      return null;
  }
}
function readStartFacts(v) {
  if (!isRecord(v) || !str2(v.token) || !count(v.expiresInMs) || !Array.isArray(v.addresses) || !v.addresses.every(str2) || typeof v.build !== "string")
    return null;
  if (!isRecord(v.road) || !count(v.road.requestMs) || !count(v.road.renewMs) || !isRecord(v.pageSettings))
    return null;
  const pageSettings = {};
  for (const [key, value] of Object.entries(v.pageSettings))
    if (typeof value === "number")
      pageSettings[key] = value;
  return { token: v.token, expiresInMs: v.expiresInMs, addresses: [...v.addresses], build: v.build, road: { requestMs: v.road.requestMs, renewMs: v.road.renewMs }, pageSettings };
}
function onLoopback(base) {
  let url;
  try {
    url = new URL(base);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return false;
  if (url.username !== "" || url.password !== "" || url.pathname !== "/" || /[?#]/.test(base))
    return false;
  const host = url.hostname;
  return host === "localhost" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

// src/ext/pipe.ts
var PAGE_HEADERS = ["authorization", "content-type", "accept", "if-none-match"];
var ANSWER_HEADERS = ["content-type", "etag", "cache-control"];
var words = (error) => error instanceof Error ? error.message : String(error);
var JAVASCRIPT_PATH = /\.(?:js|mjs|cjs|es)(?:[;/\\]|$)/i;
var TOO_LARGE = /CORS proxy response (too large|exceeded)/;
function startPipe(deps) {
  const { spindle: spindle2 } = deps;
  const pages = new Map;
  const seen = (user, page) => {
    const set = pages.get(user) ?? new Set;
    set.add(page);
    pages.set(user, set);
  };
  const toPage = (user, page, message) => spindle2.sendToFrontend(message, user, { frontendSessionId: page });
  const toRpe = async (user, message) => {
    const r = await deps.registrations.of(user).catch(() => null);
    if (r !== null)
      spindle2.sendToFrontend(message, user, { frontendSessionId: r.relay });
  };
  const call = async (road, path, body) => {
    const res = await spindle2.cors(`${road.base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...road.headers }, body: JSON.stringify(body) });
    let parsed = null;
    try {
      parsed = JSON.parse(res.body ?? "");
    } catch {}
    return { status: res.status, body: parsed };
  };
  const refusedWords = "RPE does not belong to your Lumiverse user, or it has not connected to Lumiverse yet.";
  async function start(user, page) {
    seen(user, page);
    const road = await deps.registrations.road(user);
    if (road === null)
      return toPage(user, page, { rpe: "start", facts: null, error: refusedWords, missing: deps.missing() });
    try {
      const answer = await call(road, START_PATH, {});
      const facts = answer.status === 200 ? readStartFacts(answer.body) : null;
      const error = facts !== null ? undefined : isRecord(answer.body) && typeof answer.body.error === "string" ? answer.body.error : `RPE answered ${answer.status}.`;
      toPage(user, page, { rpe: "start", facts, ...error !== undefined ? { error } : {}, missing: deps.missing() });
    } catch (error) {
      toPage(user, page, { rpe: "start", facts: null, error: `RPE was not reached through Lumiverse: ${words(error)}`, missing: deps.missing() });
    }
  }
  async function request(user, page, req) {
    const answer = (status, body, headers2 = { "content-type": "application/json" }) => toPage(user, page, { rpe: "response", id: req.id, status, headers: headers2, body });
    const road = await deps.registrations.road(user);
    if (road === null)
      return answer(403, JSON.stringify({ error: refusedWords }));
    let url;
    try {
      url = new URL(req.path, road.base);
    } catch {
      return answer(400, JSON.stringify({ error: "That is not a path of RPE's API." }));
    }
    if (url.origin !== new URL(road.base).origin || !url.pathname.startsWith("/api/v1/") || url.pathname.startsWith("/api/v1/ext/"))
      return answer(400, JSON.stringify({ error: "That is not a path of RPE's API." }));
    let decoded = url.pathname;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {}
    if (JAVASCRIPT_PATH.test(decoded))
      return answer(400, JSON.stringify({ error: "Lumiverse's proxy does not carry a path that names a JavaScript file; ask RPE directly." }));
    const headers = {};
    for (const name of PAGE_HEADERS)
      if (req.headers[name] !== undefined)
        headers[name] = req.headers[name];
    try {
      const res = await spindle2.cors(url.toString(), { method: req.method, headers, ...req.body !== undefined ? { body: req.body } : {} });
      const back = {};
      for (const [k, v] of Object.entries(res.headers ?? {}))
        if (ANSWER_HEADERS.includes(k.toLowerCase()))
          back[k.toLowerCase()] = v;
      answer(res.status, res.body ?? "", back);
    } catch (error) {
      if (TOO_LARGE.test(words(error)))
        return answer(413, JSON.stringify({ error: `RPE's answer is larger than Lumiverse's proxy carries (${words(error)}).` }));
      answer(502, JSON.stringify({ error: `RPE was not reached through Lumiverse: ${words(error)}` }));
    }
  }
  async function follow(user, page, chat, on) {
    seen(user, page);
    const road = await deps.registrations.road(user);
    if (road === null)
      return toPage(user, page, { rpe: "following", chat, error: refusedWords });
    try {
      const answer = await call(road, LIVE_PATH, { page, chat, follow: on });
      toPage(user, page, { rpe: "following", chat, ...answer.status === 200 ? {} : { error: isRecord(answer.body) && typeof answer.body.error === "string" ? answer.body.error : `RPE answered ${answer.status}.` } });
    } catch (error) {
      toPage(user, page, { rpe: "following", chat, error: `RPE was not reached through Lumiverse: ${words(error)}` });
    }
  }
  async function drawer(user, page, id) {
    try {
      await spindle2.ui.closeDrawer({ userId: user });
      toPage(user, page, { rpe: "drawer", id, closed: true });
    } catch (error) {
      deps.log(`Lumiverse's drawer was not closed for a page: ${words(error)}`);
      toPage(user, page, { rpe: "drawer", id, closed: false });
    }
  }
  const offMessage = spindle2.onFrontendMessage((payload, user, session) => {
    const fromRpe = readFromRpe(payload);
    if (fromRpe !== null) {
      (async () => {
        if (fromRpe.rpe === "register") {
          if (session === undefined)
            return;
          const refused = session !== fromRpe.registration.relay ? "it came from another socket than the one it names as RPE's." : await deps.registrations.keep(user, fromRpe.registration);
          if (refused !== null) {
            deps.log(`a registration for user ${user} was refused: ${refused}`);
            spindle2.sendToFrontend({ rpe: "refused", why: refused, missing: deps.missing() }, user, { frontendSessionId: session });
            deps.refused(user);
            return;
          }
          await toRpe(user, { rpe: "registered", missing: deps.missing(), build: deps.build });
          deps.registered(user);
          const record = untold.get(user);
          if (record !== undefined)
            tell(user, record);
          if (deps.statedHash !== null && !arrivedTold.has(user)) {
            arrivedTold.add(user);
            arrived(user, deps.statedHash);
          }
          return;
        }
        const r = await deps.registrations.of(user);
        if (r === null || r.key !== fromRpe.key)
          return;
        const { rpe: _rpe, key: _key, page, ...frame } = fromRpe;
        toPage(user, page, { rpe: "live", ...frame });
      })().catch((error) => deps.log(`a message from RPE was not handled: ${words(error)}`));
      return;
    }
    const fromPage = readFromPage(payload);
    if (fromPage === null || session === undefined)
      return;
    const work = fromPage.rpe === "start" ? start(user, session) : fromPage.rpe === "request" ? request(user, session, fromPage) : fromPage.rpe === "drawer" ? drawer(user, session, fromPage.id) : follow(user, session, fromPage.chat, fromPage.rpe === "follow");
    work.catch((error) => deps.log(`a page's message was not handled: ${words(error)}`));
  });
  const offClosed = spindle2.on("FRONTEND_SESSION_CLOSED", (payload, user) => {
    if (user === undefined || !isRecord(payload) || typeof payload.frontendSessionId !== "string")
      return;
    const page = payload.frontendSessionId;
    if (pages.get(user)?.delete(page) !== true)
      return;
    (async () => {
      const road = await deps.registrations.road(user);
      if (road !== null)
        await call(road, LIVE_PATH, { page, gone: true });
    })().catch((error) => deps.log(`RPE was not told a page closed: ${words(error)}`));
  });
  const arrivedTold = new Set;
  const arrived = (user, hash) => {
    (async () => {
      const road = await deps.registrations.road(user);
      if (road === null)
        return;
      const answer = await call(road, ARRIVED_PATH, { hash });
      const said = isRecord(answer.body) && typeof answer.body.words === "string" ? answer.body.words : `RPE answered ${answer.status}.`;
      deps.log(`RPE was told the app file this extension carries${isRecord(answer.body) && answer.body.taken === true ? ", and took it" : ""}: ${said}`);
    })().catch((error) => {
      arrivedTold.delete(user);
      deps.log(`RPE was not told the app file this extension carries: ${words(error)}`);
    });
  };
  const untold = new Map;
  const tell = (user, record) => {
    (async () => {
      const road = await deps.registrations.road(user);
      if (road === null) {
        untold.set(user, record);
        return;
      }
      const answer = await call(road, STOPPED_PATH, record);
      if (answer.status !== 200)
        throw new Error(`RPE answered ${answer.status}`);
      if (untold.get(user) === record)
        untold.delete(user);
    })().catch((error) => {
      untold.set(user, record);
      deps.log(`RPE was not told of the generation stopped in chat ${record.chat}: ${words(error)}`);
    });
  };
  return {
    permissions() {
      const missing2 = deps.missing();
      for (const user of deps.registrations.users()) {
        toRpe(user, { rpe: "permissions", missing: missing2 });
        for (const page of pages.get(user) ?? [])
          toPage(user, page, { rpe: "permissions", missing: missing2 });
      }
    },
    stopped(user, record) {
      deps.log(`generation ${record.generation ?? "(not announced)"} of chat ${record.chat} on connection ${record.connection} was stopped: the extension could not tell whether it is RPE's. The registration's read: ${record.registration}. The connection's record: ${record.mark}.`);
      tell(user, record);
    },
    stop() {
      offMessage();
      offClosed();
    }
  };
}

// src/adapter/lumiverse/wire.ts
var TAG_FIELD = "rpe_turn";
var QUESTION_PATH = "/api/v1/ext/question";
function textHash(text) {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 32);
}
function replyKindOf(type) {
  if (type === "normal")
    return "new";
  return type === "swipe" || type === "regenerate" || type === "continue" || type === "impersonate" ? type : null;
}
function historyCut(items, keep) {
  if (keep === null)
    return [];
  let first = items.length;
  for (let i = 0;i < items.length; i++) {
    const item = items[i];
    if (item !== undefined && item.history && item.index !== null && item.index >= keep.index) {
      first = i;
      break;
    }
  }
  const out = [];
  for (let i = 0;i < first; i++)
    if (items[i]?.history === true)
      out.push(i);
  return out;
}
function str3(v) {
  return typeof v === "string";
}
function int(v) {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}
function strOrNull(v) {
  return v === null || typeof v === "string";
}
function ids(v) {
  return Array.isArray(v) && v.every(str3);
}
function keepPoint(v) {
  if (v === null)
    return null;
  return isRecord(v) && str3(v.id) && int(v.index) ? { id: v.id, index: v.index } : undefined;
}
function verdictOf(v) {
  if (!isRecord(v) || !ids(v.disabled) || !ids(v.enabled) || !Array.isArray(v.mutated))
    return;
  const mutated = [];
  for (const m of v.mutated) {
    if (!isRecord(m) || !str3(m.id) || !str3(m.content))
      return;
    mutated.push({ id: m.id, content: m.content });
  }
  return { disabled: [...v.disabled], enabled: [...v.enabled], mutated };
}
function readAnswer(value) {
  if (!isRecord(value) || value.v !== 1)
    return null;
  const secrecy = value.secrecy === null ? null : verdictOf(value.secrecy);
  if (secrecy === undefined)
    return null;
  let cut;
  if (value.cut === null)
    cut = null;
  else if (isRecord(value.cut)) {
    const keep = keepPoint(value.cut.keep);
    if (keep === undefined)
      return null;
    cut = { keep };
  } else
    return null;
  const start = isRecord(value.start) && typeof value.start.known === "boolean" && strOrNull(value.start.turn) ? { known: value.start.known, turn: value.start.turn } : null;
  return { v: 1, secrecy, cut, start };
}

// src/ext/prompt.ts
class Stop extends Error {
}
var str4 = (v) => typeof v === "string" && v !== "" ? v : null;
function contextOf(raw) {
  if (!isRecord(raw))
    return null;
  const user = str4(raw.userId);
  const chat = str4(raw.chatId);
  if (user === null || chat === null)
    return null;
  return {
    user,
    chat,
    type: str4(raw.generationType),
    dryRun: raw.dryRun === true || raw.isDryRun === true,
    connection: str4(raw.connectionId),
    preset: str4(raw.presetId),
    persona: str4(raw.personaId)
  };
}
function textOfContent(content) {
  if (typeof content === "string")
    return { text: content, media: 0 };
  if (!Array.isArray(content))
    return { text: "", media: 0 };
  const texts = [];
  let media = 0;
  for (const part of content) {
    if (isRecord(part) && part.type === "text" && typeof part.text === "string")
      texts.push(part.text);
    else
      media++;
  }
  return { text: texts.join(""), parts: texts.map((t) => t.length), media };
}
function continuedTarget(messages, noted) {
  if (noted === null || noted.text === "")
    return null;
  for (let i = messages.length - 1;i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant" || m.__isChatHistory === true)
      continue;
    return textOfContent(m.content).text.startsWith(noted.text) ? noted.id : null;
  }
  return null;
}
function listedMessage(m) {
  const role = m.role === "system" || m.role === "assistant" ? m.role : "user";
  const { text, parts, media } = textOfContent(m.content);
  return {
    role,
    length: text.length,
    hash: textHash(text),
    ...text.trim().length === 0 ? { blank: true } : {},
    ...m.__isChatHistory === true ? { history: true } : {},
    ...m.__isChatHistory === true && typeof m.sourceMessageId === "string" && typeof m.sourceIndexInChat === "number" ? { source: { id: m.sourceMessageId, index: m.sourceIndexInChat } } : {},
    ...m.__isWorldInfoEntry === true ? { lore: true } : {},
    ...m.__isChatHistory === true && m.__cortexHistorySummary === true ? { summary: true } : {},
    ...m.partial === true ? { partial: true } : {},
    ...parts !== undefined ? { parts } : {},
    ...media > 0 ? { media } : {}
  };
}
function promptInterceptor(deps) {
  return async (messages, context) => {
    let ours = false;
    try {
      const ctx = contextOf(context);
      if (ctx === null || ctx.dryRun || ctx.connection === null)
        return messages;
      const kind = replyKindOf(ctx.type);
      if (kind === null || ctx.type === null)
        return messages;
      const whose = await deps.whose(ctx.connection, ctx.user);
      if ("unknown" in whose) {
        deps.stopped(ctx.user, { at: Date.now(), chat: ctx.chat, generation: deps.generations.pending(ctx.user, ctx.chat)?.id ?? null, connection: ctx.connection, registration: whose.unknown.registration, mark: whose.unknown.mark });
        throw new Stop("RPE stopped this reply: its extension could not tell whether this chat is one RPE plays, because neither RPE's registration nor this connection's record in Lumiverse could be read. Send it again; RPE's log says what failed.");
      }
      ours = whose.rpe;
      if (!ours)
        return messages;
      if (!deps.granted("generation_parameters"))
        throw new Stop("RPE stopped this reply rather than send it without RPE: its extension may not add to a reply's request. Grant RPE's extension the \u201Cgeneration_parameters\u201D permission in Lumiverse.");
      const generation = deps.generations.take(ctx.user, ctx.chat, ctx.type);
      if (generation === null)
        throw new Stop("RPE stopped this reply: its extension could not pair this prompt with a generation it heard begin, as when Lumiverse started the extension again while the generation was under way. Send it again.");
      const handoff = deps.generations.handoffFor(ctx.user, ctx.chat, generation.id);
      const cut = handoff?.cut ?? null;
      const left = new Set(cut === null ? [] : historyCut(messages.map((m) => ({ history: m.__isChatHistory === true, index: typeof m.sourceIndexInChat === "number" ? m.sourceIndexInChat : null })), cut.keep));
      const kept = left.size === 0 ? messages : messages.filter((_, i) => !left.has(i));
      const tag = {
        v: 1,
        user: ctx.user,
        chat: ctx.chat,
        generation: generation.id,
        kind,
        target: kind === "continue" ? { message: continuedTarget(messages, handoff?.continued ?? null), swipe: generation.target.swipe } : generation.target,
        speaker: generation.speaker,
        connection: ctx.connection,
        preset: ctx.preset,
        persona: ctx.persona,
        cut: cut === null ? { answered: false } : { answered: true, keep: cut.keep, removed: left.size },
        secrecy: handoff?.secrecy ?? { by: "extension", why: "no question was asked for this prompt" },
        question: handoff?.question ?? null,
        messages: kept.map(listedMessage)
      };
      return { messages: kept, parameters: { [TAG_FIELD]: tag } };
    } catch (error) {
      if (error instanceof Stop)
        throw error;
      if (!ours) {
        deps.log(`a prompt not on RPE's connection went on untouched after the extension failed: ${error instanceof Error ? error.message : String(error)}`);
        return messages;
      }
      throw new Error(`RPE stopped this reply before it was sent, because its extension failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}

// src/shared/hash.ts
var C1 = 597399067;
var C2 = 2869860233;
var C3 = 951274213;
var C4 = 2716044179;
function rotl32(x, r) {
  return x << r | x >>> 32 - r;
}
function fmix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h;
}
function mixK1(k) {
  return Math.imul(rotl32(Math.imul(k, C1), 15), C2);
}
function mixK2(k) {
  return Math.imul(rotl32(Math.imul(k, C2), 16), C3);
}
function mixK3(k) {
  return Math.imul(rotl32(Math.imul(k, C3), 17), C4);
}
function mixK4(k) {
  return Math.imul(rotl32(Math.imul(k, C4), 18), C1);
}
function hashBytes(bytes, seed = 0) {
  const len = bytes.length;
  const blocks = len >>> 4;
  let h1 = seed | 0, h2 = seed | 0, h3 = seed | 0, h4 = seed | 0;
  const word = (i) => bytes[i] | bytes[i + 1] << 8 | bytes[i + 2] << 16 | bytes[i + 3] << 24 | 0;
  for (let b = 0;b < blocks; b++) {
    const o = b << 4;
    h1 ^= mixK1(word(o));
    h1 = rotl32(h1, 19);
    h1 = h1 + h2 | 0;
    h1 = Math.imul(h1, 5) + 1444728091 | 0;
    h2 ^= mixK2(word(o + 4));
    h2 = rotl32(h2, 17);
    h2 = h2 + h3 | 0;
    h2 = Math.imul(h2, 5) + 197830471 | 0;
    h3 ^= mixK3(word(o + 8));
    h3 = rotl32(h3, 15);
    h3 = h3 + h4 | 0;
    h3 = Math.imul(h3, 5) + 2530024501 | 0;
    h4 ^= mixK4(word(o + 12));
    h4 = rotl32(h4, 13);
    h4 = h4 + h1 | 0;
    h4 = Math.imul(h4, 5) + 850148119 | 0;
  }
  const t = blocks << 4;
  const rem = len & 15;
  let k1 = 0, k2 = 0, k3 = 0, k4 = 0;
  for (let i = rem - 1;i >= 12; i--)
    k4 ^= bytes[t + i] << (i - 12 << 3);
  for (let i = Math.min(rem, 12) - 1;i >= 8; i--)
    k3 ^= bytes[t + i] << (i - 8 << 3);
  for (let i = Math.min(rem, 8) - 1;i >= 4; i--)
    k2 ^= bytes[t + i] << (i - 4 << 3);
  for (let i = Math.min(rem, 4) - 1;i >= 0; i--)
    k1 ^= bytes[t + i] << (i << 3);
  if (rem > 12)
    h4 ^= mixK4(k4);
  if (rem > 8)
    h3 ^= mixK3(k3);
  if (rem > 4)
    h2 ^= mixK2(k2);
  if (rem > 0)
    h1 ^= mixK1(k1);
  h1 ^= len;
  h2 ^= len;
  h3 ^= len;
  h4 ^= len;
  h1 = h1 + h2 | 0;
  h1 = h1 + h3 | 0;
  h1 = h1 + h4 | 0;
  h2 = h2 + h1 | 0;
  h3 = h3 + h1 | 0;
  h4 = h4 + h1 | 0;
  h1 = fmix32(h1);
  h2 = fmix32(h2);
  h3 = fmix32(h3);
  h4 = fmix32(h4);
  h1 = h1 + h2 | 0;
  h1 = h1 + h3 | 0;
  h1 = h1 + h4 | 0;
  h2 = h2 + h1 | 0;
  h3 = h3 + h1 | 0;
  h4 = h4 + h1 | 0;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}
function encodeUtf8(s) {
  const pairAt = (i) => (s.charCodeAt(i) & 64512) === 55296 && i + 1 < s.length && (s.charCodeAt(i + 1) & 64512) === 56320;
  let size = 0;
  for (let i = 0;i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 128)
      size += 1;
    else if (c < 2048)
      size += 2;
    else if (pairAt(i)) {
      size += 4;
      i++;
    } else
      size += 3;
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (let i = 0;i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 128) {
      out[o++] = c;
      continue;
    }
    if (c < 2048) {
      out[o++] = 192 | c >> 6;
      out[o++] = 128 | c & 63;
      continue;
    }
    if (pairAt(i)) {
      c = 65536 + (c - 55296 << 10) + (s.charCodeAt(++i) - 56320);
      out[o++] = 240 | c >> 18;
      out[o++] = 128 | c >> 12 & 63;
      out[o++] = 128 | c >> 6 & 63;
      out[o++] = 128 | c & 63;
      continue;
    }
    if (c >= 55296 && c <= 57343)
      c = 65533;
    out[o++] = 224 | c >> 12;
    out[o++] = 128 | c >> 6 & 63;
    out[o++] = 128 | c & 63;
  }
  return out;
}
var TAG_STRING = 115;
var TAG_NUMBER = 110;
var TAG_BOOLEAN = 98;
var TAG_NULL = 122;
function encodeParts(parts) {
  const payloads = new Array(parts.length);
  const tags = new Array(parts.length);
  let size = 0;
  for (let i = 0;i < parts.length; i++) {
    const p = parts[i];
    let payload;
    if (typeof p === "string") {
      tags[i] = TAG_STRING;
      payload = encodeUtf8(p);
    } else if (typeof p === "number") {
      if (!Number.isFinite(p))
        throw new TypeError(`hash part ${i} must be a finite number, got ${p}`);
      tags[i] = TAG_NUMBER;
      payload = encodeUtf8(String(p));
    } else if (typeof p === "boolean") {
      tags[i] = TAG_BOOLEAN;
      payload = new Uint8Array([p ? 1 : 0]);
    } else if (p === null) {
      tags[i] = TAG_NULL;
      payload = new Uint8Array(0);
    } else
      throw new TypeError(`hash part ${i} must be a string, number, boolean or null`);
    payloads[i] = payload;
    size += 5 + payload.length;
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (let i = 0;i < parts.length; i++) {
    const n = payloads[i].length;
    out[o++] = tags[i];
    out[o++] = n & 255;
    out[o++] = n >>> 8 & 255;
    out[o++] = n >>> 16 & 255;
    out[o++] = n >>> 24 & 255;
    out.set(payloads[i], o);
    o += n;
  }
  return out;
}
function hashWords(...parts) {
  return hashBytes(encodeParts(parts));
}
function hashParts(...parts) {
  let s = "";
  for (const w of hashWords(...parts))
    s += w.toString(16).padStart(8, "0");
  return s;
}

// src/shared/ledger.ts
var LEDGER_NAMESPACE = "lumi_rp_engine";

// src/shared/steps.ts
var RETIRED_SIGNALS = new Map([["classifier", "typed_input"]]);
var STEP_OUTPUTS = {
  interpret: ["decision", "text"],
  "npc.choose": ["decision", "text"],
  "puzzle.answer": ["decision", "text"],
  brief: ["text"],
  outline: ["text"],
  extract: ["text", "effects"],
  choices: ["text", "effects"],
  judge: ["decision", "text"],
  mind: ["text"],
  memory: ["text"],
  skip: ["text"],
  consolidate: ["text"],
  knowledge: ["text"]
};

// src/shared/lore.ts
var LORE_AUDIENCE = Object.keys(STEP_OUTPUTS);
function loreIsSecret(entry) {
  return entry.secret !== undefined && entry.secret !== false;
}
function loreSourceOf(raw) {
  if (!isRecord(raw))
    return { kind: "authored" };
  if (raw.kind === "book" && typeof raw.bookId === "string" && typeof raw.entryId === "string" && typeof raw.hash === "string")
    return { kind: "book", bookId: raw.bookId, entryId: raw.entryId, hash: raw.hash };
  if (raw.kind === "chat" && typeof raw.chatId === "string" && typeof raw.messageId === "string")
    return { kind: "chat", chatId: raw.chatId, messageId: raw.messageId };
  if (raw.kind === "ai" && (raw.status === "pending" || raw.status === "accepted"))
    return { kind: "ai", status: raw.status };
  return { kind: "authored" };
}
function withoutOldSecrecy(fields) {
  if (!fields)
    return null;
  const { secret: _secret, gate: _gate, audience: _audience, holders: _holders, ...rest } = fields;
  return Object.keys(rest).length > 0 ? rest : null;
}
function secretCopyOf(extensions) {
  const ns = isRecord(extensions) ? extensions[LEDGER_NAMESPACE] : undefined;
  const raw = isRecord(ns) ? ns.secretCopyOf : undefined;
  if (!isRecord(raw) || typeof raw.entry !== "string")
    return null;
  return { entry: raw.entry, off: raw.off === true, fields: isRecord(raw.fields) ? bookLoreFieldsOf({ [LEDGER_NAMESPACE]: { lore: raw.fields } }) : null };
}
function bookLoreFieldsOf(extensions) {
  const ns = isRecord(extensions) ? extensions[LEDGER_NAMESPACE] : undefined;
  const raw = isRecord(ns) ? ns.lore : undefined;
  if (!isRecord(raw))
    return null;
  const ids2 = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string" && x !== "") : undefined;
  const out = {};
  if (raw.secret !== undefined)
    out.secret = raw.secret !== false;
  if (typeof raw.gate === "string")
    out.gate = raw.gate;
  const audience = ids2(raw.audience)?.filter((p) => LORE_AUDIENCE.includes(p));
  if (audience)
    out.audience = audience;
  const links = ids2(raw.links);
  if (links)
    out.links = links;
  const aliases = ids2(raw.aliases);
  if (aliases)
    out.aliases = aliases;
  const holders = ids2(raw.holders);
  if (holders)
    out.holders = holders;
  if (raw.visibility === "public" || raw.visibility === "known_by")
    out.visibility = raw.visibility;
  else if (raw.visibility !== undefined) {
    out.visibility = "known_by";
    out.links = [];
  }
  return out;
}
function engineWroteEntry(extensions) {
  const ns = isRecord(extensions) ? extensions[LEDGER_NAMESPACE] : undefined;
  return isRecord(ns) && (typeof ns.slot === "string" || typeof ns.twin === "string" || typeof ns.narrator === "string" || typeof ns.lore === "string" || typeof ns.loreIndex === "string");
}
var pinsRead = new WeakMap;

// src/shared/secret-marks.ts
var CANDIDATE = /\{\{(\s*)\/\/(\s*)secret(?![A-Za-z0-9_-])/iy;
var CLAUSE = /^(known[ \t]+to|kept[ \t]+from)(?:[ \t]+([^]*))?$/i;
var NOT_IN_NAME = /[,;():{}\\\r\n]/;
var NONE = { marks: [], unreadable: [] };
var isEveryone = (name) => name.trim().toLowerCase() === "everyone";
var sameName = (a, b) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();
function extent(content, start) {
  let depth = 1;
  let nested = false;
  let escaped = false;
  let pos = start + 2;
  while (pos < content.length) {
    const ch = content[pos];
    const next = content[pos + 1];
    if (ch === "\\" && (next === "{" || next === "}")) {
      escaped = true;
      pos += 2;
    } else if (ch === "{" && next === "{") {
      nested = true;
      depth++;
      pos += 2;
    } else if (ch === "}" && next === "}") {
      depth--;
      pos += 2;
      if (depth === 0)
        return { end: pos, nested, escaped, closed: true };
    } else
      pos++;
  }
  return { end: content.length, nested, escaped, closed: false };
}
function namesOf(text) {
  const out = [];
  for (const raw of text.split(",")) {
    const name = raw.trim().replace(/\s+/g, " ");
    if (name === "")
      return "a name is missing in the brackets";
    if (NOT_IN_NAME.test(name))
      return `"${name}" can't be a name: a name holds no brackets, braces, colon, semicolon or backslash`;
    if (!out.some((n) => sameName(n, name)))
      out.push(name);
  }
  return out;
}
function clausesOf(text) {
  const parts = text.split(";").map((p) => p.trim());
  if (parts.length > 2)
    return 'the brackets hold at most two parts: "known to \u2026; kept from \u2026"';
  let knownTo = null;
  let keptFrom = null;
  for (const part of parts) {
    const m = CLAUSE.exec(part);
    if (!m)
      return part === "" ? "a part in the brackets is empty" : `"${part}" must start with "known to" or "kept from"`;
    const names = namesOf(m[2] ?? "");
    if (typeof names === "string")
      return names;
    if (/^known/i.test(m[1] ?? "")) {
      if (knownTo)
        return '"known to" is given twice';
      if (names.some(isEveryone))
        return "a secret can't be known to everyone";
      knownTo = names;
    } else {
      if (keptFrom)
        return '"kept from" is given twice';
      if (names.some(isEveryone) && names.length > 1)
        return '"everyone" stands alone after "kept from"';
      keptFrom = names.some(isEveryone) ? "everyone" : names;
    }
  }
  const known = knownTo ?? [];
  const kept = keptFrom ?? "everyone";
  const both = kept === "everyone" ? undefined : known.find((n) => kept.some((k) => sameName(k, n)));
  if (both !== undefined)
    return `${both} is named as knowing it and as kept from it`;
  return { knownTo: known, keptFrom: kept };
}
function markOf(raw, head) {
  const body = raw.slice(0, -2);
  const skip = (at) => {
    let pos2 = at;
    while (body[pos2] === " " || body[pos2] === "\t")
      pos2++;
    return pos2;
  };
  let pos = skip(head);
  let names = { knownTo: [], keptFrom: "everyone" };
  if (body[pos] === "(") {
    const close = body.indexOf(")", pos + 1);
    const colon = body.indexOf(":", pos + 1);
    if (close < 0 || colon >= 0 && colon < close)
      return "the brackets after Secret aren't closed before the colon";
    names = clausesOf(body.slice(pos + 1, close));
    pos = skip(close + 1);
  }
  if (body[pos] !== ":")
    return 'Secret needs a colon before its text, with any names in brackets before that: "{{// Secret (known to NAME): TEXT}}"';
  if (/[\r\n]/.test(body.slice(0, pos)))
    return "everything before the colon must be on one line";
  if (typeof names === "string")
    return names;
  const text = body.slice(pos + 1).trim();
  if (text === "")
    return "it has no text after the colon";
  return { text, ...names };
}
function scan(content) {
  if (!content.includes("{{") || !/\/\/\s*secret/i.test(content))
    return NONE;
  const out = { marks: [], unreadable: [] };
  let depth = 0;
  let pos = 0;
  while (pos < content.length) {
    const ch = content[pos];
    const next = content[pos + 1];
    if (ch === "\\" && (next === "{" || next === "}")) {
      pos += 2;
      continue;
    }
    if (ch === "}" && next === "}") {
      if (depth > 0)
        depth--;
      pos += 2;
      continue;
    }
    if (ch !== "{" || next !== "{") {
      pos++;
      continue;
    }
    CANDIDATE.lastIndex = pos;
    const head = CANDIDATE.exec(content);
    if (!head) {
      depth++;
      pos += 2;
      continue;
    }
    const at = extent(content, pos);
    const raw = content.slice(pos, at.end);
    const unreadable = (problem) => {
      out.unreadable.push({ start: pos, end: at.end, raw, problem });
    };
    if (/[\r\n]/.test(head[1] ?? ""))
      unreadable("a line break between {{ and // leaves it in every prompt: the host doesn't read it as a comment");
    else if (depth > 0)
      unreadable("it stands inside another macro, which the host drops it from");
    else if (!at.closed)
      unreadable("it has no closing }}, so the host hides the rest of the entry with it");
    else if (at.nested)
      unreadable("it holds {{ or }}, which a secret mark can't: the host may end it elsewhere");
    else if (at.escaped)
      unreadable("it holds a backslash before a brace, which a secret mark can't: the host may end it elsewhere");
    else if (/[\r\n]/.test(head[2] ?? ""))
      unreadable("everything before the colon must be on one line");
    else {
      const mark = markOf(raw, head[0].length);
      if (typeof mark === "string")
        unreadable(mark);
      else
        out.marks.push({ start: pos, end: at.end, raw, ...mark });
    }
    pos = at.end;
  }
  return out;
}
function parseSecretMarks(content) {
  return scan(content).marks;
}
function unreadableMarks(content) {
  return scan(content).unreadable;
}
function hasSecretMarks(content) {
  return scan(content).marks.length > 0;
}
function wholeEntrySecret(content) {
  const { marks, unreadable } = scan(content);
  const mark = marks[0];
  if (!mark || marks.length !== 1 || unreadable.length > 0)
    return null;
  return content.slice(0, mark.start).trim() === "" && content.slice(mark.end).trim() === "" ? mark : null;
}
function renderSecretMarks(content, render) {
  const { marks, unreadable } = scan(content);
  if (marks.length === 0 && unreadable.length === 0)
    return content;
  const spans = [...marks.map((mark, i) => ({ mark, n: i + 1, start: mark.start, end: mark.end })), ...unreadable.map((u) => ({ mark: null, n: 0, start: u.start, end: u.end }))].sort((a, b) => a.start - b.start);
  let out = "";
  let at = 0;
  for (const span of spans) {
    out += content.slice(at, span.start) + (span.mark ? render(span.mark, span.n) : "");
    at = span.end;
  }
  return out + content.slice(at);
}
function publicText(content) {
  return renderSecretMarks(content, () => "");
}
var POV_WORDS = /^(you|the player character|player character)$/i;
function nameMatcher(world, state) {
  const named = new Map;
  for (const source of [world, state]) {
    if (!source)
      continue;
    for (const [id, e] of Object.entries(source.entities)) {
      const name = typeof e?.name === "string" ? e.name.trim().replace(/\s+/g, " ").toLowerCase() : "";
      const names = named.get(id) ?? [];
      if (name !== "" && !names.includes(name))
        names.push(name);
      named.set(id, names);
    }
  }
  const pov = state?.pov ?? world.pov;
  return (written) => {
    const raw = written.trim();
    if (pov !== undefined && POV_WORDS.test(raw))
      return [pov];
    if (named.has(raw))
      return [raw];
    const n = raw.replace(/\s+/g, " ").toLowerCase();
    const byId = [...named.keys()].filter((id) => id.toLowerCase() === n);
    if (byId.length === 1)
      return byId;
    const ids2 = [...named.entries()];
    const whole = ids2.filter(([, names]) => names.includes(n)).map(([id]) => id);
    if (whole.length > 0 || n.includes(" "))
      return whole;
    return ids2.filter(([, names]) => names.some((name) => name.split(" ").includes(n))).map(([id]) => id);
  };
}
function resolveMarkNames(world, state, mark) {
  const match = nameMatcher(world, state);
  const unresolved = [];
  const resolve = (names) => {
    const out = [];
    for (const name of names) {
      const [id, ...more] = match(name);
      if (id === undefined || more.length > 0) {
        if (!unresolved.includes(name))
          unresolved.push(name);
      } else if (!out.includes(id))
        out.push(id);
    }
    return out;
  };
  return { knownTo: resolve(mark.knownTo), keptFrom: mark.keptFrom === "everyone" ? "everyone" : resolve(mark.keptFrom), unresolved };
}

// src/secrecy/lore-secrets.ts
function textOf(content) {
  const text = content.replace(/\s+/g, " ").trim();
  return text === "" ? "" : hashParts("lre-lore-text-v1", text);
}
var TEXT_KEYS = new WeakMap;
function heldTextOf(holder, content) {
  if (!Object.isFrozen(holder))
    return textOf(content);
  let key = TEXT_KEYS.get(holder);
  if (key === undefined) {
    key = textOf(content);
    TEXT_KEYS.set(holder, key);
  }
  return key;
}
function keyOf(e) {
  return `${e.bookId}/${e.id}`;
}
function copyOriginal(copy) {
  const slash = copy.entry.indexOf("/");
  return { bookId: copy.entry.slice(0, Math.max(0, slash)), entryId: copy.entry.slice(slash + 1) };
}
function restricts(fields) {
  return loreIsSecret(fields) || fields.visibility === "known_by";
}
function worldFields(entry) {
  const secret = loreIsSecret(entry);
  const visibility = entry.visibility;
  const knownBy = visibility !== undefined && visibility !== "public";
  if (!secret && !knownBy)
    return null;
  const ids2 = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string" && x !== "") : [];
  const out = {};
  if (secret) {
    out.secret = true;
    out.gate = typeof entry.gate === "string" ? entry.gate : "";
  }
  const audience = ids2(entry.audience).filter((p) => LORE_AUDIENCE.includes(p));
  if (audience.length > 0)
    out.audience = audience;
  const holders = ids2(entry.holders);
  if (holders.length > 0)
    out.holders = holders;
  if (knownBy) {
    out.visibility = "known_by";
    out.links = visibility === "known_by" ? ids2(entry.links) : [];
  }
  return out;
}
function add(map, key, fields) {
  if (key === "")
    return;
  const list = map.get(key);
  if (list)
    list.push(fields);
  else
    map.set(key, [fields]);
}
function markFields(world, mark) {
  const holders = world ? resolveMarkNames(world, null, mark).knownTo : [];
  return { secret: true, gate: "", ...holders.length > 0 ? { holders } : {} };
}
var MARKS = new WeakMap;
function marksAt(e) {
  const kept = MARKS.get(e);
  if (kept)
    return kept;
  const whole = wholeEntrySecret(e.content);
  const out = whole ? [{ mark: whole, bookId: e.bookId, entryId: e.id, n: null }] : parseSecretMarks(e.content).map((mark, i) => ({ mark, bookId: e.bookId, entryId: e.id, n: i + 1 }));
  if (Object.isFrozen(e))
    MARKS.set(e, out);
  return out;
}
var UNREAD_ORIGINAL = { secret: true, gate: "" };
function secretTexts(also = {}) {
  const entries = (also.entries ?? []).filter((e) => !engineWroteEntry(e.extensions));
  const out = { texts: new Map, sources: new Map, originals: new Map, marks: new Map, read: new Set(entries.map((e) => e.id)) };
  const given = new Map(entries.map((e) => [e.id, e]));
  for (const entry of Object.values(also.world?.lore ?? {})) {
    const fields = worldFields(entry);
    if (!fields)
      continue;
    add(out.texts, textOf(typeof entry.content === "string" ? entry.content : ""), fields);
    const source = loreSourceOf(entry.source);
    if (source.kind !== "book")
      continue;
    add(out.sources, `${source.bookId}/${source.entryId}`, fields);
    const now = given.get(source.entryId);
    if (now)
      add(out.texts, heldTextOf(now, now.content), fields);
  }
  for (const e of entries) {
    const marks = marksAt(e);
    if (marks.length > 0) {
      for (const at of marks) {
        const key = textOf(at.mark.text);
        if (key === "" || out.marks.has(key))
          continue;
        out.marks.set(key, at);
        add(out.texts, key, markFields(also.world ?? null, at.mark));
      }
      continue;
    }
    if (secretCopyOf(e.extensions) !== null)
      continue;
    const fields = bookLoreFieldsOf(e.extensions);
    if (!fields || !restricts(fields))
      continue;
    add(out.texts, heldTextOf(e, e.content), fields);
    if (loreIsSecret(fields))
      out.originals.set(e.id, fields);
  }
  return out;
}
function stricter(all) {
  const out = {};
  const secrets = all.filter((f) => loreIsSecret(f));
  if (secrets.length > 0) {
    const gates = [...new Set(secrets.map((f) => (f.gate ?? "").trim()))].sort();
    out.secret = true;
    out.gate = gates.includes("") ? "" : gates.length === 1 ? gates[0] ?? "" : gates.map((g) => `(${g})`).join(" && ");
  }
  const joined = (pick) => {
    const lists = all.map(pick).filter((list) => list !== undefined);
    return lists.length === 0 ? undefined : [...new Set(lists.flat())];
  };
  const audience = joined((f) => f.audience)?.filter((p) => LORE_AUDIENCE.includes(p));
  if (audience)
    out.audience = audience;
  const holders = joined((f) => f.holders);
  if (holders)
    out.holders = holders;
  const links = joined((f) => f.links);
  const knownBy = all.filter((f) => f.visibility === "known_by");
  if (knownBy.length > 0) {
    out.visibility = "known_by";
    out.links = knownBy.some((f) => (f.links ?? []).length === 0) ? [] : links ?? [];
  } else if (links)
    out.links = links;
  const aliases = joined((f) => f.aliases);
  if (aliases)
    out.aliases = aliases;
  return out;
}
function secrecyParts(e, texts) {
  if (engineWroteEntry(e.extensions))
    return [];
  const out = [];
  const marked = hasSecretMarks(e.content);
  const own = marked ? withoutOldSecrecy(bookLoreFieldsOf(e.extensions)) : bookLoreFieldsOf(e.extensions);
  if (own)
    out.push(own);
  const copy = marked ? null : secretCopyOf(e.extensions);
  if (copy?.fields)
    out.push(copy.fields);
  const named = copy ? copyOriginal(copy).entryId : null;
  const original = named !== null && named !== e.id ? texts.originals.get(named) : undefined;
  if (original)
    out.push(original);
  else if (named !== null && named !== e.id && !texts.read.has(named) && !(own && loreIsSecret(own)))
    out.push(UNREAD_ORIGINAL);
  out.push(...texts.sources.get(keyOf(e)) ?? []);
  if (copy && copy.entry !== keyOf(e))
    out.push(...texts.sources.get(copy.entry) ?? []);
  if (!marked)
    out.push(...texts.texts.get(heldTextOf(e, e.content)) ?? []);
  return out;
}
function bookSecrecy(e, texts) {
  const parts = secrecyParts(e, texts);
  return parts.length === 0 ? null : stricter(parts);
}

// src/adapter/lumiverse/candidate.ts
function questionEntryOf(e) {
  const own = e.extensions[LEDGER_NAMESPACE];
  const telling = hasSecretMarks(e.content) || unreadableMarks(e.content).length > 0 || isRecord(own);
  return {
    id: e.id,
    book: e.bookId,
    disabled: e.disabled,
    key: textOf(e.content),
    ...telling ? { content: e.content, comment: e.comment, ...isRecord(own) ? { extensions: { [LEDGER_NAMESPACE]: own } } : {} } : {}
  };
}

// src/secrecy/blind.ts
function usersOwn(entries) {
  return entries.filter((e) => !engineWroteEntry(e.extensions));
}
function blind(entries) {
  const texts = secretTexts({ entries });
  const out = { disabled: [], enabled: [], mutated: [] };
  for (const e of entries) {
    if (hasSecretMarks(e.content) || unreadableMarks(e.content).length > 0) {
      if (wholeEntrySecret(e.content))
        out.disabled.push(e.id);
      else
        out.mutated.push({ id: e.id, content: publicText(e.content) });
    } else if (texts.marks.has(textOf(e.content)) || loreIsSecret(bookSecrecy(e, texts) ?? {}))
      out.disabled.push(e.id);
  }
  return out;
}

// src/ext/fail-closed.ts
function failClosed(entries) {
  const verdict = blind(usersOwn(entries));
  return { disabled: [...verdict.disabled], enabled: [...verdict.enabled], mutated: [...verdict.mutated ?? []] };
}

// src/ext/road.ts
async function ask(proxy, road, question) {
  const asked = performance.now();
  const deadline = Promise.withResolvers();
  const timer = setTimeout(() => deadline.resolve({ none: `RPE gave no answer within ${road.waitMs} ms` }), road.waitMs);
  const answering = (async () => {
    const res = await proxy(`${road.base}${QUESTION_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...road.headers }, body: JSON.stringify(question) });
    if (res.status !== 200)
      return { none: `RPE answered ${res.status}${res.body ? `: ${res.body.slice(0, road.logChars)}` : ""}` };
    let parsed;
    try {
      parsed = JSON.parse(res.body ?? "");
    } catch {
      return { none: "RPE's answer is not JSON" };
    }
    const answer = readAnswer(parsed);
    return answer === null ? { none: "RPE's answer is not one this extension reads" } : { answer };
  })().catch((error) => ({ none: `RPE was not reached (${error instanceof Error ? error.message : String(error)})` }));
  try {
    const reply = await Promise.race([answering, deadline.promise]);
    return { ...reply, ms: Math.min(road.waitMs, Math.round(performance.now() - asked)) };
  } finally {
    clearTimeout(timer);
  }
}

// src/ext/question.ts
function contextOf2(raw) {
  if (!isRecord(raw) || typeof raw.userId !== "string" || raw.userId === "" || typeof raw.chatId !== "string")
    return null;
  const path = [];
  let lastReply = null;
  for (const m of Array.isArray(raw.messages) ? raw.messages : []) {
    if (!isRecord(m) || typeof m.id !== "string" || typeof m.index_in_chat !== "number")
      continue;
    const text = typeof m.content === "string" ? m.content : "";
    path.push({ id: m.id, index: m.index_in_chat, swipe: typeof m.swipe_id === "number" ? m.swipe_id : null, user: m.is_user === true, hash: textHash(text) });
    if (m.is_user !== true && (lastReply === null || m.index_in_chat > lastReply.index))
      lastReply = { id: m.id, index: m.index_in_chat, text };
  }
  const candidates = [];
  for (const e of Array.isArray(raw.entries) ? raw.entries : []) {
    if (!isRecord(e) || typeof e.id !== "string")
      continue;
    candidates.push({ id: e.id, bookId: typeof e.world_book_id === "string" ? e.world_book_id : "", disabled: e.disabled === true, extensions: isRecord(e.extensions) ? e.extensions : {}, comment: typeof e.comment === "string" ? e.comment : "", content: typeof e.content === "string" ? e.content : "" });
  }
  return { user: raw.userId, chat: raw.chatId, purpose: raw.purpose === "query" ? "query" : "prompt", path, candidates, lastReply: lastReply === null ? null : { id: lastReply.id, text: lastReply.text } };
}
function worldInfoInterceptor(deps) {
  return async (raw) => {
    const ctx = contextOf2(raw);
    if (ctx === null)
      return {};
    const generation = ctx.purpose === "prompt" ? deps.generations.pending(ctx.user, ctx.chat) : null;
    const continued = generation !== null && replyKindOf(generation.type) === "continue" ? ctx.lastReply : null;
    const handOn = (handoff) => {
      if (generation !== null)
        deps.generations.hold(ctx.user, ctx.chat, generation.id, { ...handoff, continued });
    };
    const fallBack = (why, question) => {
      deps.log(`chat ${ctx.chat}: ${why}, so its secrets stay out of this prompt`);
      handOn({ cut: null, secrecy: { by: "extension", why }, question });
      return failClosed(ctx.candidates);
    };
    try {
      const road = await deps.road(ctx.user);
      if (road === null) {
        handOn({ cut: null, secrecy: { by: "extension", why: "RPE has not registered with the extension for this user" }, question: null });
        return failClosed(ctx.candidates);
      }
      const question = { v: 1, user: ctx.user, chat: ctx.chat, purpose: ctx.purpose, generation, path: ctx.path, entries: ctx.candidates.map(questionEntryOf) };
      const reply = await ask(deps.proxy, road, question);
      if ("none" in reply)
        return fallBack(reply.none, { ms: reply.ms, answered: false });
      const time = { ms: reply.ms, answered: true };
      if (reply.answer.secrecy === null) {
        handOn({ cut: reply.answer.cut, secrecy: { by: "extension", why: "RPE could not work out the secrets" }, question: time });
        return failClosed(ctx.candidates);
      }
      handOn({ cut: reply.answer.cut, secrecy: { by: "rpe" }, question: time });
      return reply.answer.secrecy;
    } catch (error) {
      return fallBack(`the extension failed (${error instanceof Error ? error.message : String(error)})`, null);
    }
  };
}

// src/ext/registration.ts
var words2 = (error) => error instanceof Error ? error.message : String(error);
var WHOSE_WAIT_MS = 2000;
async function within(read, ms) {
  const late = Promise.withResolvers();
  const timer = setTimeout(() => late.reject(new Error(`it did not answer within ${ms / 1000} s`)), ms);
  try {
    return await Promise.race([read, late.promise]);
  } finally {
    clearTimeout(timer);
  }
}

class Registrations {
  deps;
  byUser = new Map;
  reading = new Map;
  marks = new Map;
  constructor(deps) {
    this.deps = deps;
  }
  of(user) {
    if (this.byUser.has(user))
      return Promise.resolve(this.byUser.get(user) ?? null);
    let read = this.reading.get(user);
    if (read === undefined) {
      read = this.read(user).finally(() => this.reading.delete(user));
      this.reading.set(user, read);
    }
    return read;
  }
  async read(user) {
    let stored;
    try {
      stored = await this.deps.storage.getJson(REGISTRATION_FILE, { fallback: null, userId: user });
    } catch (error) {
      this.deps.unread(user, words2(error));
      throw error;
    }
    this.deps.unread(user, null);
    let kept = readRegistration(stored);
    if (kept !== null && !(isRecord(stored) && stored.confirmed === true)) {
      const doubt = await this.confirm(user, kept);
      if (doubt === null)
        await this.store(user, kept).catch((error) => this.deps.log(`the confirmed registration of user ${user} was not stored again: ${words2(error)}`));
      else {
        this.deps.log(`the registration stored for user ${user} is not used: ${doubt}`);
        kept = null;
      }
    }
    if (!this.byUser.has(user))
      this.byUser.set(user, kept);
    return this.byUser.get(user) ?? null;
  }
  store(user, registration) {
    return this.deps.storage.setJson(REGISTRATION_FILE, { ...registration, confirmed: true }, { userId: user });
  }
  async keep(user, registration) {
    if (!onLoopback(registration.base))
      return `its address ${registration.base} is not a bare address on this machine's loopback (a scheme, a host and a port, nothing more), the only road the extension takes to RPE.`;
    const held = await this.of(user).catch(() => {
      return;
    });
    if (held !== undefined && JSON.stringify(held) === JSON.stringify(registration))
      return null;
    const doubt = await this.confirm(user, registration);
    if (doubt !== null)
      return doubt;
    this.byUser.set(user, registration);
    this.deps.unread(user, null);
    await this.store(user, registration);
    return null;
  }
  async confirm(user, registration) {
    const base = registration.base.replace(/\/+$/, "");
    const ask2 = { relay: registration.relay, connections: registration.connections };
    let answer;
    try {
      answer = await this.deps.proxy(`${base}${CONFIRM_PATH}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${registration.key}`, [USER_HEADER]: user }, body: JSON.stringify(ask2) });
    } catch (error) {
      return `the extension could not reach RPE at ${base} to confirm it (${words2(error)}).`;
    }
    let body = null;
    try {
      body = JSON.parse(answer.body ?? "");
    } catch {}
    if (answer.status !== 200)
      return `RPE did not confirm it (it answered ${answer.status}${isRecord(body) && typeof body.error === "string" ? `: ${body.error.replace(/\.$/, "")}` : ""}).`;
    const confirmed = readConfirmed(body);
    return confirmed !== null && confirmed.user === user && confirmed.relay === registration.relay ? null : `what answers at ${base} is not RPE.`;
  }
  users() {
    return [...this.byUser].flatMap(([user, r]) => r === null ? [] : [user]);
  }
  async road(user) {
    const r = await this.of(user).catch(() => null);
    return r === null ? null : { base: r.base.replace(/\/+$/, ""), headers: { authorization: `Bearer ${r.key}`, [USER_HEADER]: user }, waitMs: r.values.questionMs, logChars: r.values.logChars };
  }
  async marked(connection, user) {
    const key = `${user}\x00${connection}`;
    const kept = this.marks.get(key);
    if (kept !== undefined)
      return kept;
    const profile = await this.deps.connections.get(connection, user);
    const marked = profile !== null && rpeMarked(profile.metadata);
    this.marks.set(key, marked);
    return marked;
  }
  async whose(connection, user) {
    const held = this.byUser.get(user);
    if (held?.connections.includes(connection) === true)
      return { rpe: true };
    const waitMs = held?.values.whoseMs ?? WHOSE_WAIT_MS;
    let mark;
    try {
      return { rpe: await within(this.marked(connection, user), waitMs) };
    } catch (error) {
      mark = words2(error);
    }
    if (held !== undefined)
      return { rpe: false };
    try {
      return { rpe: (await within(this.of(user), waitMs))?.connections.includes(connection) === true };
    } catch (error) {
      return { unknown: { registration: words2(error), mark } };
    }
  }
}

// src/ext/start.ts
var PRIORITY = Number.MAX_SAFE_INTEGER;
var NOTICE_ID = "rpe-permissions";
function noticeItems(lacking, unread) {
  const items = [];
  if (lacking.length > 0) {
    items.push({ type: "text", content: "RPE cannot play your chats until its extension has these permissions in Lumiverse. A Lumiverse admin grants them on the Extensions page." }, { type: "divider" });
    for (const m of lacking)
      items.push({ type: "text", content: `${m.permission}: ${m.why}` });
  }
  if (unread !== undefined) {
    if (items.length > 0)
      items.push({ type: "divider" });
    items.push({ type: "text", content: `RPE's extension could not read RPE's registration from its storage in Lumiverse (${unread}). Until it can, it tells RPE's chats by the mark on RPE's connections in Lumiverse.` });
  }
  return items;
}
async function startExtension(spindle2, options = {}) {
  const log = (message) => spindle2.log.warn(`[RPE] ${message}`);
  const generations = new Generations;
  const unread = new Map;
  const registrations = new Registrations({
    storage: spindle2.userStorage,
    proxy: (url, init) => spindle2.cors(url, init),
    connections: spindle2.connections,
    unread: (user, why) => {
      if (why === null ? !unread.delete(user) : unread.get(user) === why)
        return;
      if (why !== null) {
        unread.set(user, why);
        log(`the registration of user ${user} could not be read from the extension's storage: ${why}`);
      }
      notice();
    },
    log
  });
  let granted = await spindle2.permissions.getGranted();
  const lacking = () => missing(granted);
  const waiting = new Set;
  const pipe = startPipe({
    spindle: spindle2,
    registrations,
    missing: lacking,
    build: options.build ?? "aa4a6d28" ?? "dev",
    statedHash: options.statedHash !== undefined ? options.statedHash : "c9997949b0768461cf98a79fd365d73e9cfda4ffb865d57a59f16cd842652091",
    log,
    registered: () => notice(),
    refused: (user) => {
      if (lacking().length === 0)
        return;
      waiting.add(user);
      notice();
    }
  });
  const shown = new Map;
  const notice = () => {
    const now = lacking();
    for (const user of new Set([...registrations.users(), ...waiting, ...unread.keys()])) {
      const why = unread.get(user);
      const items = now.length > 0 || why !== undefined ? noticeItems(now, why) : [];
      const said = JSON.stringify(items);
      if (shown.get(user) === said)
        continue;
      const was = shown.get(user);
      shown.set(user, said);
      (async () => {
        if (was !== undefined && was !== "[]")
          await spindle2.modal.close(NOTICE_ID, user);
        if (items.length > 0)
          spindle2.modal.open({ title: now.length > 0 ? "RPE needs permissions" : "RPE's registration could not be read", items, persistent: true, modalRequestId: NOTICE_ID, userId: user });
      })().catch((error) => log(`the notice was not shown: ${error instanceof Error ? error.message : String(error)}`));
    }
    pipe.permissions();
  };
  const question = worldInfoInterceptor({ road: (user) => registrations.road(user), proxy: (url, init) => spindle2.cors(url, init), generations, log });
  const prompt = promptInterceptor({
    generations,
    whose: (connection, user) => registrations.whose(connection, user),
    granted: (permission) => spindle2.permissions.has(permission),
    log,
    stopped: (user, record) => pipe.stopped(user, record)
  });
  let listening = [];
  let unregister = null;
  const open = (permission) => {
    if (permission === "generation") {
      spindle2.registerWorldInfoInterceptor(question, PRIORITY);
      for (const off of listening)
        off();
      listening = [
        spindle2.on("GENERATION_STARTED", (payload, user) => {
          generations.started(payload, user);
          if (user !== undefined)
            registrations.of(user).catch(() => {
              return;
            });
        }),
        spindle2.on("GENERATION_ENDED", (payload, user) => generations.over(payload, user)),
        spindle2.on("GENERATION_STOPPED", (payload, user) => generations.over(payload, user))
      ];
    } else if (permission === "interceptor") {
      unregister?.();
      unregister = spindle2.registerInterceptor(prompt, { priority: PRIORITY, required: true });
    }
  };
  for (const permission of ["generation", "interceptor"])
    if (granted.includes(permission))
      open(permission);
  const offChanged = spindle2.permissions.onChanged((change) => {
    granted = change.allGranted;
    if (change.granted)
      open(change.permission);
    notice();
  });
  notice();
  return {
    stop() {
      offChanged();
      pipe.stop();
      for (const off of listening)
        off();
      unregister?.();
    }
  };
}

// src/ext/backend.ts
startExtension(spindle).catch((error) => spindle.log.error(`[RPE] the extension did not start: ${error instanceof Error ? error.message : String(error)}`));
