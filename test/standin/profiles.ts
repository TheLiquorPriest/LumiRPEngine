// The connection profiles of the stand-in Lumiverse (`services/connections.service.ts`, `routes/connections.routes.ts`): the records
// a user keeps of the models they connect to, and the one a generation takes (`services/generation/connection-resolution.ts`).
// What a generation talks to is the host's `connections` map (`lumiverse.ts`); a profile made here puts its connection there, and a
// connection a test put there with no profile is listed as one of every user's (the host holds its connections for all of them). A profile's key is kept as the
// secret `connection_<id>_api_key` (`:connectionSecretKey`), in `secrets`. What it does not model: the model roulette provider,
// the provider registry (any provider id is taken), a provider's own checks of a key, and the organization settings. Every name is invented.

import { isRecord } from "../../src/shared/json";
import type { Connection, StandIn } from "./lumiverse";
import type { Pagination } from "./served";

/** A profile as Lumiverse lists it (`rowToProfile`, `services/connections.service.ts:267-275`; the columns of `connection_profiles`). */
export interface Profile {
  id: string;
  user_id: string;
  name: string;
  provider: string;
  api_url: string;
  model: string;
  preset_id: string | null;
  is_default: boolean;
  has_api_key: boolean;
  metadata: Record<string, unknown>;
  created_at: number;
  updated_at: number;
}

/** `connectionSecretKey` (`services/connections.service.ts:119-121`). */
export const connectionSecretKey = (id: string): string => `connection_${id}_api_key`;

export class Profiles {
  /** The profiles made through the routes, in the order they were made. */
  private readonly made = new Map<string, Profile>();
  /** The secrets of each user (`secrets.service`), by user and name. */
  readonly secrets = new Map<string, string>();

  constructor(
    private readonly host: StandIn,
    private readonly now: () => number,
  ) {}

  private secretOf(user: string, id: string): string | undefined {
    return this.secrets.get(`${user}\0${connectionSecretKey(id)}`);
  }

  /** The profile a connection of the host stands in for, where none was made through the routes. */
  private derived(c: Connection, user: string): Profile {
    return { id: c.id, user_id: user, name: c.id, provider: "custom", api_url: c.base, model: c.model, preset_id: null, is_default: false, has_api_key: c.key !== "", metadata: { ...(c.metadata ?? {}) }, created_at: 0, updated_at: 0 };
  }

  /** Every profile of the user, as `listConnections` orders them: the most lately changed first, equal ones as made (`:321-329`). */
  all(user: string): Profile[] {
    const own = [...this.made.values()].filter((p) => p.user_id === user);
    const lent = [...this.host.connections.values()].filter((c) => !this.made.has(c.id)).map((c) => this.derived(c, user));
    return [...own, ...lent].sort((a, b) => b.updated_at - a.updated_at);
  }

  /** `getConnection` (`:331-338`): the user's own profile by id. */
  get(user: string, id: string): Profile | null {
    return this.all(user).find((p) => p.id === id) ?? null;
  }

  /** `getDefaultConnection`: the profile marked default, which only a profile made through the routes can be. */
  private defaultOf(user: string): Profile | null {
    return this.all(user).find((p) => p.is_default) ?? null;
  }

  /** `resolveConnection` (`:341-360`): the one named, else the default. */
  resolve(user: string, id?: string): Profile | null {
    return id ? this.get(user, id) : this.defaultOf(user);
  }

  /** `resolveActiveConnectionId` (`:375-386`): the `activeProfileId` setting, when it names a profile of the user's. */
  private activeId(user: string): string | undefined {
    const active = this.host.library.setting(user, "activeProfileId");
    return typeof active === "string" && active !== "" && this.get(user, active) !== null ? active : undefined;
  }

  /** `resolveActingConnectionId` (`:408-412`): the active profile, the default, any the user owns. */
  private actingId(user: string): string | undefined {
    return this.activeId(user) ?? this.defaultOf(user)?.id ?? this.all(user)[0]?.id;
  }

  /**
   * `resolveChatGenerationConnection` (`services/generation/connection-resolution.ts:29-96`): the chat's own pin first, where its profile is still there; else the one
   * asked for, else the active profile, else the acting one where none was asked for (an id asked for that is gone is no fallback). The chat's `connection_model`
   * stands in for the model of a pinned profile. Null where none is found.
   */
  forChat(user: string, metadata: Record<string, unknown> | undefined, requested?: string): Profile | null {
    const asked = requested?.trim() || undefined;
    const pinned = typeof metadata?.connection_profile_id === "string" ? metadata.connection_profile_id.trim() : "";
    const bound = pinned !== "" ? this.resolve(user, pinned) : null;
    const chosen = bound ?? this.resolve(user, asked ?? this.activeId(user)) ?? (asked !== undefined ? null : this.resolve(user, this.actingId(user)));
    if (chosen === null) return null;
    const model = bound !== null && typeof metadata?.connection_model === "string" ? metadata.connection_model.trim() : "";
    return model !== "" ? { ...chosen, model } : chosen;
  }

  /** The host's connection a profile makes (`api_url` is where `<base>/chat/completions` is posted). */
  private lend(profile: Profile): void {
    const key = this.secretOf(profile.user_id, profile.id) ?? "";
    this.host.connections.set(profile.id, { id: profile.id, base: profile.api_url, key, model: profile.model, metadata: profile.metadata as Connection["metadata"] });
  }

  private told(event: string, payload: unknown, user: string): void {
    this.host.emit(event, payload, user);
  }

  /** `createConnection` (`:459-488`): the key, where one is given, kept as a secret; any default there was is no longer one; told as an organization change. */
  create(user: string, input: Record<string, unknown>): Profile {
    const id = crypto.randomUUID();
    const at = Math.floor(this.now() / 1000);
    if (input.is_default) for (const p of this.made.values()) if (p.user_id === user) p.is_default = false;
    const key = typeof input.api_key === "string" && input.api_key !== "" ? input.api_key : undefined;
    if (key !== undefined) this.secrets.set(`${user}\0${connectionSecretKey(id)}`, key);
    const profile: Profile = {
      id,
      user_id: user,
      name: String(input.name),
      provider: String(input.provider),
      api_url: typeof input.api_url === "string" ? input.api_url : "",
      model: typeof input.model === "string" ? input.model : "",
      preset_id: typeof input.preset_id === "string" && input.preset_id !== "" ? input.preset_id : null,
      is_default: Boolean(input.is_default),
      has_api_key: key !== undefined,
      metadata: isRecord(input.metadata) ? input.metadata : {},
      created_at: at,
      updated_at: at,
    };
    this.made.set(id, profile);
    this.lend(profile);
    this.told("CONNECTION_ORGANIZATION_CHANGED", { kind: "llm" }, user);
    return profile;
  }

  /** What `rowToProfile` and `withReadableApiKeyStatus` hand a page: a key flagged but unreadable reads as none (`services/connection-secret-status.ts:14-23`). */
  shown(profile: Profile): Profile {
    return profile.has_api_key && this.secretOf(profile.user_id, profile.id) === undefined && !this.keyHeld(profile) ? { ...profile, has_api_key: false } : profile;
  }

  /** A connection a test put in the host with a key holds it there, not as a secret. */
  private keyHeld(profile: Profile): boolean {
    return !this.made.has(profile.id) && (this.host.connections.get(profile.id)?.key ?? "") !== "";
  }

  list(user: string, pagination: Pagination): { data: Profile[]; total: number; limit: number; offset: number } {
    const all = this.all(user);
    return { data: all.slice(pagination.offset, pagination.offset + pagination.limit).map((p) => this.shown(p)), total: all.length, limit: pagination.limit, offset: pagination.offset };
  }

  /** A profile the routes may change: one a test put in the host with no profile is made into one first. */
  private editable(user: string, id: string): Profile | null {
    const found = this.made.get(id);
    if (found !== undefined) return found.user_id === user ? found : null;
    const lent = this.get(user, id);
    if (lent === null) return null;
    this.made.set(id, lent);
    return lent;
  }

  /** `updateConnection` (`:491-528`): a key given sets the secret, an empty one clears it; a metadata given replaces the profile's whole; told as loaded. */
  update(user: string, id: string, input: Record<string, unknown>): Profile | null {
    const profile = this.editable(user, id);
    if (profile === null) return null;
    if (input.is_default) for (const p of this.made.values()) if (p.user_id === user) p.is_default = false;
    if (input.api_key !== undefined) {
      if (typeof input.api_key === "string" && input.api_key !== "") this.setKey(user, id, input.api_key);
      else this.clearKey(user, id);
    }
    const keys = ["name", "provider", "api_url", "model", "preset_id", "is_default", "metadata"] as const;
    const given = keys.filter((key) => input[key] !== undefined);
    if (given.length === 0 && input.api_key === undefined) return profile;
    if (input.name !== undefined) profile.name = input.name as string;
    if (input.provider !== undefined) profile.provider = input.provider as string;
    if (input.api_url !== undefined) profile.api_url = input.api_url as string;
    if (input.model !== undefined) profile.model = input.model as string;
    if (input.preset_id !== undefined) profile.preset_id = input.preset_id ? (input.preset_id as string) : null;
    if (input.is_default !== undefined) profile.is_default = Boolean(input.is_default);
    if (input.metadata !== undefined) profile.metadata = input.metadata as Record<string, unknown>;
    profile.updated_at = Math.floor(this.now() / 1000);
    this.lend(profile);
    this.told("CONNECTION_PROFILE_LOADED", { id, profile }, user);
    return profile;
  }

  /** `setConnectionApiKey` (`:587-591`). */
  setKey(user: string, id: string, key: string): void {
    const profile = this.editable(user, id);
    if (profile === null) return;
    this.secrets.set(`${user}\0${connectionSecretKey(id)}`, key);
    profile.has_api_key = true;
    profile.updated_at = Math.floor(this.now() / 1000);
    this.lend(profile);
  }

  /** `clearConnectionApiKey` (`:593-597`). */
  clearKey(user: string, id: string): void {
    const profile = this.editable(user, id);
    if (profile === null) return;
    this.secrets.delete(`${user}\0${connectionSecretKey(id)}`);
    profile.has_api_key = false;
    profile.updated_at = Math.floor(this.now() / 1000);
    this.lend(profile);
  }

  /** `deleteConnection`: the profile, its secret and the host's connection. */
  delete(user: string, id: string): boolean {
    const profile = this.editable(user, id);
    if (profile === null) return false;
    this.made.delete(id);
    this.secrets.delete(`${user}\0${connectionSecretKey(id)}`);
    this.host.connections.delete(id);
    this.told("CONNECTION_ORGANIZATION_CHANGED", { kind: "llm" }, user);
    return true;
  }
}
