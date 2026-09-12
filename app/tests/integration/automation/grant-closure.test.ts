/**
 * IMP-050 — grant-closure contract for the automation records
 * (RLS-EVO-01 / RLS-SJR-01 / RLS-SDL-01, RLS-SVC-01/02, AUTO-SCH-03c).
 *
 * The three IMP-050 tables (event_outbox SCH-33, scheduler_job_runs SCH-34,
 * scheduler_dead_letters SCH-35) and every new scheduler/outbox function
 * have NO browser capability: zero table privileges for anon /
 * authenticated / service_role, no EXECUTE for anon / authenticated on any
 * scheduler/outbox/recurrence function, and requeue_dead_letter executable
 * by service_role ONLY (AUTO-RPL-02). Proven both catalog-side
 * (has_table_privilege / has_function_privilege via operator psql) and on
 * the real browser path (PostgREST as a signed-in registry user and as
 * anon — 403/401 with SQLSTATE 42501).
 *
 * This suite owns NO fixtures (there is nothing tenant-scoped to seed —
 * the grant closure is categorical) and leaves no residue.
 */
import { describe, expect, it, beforeAll } from 'vitest';

import { FIRM_A, api, localEnv, psql, signIn, userEmail } from '../helpers.mjs';

const TABLES = ['event_outbox', 'scheduler_job_runs', 'scheduler_dead_letters'];

// Owner-only: no EXECUTE for anon/authenticated/service_role/public.
const OWNER_ONLY = [
  'evaluate_recurrence()',
  'drain_event_outbox()',
  'register_scheduler_jobs()',
  'publish_domain_event(text,uuid,jsonb)',
  'generate_profile_instances(uuid,date,uuid)',
  'generate_successor_instance(uuid,uuid)',
  'immediate_automation_correlation()',
  'recurrence_period_anchor(text,date)',
  'recurrence_period_label(text,date)',
  'recurrence_due_date(jsonb,date,date)',
  'recurrence_lookahead_days(uuid)',
  'recurrence_insert_instance(client_compliance_profiles,uuid,date,date,date,uuid,uuid,uuid,uuid)',
  'evo_guard_update()',
  'sjr_guard_update()',
  'sdl_guard_write()',
  'event_publish_trg()',
];
const RECOVERY = 'requeue_dead_letter(uuid,text)';

let superAdminA: string;

beforeAll(async () => {
  const s = await signIn(userEmail('USER_A_SUPER_ADMIN'));
  if (!s.ok) throw new Error(`sign-in failed: ${JSON.stringify(s.raw)}`);
  superAdminA = s.token;
});

describe('TEST-RLS-EVO-01/SJR-01/SDL-01 — zero table privileges for application roles', () => {
  it('anon, authenticated and service_role hold NO select/insert/update/delete on the three tables', () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const table of TABLES) {
        for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          expect(
            psql(`select has_table_privilege('${role}', 'public.${table}', '${priv}')`).trim(),
            `${role} ${priv} ${table}`,
          ).toBe('f');
        }
      }
    }
  });

  it('information_schema confirms zero grant rows for the automation tables', () => {
    expect(
      psql(`select count(*) from information_schema.role_table_grants
            where table_schema = 'public'
              and table_name in ('event_outbox', 'scheduler_job_runs', 'scheduler_dead_letters')
              and grantee in ('anon', 'authenticated', 'service_role');`).trim(),
    ).toBe('0');
  });
});

describe('TEST-RLS-EVO-01/SJR-01/SDL-01 — function EXECUTE closure', () => {
  it('anon and authenticated have NO EXECUTE on any scheduler/outbox/recurrence function', () => {
    for (const role of ['anon', 'authenticated']) {
      for (const fn of [...OWNER_ONLY, RECOVERY]) {
        expect(
          psql(`select has_function_privilege('${role}', 'public.${fn}', 'EXECUTE')`).trim(),
          `${role} EXECUTE ${fn}`,
        ).toBe('f');
      }
    }
  });

  it('service_role has NO EXECUTE on the owner-only functions but CAN execute requeue_dead_letter (RLS-SVC-01)', () => {
    for (const fn of OWNER_ONLY) {
      expect(
        psql(`select has_function_privilege('service_role', 'public.${fn}', 'EXECUTE')`).trim(),
        `service_role EXECUTE ${fn}`,
      ).toBe('f');
    }
    expect(
      psql(`select has_function_privilege('service_role', 'public.${RECOVERY}', 'EXECUTE')`).trim(),
    ).toBe('t');
  });

  it('PUBLIC has no EXECUTE on any of the new functions', () => {
    for (const fn of [...OWNER_ONLY, RECOVERY]) {
      expect(psql(`select has_function_privilege('public', 'public.${fn}', 'EXECUTE')`).trim(), `public ${fn}`).toBe(
        'f',
      );
    }
  });
});

describe('TEST-RLS-EVO-01/SJR-01/SDL-01 — real browser-path proof', () => {
  it('a signed-in user reading the automation tables through PostgREST gets 403 / 42501', async () => {
    for (const table of TABLES) {
      const res = await api(superAdminA, 'GET', `${table}?select=id`, { headers: { 'x-active-firm': FIRM_A } });
      expect(res.status, table).toBe(403);
      expect((res.body as { code?: string })?.code).toBe('42501');
    }
  });

  it('a signed-in user cannot WRITE the automation tables through PostgREST', async () => {
    const ins = await api(superAdminA, 'POST', 'event_outbox', {
      headers: { 'x-active-firm': FIRM_A },
      body: { event_id: crypto.randomUUID(), event_type: 'task.created', actor_type: 'human', correlation_id: crypto.randomUUID(), payload: {} },
    });
    expect([401, 403]).toContain(ins.status);
  });

  it('anon (apikey only, no token) is refused identically (401 / 42501)', async () => {
    const { API_URL, ANON_KEY } = localEnv();
    for (const table of TABLES) {
      const res = await fetch(`${API_URL}/rest/v1/${table}?select=id`, { headers: { apikey: ANON_KEY } });
      expect(res.status, table).toBe(401);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe('42501');
    }
  });
});
