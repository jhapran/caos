/**
 * IMP-014 — Stable provider-neutral error contract for the data layer.
 *
 * Two deliberately separate families:
 *
 *   ConfigurationError — startup/environment failure (OPS-ENV-06,
 *     MIG-DS-03/05). Fatal, shown by the bootstrap error screen; never
 *     recoverable in-session and never a silent fixture fallback.
 *
 *   ApiError — runtime data-access failure in the API-ERR-01 taxonomy
 *     (spec 07). Provider errors (PostgREST/GoTrue shapes) are translated
 *     ONCE at the adapter boundary via toApiError(), so React/domain code
 *     never sees Supabase SDK error types (API-ARCH-01/02).
 *
 * Intentionally minimal: one taxonomy enum + one class + one translator.
 * No error hierarchy beyond what IMP-014 consumers need.
 */

export class ConfigurationError extends Error {
  override readonly name = 'ConfigurationError';
}

/**
 * API-ERR-01 taxonomy (docs/spec/07-api-contract.md):
 *   unauthenticated — no/expired session → re-auth flow
 *   unauthorized    — authenticated but denied (role/scope/context)
 *   validation      — input rejected
 *   not_found       — unknown OR inaccessible id (normalized, API-ERR-02)
 *   conflict        — unique/check/transition violation or stale state
 *   internal        — anything else; retryable unless marked permanent
 */
export type ApiErrorKind =
  | 'unauthenticated'
  | 'unauthorized'
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'internal';

export class ApiError extends Error {
  override readonly name = 'ApiError';

  readonly kind: ApiErrorKind;

  constructor(kind: ApiErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** Structural shape of a provider error (PostgREST / GoTrue / PostgresError). */
interface ProviderErrorLike {
  message?: string;
  code?: string;
  status?: number;
  details?: string;
}

function classify(
  status: number | undefined,
  code: string | undefined,
  details: string | undefined,
): ApiErrorKind {
  // PostgREST "results contain 0 rows" (single-resource read miss) and any
  // HTTP 404 normalize to not_found — inaccessible and nonexistent are
  // indistinguishable by design (API-ERR-02).
  if (code === 'PGRST116') return 'not_found';
  // PostgreSQL insufficient_privilege — RLS denials and authorized-RPC
  // rejections both surface as 42501 (HTTP 403 via PostgREST).
  if (code === '42501') return 'unauthorized';
  if (code === '23505' || code === '23503' || code === 'PGRST109') return 'conflict';
  // check_violation (23514) splits by DISCRIMINATOR, never by loose message
  // matching (IMP-020 closure decision): the approved conflict cases are
  // database-guard violations carrying a stable DETAIL token — the
  // entity_type immutability invariant (API-R0-ENT, IMMUTABLE_FIELD:) and
  // lifecycle transition guards (API-ERR-01 "transition violation",
  // INVALID_TRANSITION: — introduced by IMP-021 for DM-SM-03). Every other
  // CHECK violation is rejected input → validation (API-ERR-01).
  if (code === '23514') {
    return details?.includes('IMMUTABLE_FIELD:') || details?.includes('INVALID_TRANSITION:')
      ? 'conflict'
      : 'validation';
  }
  switch (status) {
    case 400:
      return 'validation';
    case 401:
      return 'unauthenticated';
    case 403:
      return 'unauthorized';
    case 404:
    case 406:
      return 'not_found';
    case 409:
      return 'conflict';
    default:
      return 'internal';
  }
}

/**
 * Translate any provider-layer error into the stable ApiError contract.
 * Already-ApiError values pass through; anything unrecognized becomes
 * `internal`. Provider details are preserved in the message only — never
 * as provider TYPES leaking into domain code.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const e = (error ?? {}) as ProviderErrorLike;
  const kind = classify(e.status, e.code, e.details);
  return new ApiError(kind, e.message ?? 'Unexpected data-access error');
}
