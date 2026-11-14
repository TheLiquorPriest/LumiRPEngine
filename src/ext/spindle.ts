// The part of Spindle's backend API the light extension uses (STANDALONE-PLAN §4.3), typed as
// Lumiverse's code behaves at the checkout the plan rests on, not as the published types declare: the
// interceptor's context is read as unknown because core fills fewer fields than those types name
// (`generate.service.ts:1063-1072`, `:1217-1231`; it says `dryRun`, the types say `isDryRun`).

/** A prompt message as an interceptor is handed it (`worker-host.ts:3184-3198`): the host adds the history and lore flags, and the source of a history message. */
export interface PromptMessageDTO {
  role: string;
  content: unknown;
  name?: string;
  partial?: boolean;
  __isChatHistory?: boolean;
  __isWorldInfoEntry?: boolean;
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

export interface ExtSpindle {
  /** One per extension; a second replaces the first (`worker-host.ts:4922`). Needs `generation` (`:4910-4919`). */
  registerWorldInfoInterceptor(handler: (ctx: unknown) => Promise<WorldInfoReturn>, priority?: number): void;
  /** One per extension; a second replaces the first (`worker-host.ts:3165`). Needs `interceptor` (`:3143-3153`). */
  registerInterceptor(handler: (messages: PromptMessageDTO[], context: unknown) => Promise<InterceptorReturn>, options: { priority?: number; required?: boolean }): () => void;
  /** Generation events need `generation` (`worker-host.ts:2894-2907`); handlers get the payload and its user (`worker-runtime.ts:4773-4786`). */
  on(event: string, handler: (payload: unknown, userId?: string) => void): () => void;
  /** Through Lumiverse's server: loopback allowed, 30 s, 25 MB (`worker-host.ts:4641-4741`, `:771-772`). No way to cancel one. */
  cors(url: string, init: { method: string; headers: Record<string, string>; body: string }): Promise<ProxyAnswer>;
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
