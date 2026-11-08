// The parts of Lumiverse's src/utils/provider-errors.ts (origin/staging 8e0f3945) that provider-sse.ts
// imports, verbatim: the error core throws for a provider's failure and its body parser. Left out: the
// credential, transport and response-reading helpers the reader doesn't use.

export interface ParsedProviderErrorBody {
  code?: string;
  detail?: string;
}

export interface ProviderRequestErrorOptions {
  provider: string;
  operation: string;
  status?: number;
  code?: string;
  detail?: string;
  rawBody?: string;
  retryable?: boolean;
  /** Parsed Retry-After hint (ms) the caller may honor before retrying. */
  retryAfterMs?: number;
}

export class ProviderRequestError extends Error {
  readonly provider: string;
  readonly operation: string;
  readonly status?: number;
  readonly code?: string;
  readonly detail?: string;
  readonly rawBody?: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(options: ProviderRequestErrorOptions) {
    const status = options.status ? ` (${options.status})` : "";
    const detail = options.detail || options.code || "request failed";
    super(`${options.provider} ${options.operation} failed${status}: ${detail}`);
    this.name = "ProviderRequestError";
    this.provider = options.provider;
    this.operation = options.operation;
    this.status = options.status;
    this.code = options.code;
    this.detail = options.detail;
    this.rawBody = options.rawBody;
    this.retryable = options.retryable ?? isRetryableProviderStatus(options.status);
    this.retryAfterMs = options.retryAfterMs;
  }
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stripHtml(raw: string): string {
  return raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateDetail(value: string): string {
  return value.length > 500 ? `${value.slice(0, 497)}...` : value;
}

export function parseProviderErrorBody(raw: string): ParsedProviderErrorBody {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const data = JSON.parse(trimmed) as any;
      const error = data?.error;
      const errorId = normalizeText(data?.error_id);
      const code = errorId || (error && typeof error === "object"
        ? normalizeText(error.code) || normalizeText(error.status) || normalizeText(error.type)
        : normalizeText(data?.code) || normalizeText(data?.status) || normalizeText(data?.type) || normalizeText(error));
      const detail = error && typeof error === "object"
        ? normalizeText(error.message) || normalizeText(data?.error_description) || normalizeText(data?.message)
        : normalizeText(data?.error_description) || normalizeText(data?.message) || normalizeText(data?.detail) || normalizeText(data?.detail?.message) || normalizeText(error);
      return {
        code: code ? truncateDetail(code) : undefined,
        detail: detail ? truncateDetail(detail) : undefined,
      };
    } catch {
      // Fall through to text normalization.
    }
  }

  return { detail: truncateDetail(stripHtml(trimmed) || trimmed) };
}

export function isRetryableProviderStatus(status: number | undefined): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || (status !== undefined && status >= 500);
}
