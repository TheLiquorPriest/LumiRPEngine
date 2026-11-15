// The user's embeddings configuration as `GET /api/v1/embeddings/config` gives it (`routes/embeddings.routes.ts:12-15`; `getEmbeddingConfig`, `services/embeddings.service.ts:2017-2022`; paths are
// Lumiverse's `src/`): the setting `embeddingConfig` read as `normalizeConfig` reads it (`:915-1010`) over Lumiverse's defaults (`:720-743`), each connection profile without its secrets and
// told whether it has one (`:1994-2014`), and `has_api_key` of the primary one (`:2004-2006`); the oldest account's configuration where it is enabled and the caller is another (`:1982-1992`),
// told as `inherited`. A secret is the stand-in's `secrets` (`profiles.ts`) under the name Lumiverse keeps it by: `embedding-profile/<profile id>/apiKey` for a profile, `embedding_api_key_<provider>`
// for the provider's (`:119-120`, `:158-165`). What it does not model: the per-provider profiles (`provider_profiles`), the migration of a legacy key, and Vertex's region and project beyond what is stored.

import { createHash } from "node:crypto";
import { isRecord } from "../../src/shared/json";

const PROVIDERS = ["openai-compatible", "openai", "mistral", "cohere", "openrouter", "electronhub", "bananabread", "nanogpt", "nvidia-nim", "google_vertex"];
const DEFAULT_URL: Record<string, string> = {
  "openai-compatible": "https://api.openai.com/v1/embeddings",
  openai: "https://api.openai.com/v1/embeddings",
  mistral: "https://api.mistral.ai/v1/embeddings",
  cohere: "https://api.cohere.com/v2/embed",
  openrouter: "https://openrouter.ai/api/v1/embeddings",
  electronhub: "https://api.electronhub.top/v1/embeddings",
  bananabread: "http://localhost:8008/v1/embeddings",
  nanogpt: "https://nano-gpt.com/api/v1/embeddings",
  "nvidia-nim": "https://integrate.api.nvidia.com/v1/embeddings",
  google_vertex: "https://aiplatform.googleapis.com",
};
const DISPLAY_NAME: Record<string, string> = {
  "openai-compatible": "OpenAI Compatible",
  openai: "OpenAI",
  mistral: "Mistral",
  cohere: "Cohere",
  openrouter: "OpenRouter",
  electronhub: "ElectronHub",
  bananabread: "BananaBread",
  nanogpt: "Nano-GPT",
  "nvidia-nim": "NVIDIA NIM",
  google_vertex: "Google Vertex AI",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const known = (provider: string): boolean => PROVIDERS.includes(provider);
const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined);
const count = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null);

/** `providerDefaultModel` (`:696-707`). */
function defaultModel(provider: string): string {
  if (provider === "mistral") return "mistral-embed";
  if (provider === "cohere") return "embed-v4.0";
  if (provider === "bananabread") return "mixedbread-ai/mxbai-embed-large-v1";
  if (provider === "nvidia-nim") return "nvidia/nemotron-3-embed-1b";
  if (provider === "google_vertex") return "gemini-embedding-001";
  return "text-embedding-3-small";
}

/** `providerDefaultUrl` (`:715-718`). */
const defaultUrl = (provider: string): string => (known(provider) ? DEFAULT_URL[provider]! : DEFAULT_URL["openai-compatible"]!);

/** `ensureProfileId` (`:171-173`): a profile whose id is no UUID is given one; the stand-in's is made from where the profile stands, so a read gives the same twice. */
function profileId(raw: unknown, user: string, at: number): string {
  if (typeof raw === "string" && UUID.test(raw)) return raw;
  const hex = createHash("sha256").update(`${user}\0${at}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

interface Profile {
  id: string;
  name: string;
  provider: string;
  model: string;
  api_url: string;
  dimensions: number | null;
  enabled: boolean;
  vertex_region: string | undefined;
  vertex_project: string | undefined;
}

/** `stripProfileSecrets` (`:769-795`). */
function profileOf(raw: Record<string, unknown>, user: string, at: number): Profile {
  const given = text(raw.provider) ?? "openai-compatible";
  const provider = given === "custom" ? "openai-compatible" : given;
  const named = typeof raw.provider === "string" ? raw.provider : "openai-compatible";
  return {
    id: profileId(raw.id, user, at),
    name: text(raw.name) ?? DISPLAY_NAME[provider] ?? provider,
    provider,
    model: text(raw.model) ?? defaultModel(named),
    api_url: text(raw.api_url) ?? defaultUrl(named),
    dimensions: count(raw.dimensions),
    enabled: raw.enabled !== undefined ? !!raw.enabled : true,
    vertex_region: text(raw.vertex_region),
    vertex_project: text(raw.vertex_project),
  };
}

/** The setting `embeddingConfig` as `normalizeConfig` reads it (`:915-1010`), the connection profiles as it leaves them. */
function normalized(input: unknown, user: string): Record<string, unknown> & { connectionProfiles: Profile[]; primaryProfileId: string; fallbackProfileIds: string[]; provider: string } {
  const stored = isRecord(input) ? input : {};
  const provider = text(stored.provider) ?? "openai-compatible";
  const allowsUrl = provider === "openai-compatible" || provider === "bananabread" || provider === "nvidia-nim" || !known(provider);
  const apiUrl = allowsUrl ? (text(stored.api_url) ?? defaultUrl(provider)) : defaultUrl(provider);
  const model = text(stored.model) ?? defaultModel(provider);
  const dimensions = count(stored.dimensions);
  const vertexRegion = provider === "google_vertex" || typeof stored.vertex_region === "string" ? (text(stored.vertex_region) ?? (provider === "google_vertex" ? "global" : undefined)) : undefined;
  const vertexProject = text(stored.vertex_project);
  let profiles = (Array.isArray(stored.connectionProfiles) ? stored.connectionProfiles : []).filter(isRecord).map((p, i) => profileOf(p, user, i));
  if (profiles.length === 0) profiles = [profileOf({ provider, api_url: apiUrl, model, dimensions, enabled: true, vertex_region: vertexRegion, vertex_project: vertexProject }, user, 0)];
  const usable = new Set(profiles.map((p) => p.id));
  const primary = profiles.find((p) => p.id === stored.primaryProfileId) ?? profiles[0]!;
  const fallbacks = (Array.isArray(stored.fallbackProfileIds) ? stored.fallbackProfileIds : []).filter((id): id is string => typeof id === "string" && usable.has(id) && id !== primary.id);
  const value = (key: string): number | undefined => (typeof stored[key] === "number" && Number.isFinite(stored[key]) ? (stored[key] as number) : undefined);
  const topK = value("retrieval_top_k");
  const context = value("preferred_context_size");
  const batch = value("batch_size");
  const similarity = value("similarity_threshold");
  const rerank = value("rerank_cutoff");
  const timeout = value("request_timeout");
  const one = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => (allowed.includes(stored[key] as T) ? (stored[key] as T) : fallback);
  const flag = (key: string, fallback: boolean): boolean => (stored[key] !== undefined ? !!stored[key] : fallback);
  const primaryProvider = known(primary.provider) ? primary.provider : provider;
  const vertex = primaryProvider === "google_vertex" ? (primary.vertex_region ?? vertexRegion ?? "global") : (primary.vertex_region ?? vertexRegion);
  return {
    enabled: stored.enabled !== undefined ? !!stored.enabled : false,
    provider: primaryProvider,
    api_url: primary.api_url || apiUrl,
    model: primary.model || model,
    dimensions: primary.dimensions ?? dimensions,
    send_dimensions: flag("send_dimensions", false),
    retrieval_top_k: topK !== undefined && topK > 0 ? Math.floor(topK) : 4,
    hybrid_weight_mode: one("hybrid_weight_mode", ["keyword_first", "balanced", "vector_first"], "balanced"),
    preferred_context_size: context !== undefined && context > 0 ? Math.min(64, Math.floor(context)) : 6,
    batch_size: batch !== undefined && batch > 0 ? Math.min(200, Math.max(1, Math.floor(batch))) : 50,
    similarity_threshold: similarity !== undefined && similarity >= 0 ? Math.min(2, similarity) : 0,
    rerank_cutoff: rerank !== undefined && rerank >= 0 ? Math.min(2, rerank) : 0,
    vectorize_world_books: flag("vectorize_world_books", true),
    vectorize_chat_messages: flag("vectorize_chat_messages", false),
    vectorize_chat_documents: flag("vectorize_chat_documents", true),
    chat_memory_mode: one("chat_memory_mode", ["conservative", "balanced", "aggressive"], "balanced"),
    request_timeout: timeout !== undefined && timeout >= 0 ? Math.min(300, timeout) : 120,
    vertex_region: vertex,
    vertex_project: primary.vertex_project ?? vertexProject,
    connectionProfiles: profiles,
    primaryProfileId: primary.id,
    fallbackProfileIds: fallbacks,
  };
}

/**
 * The configuration the user is served: their own, or the oldest account's where that is enabled and the caller is another (`resolveEmbeddingUserContext`, `:1982-1992`), each profile with
 * whether it holds a secret and the config with whether its primary does.
 */
export function embeddingConfig(user: string, firstUser: string | null, read: (user: string) => unknown, hasSecret: (user: string, name: string) => boolean): Record<string, unknown> {
  const inherited = firstUser !== null && firstUser !== user && normalized(read(firstUser), firstUser).enabled === true;
  const owner = inherited ? firstUser : user;
  const config = normalized(read(owner), owner);
  const profiles = config.connectionProfiles.map((p) => ({ ...p, hasSecret: hasSecret(owner, `embedding-profile/${p.id}/apiKey`) || hasSecret(owner, `connection_${p.id}_api_key`) }));
  const primary = profiles.find((p) => p.id === config.primaryProfileId) ?? profiles[0];
  const hasKey = primary !== undefined ? primary.hasSecret : hasSecret(owner, `embedding_api_key_${config.provider}`);
  return { ...config, connectionProfiles: profiles, has_api_key: hasKey || hasSecret(owner, `embedding_api_key_${config.provider}`), provider_profiles: {}, ...(inherited ? { inherited: true } : {}) };
}
