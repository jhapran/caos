/**
 * IMP-014 — Provider-neutral error contract (API-ERR-01 taxonomy).
 *
 * The adapter boundary translates provider errors (PostgREST/GoTrue
 * shapes) into ApiError kinds exactly once; consumers never see provider
 * error types.
 */
import { describe, expect, it } from 'vitest';

import { ApiError, toApiError } from '@/data/errors';

describe('toApiError — API-ERR-01 taxonomy translation', () => {
  it('passes ApiError through unchanged', () => {
    const original = new ApiError('unauthorized', 'denied');
    expect(toApiError(original)).toBe(original);
  });

  it('maps session/auth failures to unauthenticated', () => {
    expect(toApiError({ status: 401, message: 'JWT expired' }).kind).toBe('unauthenticated');
  });

  it('maps permission denials to unauthorized', () => {
    expect(toApiError({ status: 403, message: 'permission denied' }).kind).toBe('unauthorized');
    // PostgreSQL insufficient_privilege — how PostgREST surfaces RLS and
    // privileged-RPC denials (verified against the local stack: HTTP 403,
    // code 42501).
    expect(toApiError({ code: '42501', message: 'AAL2 step-up required' }).kind).toBe(
      'unauthorized',
    );
  });

  it('normalizes single-resource misses to not_found (API-ERR-02)', () => {
    expect(toApiError({ code: 'PGRST116', message: '0 rows' }).kind).toBe('not_found');
    expect(toApiError({ status: 404 }).kind).toBe('not_found');
    expect(toApiError({ status: 406 }).kind).toBe('not_found');
  });

  it('maps input rejections to validation', () => {
    expect(toApiError({ status: 400, message: 'bad request' }).kind).toBe('validation');
  });

  it('maps uniqueness/constraint violations to conflict', () => {
    expect(toApiError({ status: 409 }).kind).toBe('conflict');
    expect(toApiError({ code: '23505', message: 'duplicate key' }).kind).toBe('conflict');
    expect(toApiError({ code: '23503', message: 'fk violation' }).kind).toBe('conflict');
  });

  it('maps generic CHECK violations (23514) to validation — not conflict', () => {
    // IMP-020 closure decision: 23514 is rejected input unless the database
    // carries the approved immutable-field discriminator in DETAIL.
    expect(toApiError({ code: '23514', message: 'check violation' }).kind).toBe('validation');
    expect(
      toApiError({ code: '23514', message: 'violates check constraint "clients_status_check"' }).kind,
    ).toBe('validation');
  });

  it('maps the marked entity_type immutability invariant to conflict (API-R0-ENT)', () => {
    expect(
      toApiError({
        code: '23514',
        message: 'legal_entities.entity_type is immutable after creation (DM-05)',
        details: 'IMMUTABLE_FIELD:legal_entities.entity_type',
      }).kind,
    ).toBe('conflict');
  });

  it('maps anything unrecognized to internal and preserves the message', () => {
    const err = toApiError({ message: 'socket hangup' });
    expect(err.kind).toBe('internal');
    expect(err.message).toBe('socket hangup');
    expect(toApiError(null).kind).toBe('internal');
    expect(toApiError(undefined).kind).toBe('internal');
  });
});
