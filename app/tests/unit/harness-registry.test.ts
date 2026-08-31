import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * IMP-003 — integrity of the deterministic harness fixture registry
 * (tests/harness/registry.json). Runs without Supabase; live-state
 * verification is `npm run db:verify:harness`.
 */

interface Persona {
  id: string;
  email: string;
  persona: string;
  firm?: string;
  firms?: string[];
}

interface Registry {
  passwordLocalOnly: string;
  firms: Record<string, { id: string; label: string }>;
  users: Record<string, Persona>;
}

const registry = JSON.parse(
  readFileSync(resolve('tests/harness/registry.json'), 'utf8'),
) as Registry;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const REQUIRED_PERSONAS = [
  'USER_A_PARTNER',
  'USER_A_MANAGER',
  'USER_A_SENIOR',
  'USER_B_PARTNER',
  'USER_MULTI_FIRM',
  'USER_CLIENT_OVERLAP',
];

// TEST-RLS-GEN-01: every R0 role must be covered in BOTH firms.
const R0_ROLES = ['super_admin', 'partner', 'manager', 'senior', 'article_executive', 'billing'];

describe('harness fixture registry (IMP-003)', () => {
  it('reserves deterministic IDs for Firm A and Firm B', () => {
    expect(Object.keys(registry.firms).sort()).toEqual(['FIRM_A', 'FIRM_B']);
    for (const firm of Object.values(registry.firms)) {
      expect(firm.id).toMatch(UUID_RE);
    }
    expect(new Set(Object.values(registry.firms).map((f) => f.id)).size).toBe(2);
  });

  it('contains all required personas, including every R0 role per firm', () => {
    for (const key of REQUIRED_PERSONAS) {
      expect(registry.users[key], key).toBeDefined();
    }
    for (const firm of ['FIRM_A', 'FIRM_B']) {
      for (const role of R0_ROLES) {
        const found = Object.values(registry.users).some(
          (u) => u.firm === firm && u.persona === role,
        );
        expect(found, `${firm} ${role}`).toBe(true);
      }
    }
    // membership-state and overlap personas for TEST-SPIKE-J-02 / TEST-RLS-GEN-03
    expect(registry.users.USER_A_SUSPENDED.persona).toBe('suspended_membership');
    expect(registry.users.USER_A_REMOVED.persona).toBe('removed_membership');
    expect(registry.users.USER_MULTI_FIRM.firms?.sort()).toEqual(['FIRM_A', 'FIRM_B']);
  });

  it('uses valid, unique UUIDs for every identity', () => {
    const ids = Object.values(registry.users).map((u) => u.id);
    for (const id of ids) {
      expect(id).toMatch(UUID_RE);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses unique emails on the reserved .test domain', () => {
    const emails = Object.values(registry.users).map((u) => u.email.toLowerCase());
    for (const email of emails) {
      expect(email).toMatch(/^[a-z.]+@caos\.test$/);
    }
    expect(new Set(emails).size).toBe(emails.length);
  });

  it('declares a local-only test fixture credential', () => {
    expect(registry.passwordLocalOnly).toBe('caos-harness-local-only');
  });
});
