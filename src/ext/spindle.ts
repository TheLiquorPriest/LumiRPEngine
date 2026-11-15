// The part of Spindle's backend API the light extension uses (STANDALONE-PLAN §4.3), typed as
// Lumiverse's code behaves at the checkout the plan rests on, not as the published types declare: the
// interceptor's context is read as unknown because core fills fewer fields than those types name
// (`generate.service.ts:1063-1072`, `:1217-1231`; it says `dryRun`, the types say `isDryRun`).

/**
 * A prompt message as an interceptor is handed it (`worker-host.ts:3184-3198`): the host adds the
 * history and lore flags, and the source of a history message; every key Lumiverse put on the message
 * comes along, among them the mark on a summary its memory put in place of history
 * (`prompt-assembly.service.ts:3286-3292`).
 */
export interface PromptMessageDTO {
  role: string;
  content: unknown;
  name?: string;
  partial?: boolean;
  __isChatHistory?: boolean;
  __isWorldInfoEntry?: boolean;
  __cortexHistorySummary?: boolean;
  sourceMessageId?: string;
  sourceIndexInChat?: number;
}

/** What a prompt interceptor may return (`worker-runtime.ts:4799-4812`); `parameters` pass only with `generation_parameters` (`worker-host.ts:1922-1931`). */
export type InterceptorReturn = PromptMessageDTO[] | { messages: PromptMessageDTO[]; parameters?: Record<string, unknown> };

/** What a World Info interceptor may return (`world-info-interceptor.ts:94-101`). */
export interface WorldInfoReturn {
  disabled?: string[];
  enabled?: string[];
  mutated?: { id: string; content: string }[];
}

/** What Spindle's proxy answers (`worker-host.ts:4727-4736`). */
export interface ProxyAnswer {
  status: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface PermissionChange {
  permission: string;
  granted: boolean;
  allGranted: string[];
}

/** A modal's body item (`SpindleModalItemDTO`); the notice uses text and headings. */
export type ModalItem = { type: "text"; content: string; muted?: boolean } | { type: "heading"; content: string } | { type: "divider" };

export interface ExtSpindle {
  /** One per extension; a second replaces the first (`worker-host.ts:4922`). Needs `generation` (`:4910-4919`). */
  registerWorldInfoInterceptor(handler: (ctx: unknown) => Promise<WorldInfoReturn>, priority?: number): void;
  /** One per extension; a second replaces the first (`worker-host.ts:3165`). Needs `interceptor` (`:3143-3153`). */
  registerInterceptor(handler: (messages: PromptMessageDTO[], context: unknown) => Promise<InterceptorReturn>, options: { priority?: number; required?: boolean }): () => void;
  /** Generation events need `generation` (`worker-host.ts:2876-2907`); handlers get the payload and its user (`worker-runtime.ts:4773-4786`). */
  on(event: string, handler: (payload: unknown, userId?: string) => void): () => void;
  /** Through Lumiverse's server: loopback allowed, 30 s, 25 MB (`worker-host.ts:4647-4741`, `:771-772`). No way to cancel one. */
  cors(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<ProxyAnswer>;
  /** To one frontend session alone when one is named, else to every socket of the user (`worker-host.ts:2129-2160`). */
  sendToFrontend(payload: unknown, userId?: string, options?: { frontendSessionId?: string }): void;
  /** A `SPINDLE_BACKEND_MSG` from any socket of a user: a page, or RPE's relay socket (`ws/handler.ts:440-467`). */
  onFrontendMessage(handler: (payload: unknown, userId: string, frontendSessionId?: string) => void): () => void;
  /** A connection's own record, its `metadata` with it, or null where the user has none by that id (`worker-runtime.ts:2530-2534`); needs `generation` (`worker-host.ts:3718-3760`). */
  connections: {
    get(connectionId: string, userId?: string): Promise<{ id: string; metadata?: unknown } | null>;
  };
  /** Each user's own storage of the extension (`worker-runtime.ts:2120-2224`): a missing or unreadable file reads as the fallback. */
  userStorage: {
    getJson<T>(path: string, options: { fallback: T; userId?: string }): Promise<T>;
    setJson(path: string, value: unknown, options?: { userId?: string }): Promise<void>;
  };
  /** A modal in the user's Lumiverse page (`worker-host-presentation-api.ts:486-554`); `modalRequestId` lets `close` name it. */
  modal: {
    open(options: { title: string; items: ModalItem[]; persistent?: boolean; modalRequestId?: string; userId?: string }): Promise<unknown>;
    close(openRequestId: string, userId?: string): Promise<void>;
  };
  permissions: {
    has(permission: string): boolean;
    getGranted(): Promise<string[]>;
    onChanged(handler: (change: PermissionChange) => void): () => void;
  };
  log: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  };
}
