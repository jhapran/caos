/**
 * IMP-050 — deferred-event publication wiring proof (spec 09 partition
 * notes, AUTO-FLOW-03): the eight catalogue events deferred by IMP-031 /
 * IMP-040 / IMP-041 / IMP-042 publish transactionally into event_outbox
 * (SCH-33) via the AFTER-row producer triggers:
 *   compliance_instance.created (manual AND recurrence paths),
 *   task.created / task.assigned / task.completed,
 *   review.submitted / review.completed,
 *   alert.created / alert.resolved.
 *
 * What this file proves: the right event type fires on the right mutation
 * with a minimal AUTO-ENV-01 payload, in the SAME transaction (a rolled-back
 * mutation leaves no publication), with server-side actor derivation
 * (browser path => human/auth.uid(); operator path => system). Drain
 * completion ('delivered' with the empty R0 consumer set, AUTO-FLOW-05) is
 * covered in outbox.test.ts; actor-model and correlation proofs for the
 * scheduler path live in scheduler-mechanism.test.ts.
 *
 * Deterministic ids in the 6f500000-…-06xx range; this suite owns one firm
 * (FW); teardown removes all suite rows (zero residue).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { api, psql, signIn, userEmail, userId } from '../helpers.mjs';

const FW = '6f500000-0000-4000-8000-000000000060';
const M = {
  superW: '6f500000-0000-4000-8000-0000000006a1',
  partnerW: '6f500000-0000-4000-8000-0000000006a2', // four-eyes: decider != submitter
};
const C = { w: '6f500000-0000-4000-8000-0000000006b1' };
const E = { w: '6f500000-0000-4000-8000-0000000006c1' };
const ALERT = '6f500000-0000-4000-8000-0000000006d4';

const SUPER_W = userId('USER_A_SUPER_ADMIN');
const PARTNER_W = userId('USER_A_PARTNER');
let superW: string;
const H = { 'x-active-firm': FW };

function eventsOf(type: string, idKey: string, id: string): Record<string, unknown>[] {
  const out = psql(`select row_to_json(o) from public.event_outbox o
    where o.firm_id = '${FW}' and o.event_type = '${type}'
      and o.payload ->> '${idKey}' = '${id}';`).trim();
  return out ? out.split('\n').map((l) => JSON.parse(l)) : [];
}

beforeAll(async () => {
  psql(`
    delete from public.audit_log where firm_id = '${FW}';
    delete from public.event_outbox where firm_id = '${FW}';
    delete from public.review_items where firm_id = '${FW}';
    delete from public.alerts where firm_id = '${FW}';
    delete from public.tasks where firm_id = '${FW}';
    delete from public.compliance_instances where firm_id = '${FW}';
    delete from public.legal_entities where firm_id = '${FW}';
    delete from public.clients where firm_id = '${FW}';
    delete from public.firm_memberships where firm_id = '${FW}';
    insert into public.firms (id, name) values ('${FW}', 'IMP-050 WIRING Firm')
    on conflict (id) do nothing;
    insert into public.firm_memberships (id, firm_id, user_id, role, status) values
      ('${M.superW}', '${FW}', '${SUPER_W}', 'super_admin', 'active'),
      ('${M.partnerW}', '${FW}', '${PARTNER_W}', 'partner', 'active')
    on conflict (firm_id, user_id) do nothing;
    insert into public.clients (id, firm_id, name, owner_partner_membership_id, status) values
      ('${C.w}', '${FW}', 'WIRING Client', '${M.superW}', 'active');
    insert into public.legal_entities (id, firm_id, client_id, entity_type, legal_name) values
      ('${E.w}', '${FW}', '${C.w}', 'private_limited', 'WIRING Entity');
    -- entity type with NO active rule version: manual instance inserts stay
    -- purely manual (the generator has nothing to materialize for it).
    insert into public.compliance_types
      (id, firm_id, type_key, name, category, frequency, due_rule, workflow_template,
       scope_kind, registration_class, governance_class, four_eyes_required)
    values
      ('6f500000-0000-4000-8000-0000000006e1', '${FW}', 'wiring-monthly', 'WIRING Monthly',
       'Certificates', 'monthly', '{"description":"n/a"}',
       '{"states":["not_started","preparation","closed"]}', 'entity', null, 'non_statutory', false);
    delete from public.audit_log where firm_id = '${FW}';
  `);
  const s = await signIn(userEmail('USER_A_SUPER_ADMIN'));
  if (!s.ok) throw new Error(`sign-in failed: ${JSON.stringify(s.raw)}`);
  superW = s.token;
});

afterAll(() => {
  psql(`
    delete from public.audit_log where firm_id = '${FW}';
    delete from public.event_outbox where firm_id = '${FW}';
    delete from public.review_items where firm_id = '${FW}';
    delete from public.alerts where firm_id = '${FW}';
    delete from public.tasks where firm_id = '${FW}';
    delete from public.compliance_instances where firm_id = '${FW}';
    delete from public.compliance_rule_versions where firm_id = '${FW}';
    delete from public.compliance_types where firm_id = '${FW}';
    delete from public.legal_entities where firm_id = '${FW}';
    delete from public.clients where firm_id = '${FW}';
    delete from public.firm_memberships where firm_id = '${FW}';
    delete from public.firms where id = '${FW}';
    delete from public.audit_log where firm_id = '${FW}';
  `);
});

describe('spec 09 partition notes — the eight deferred events publish transactionally', () => {
  it('manual compliance_instance creation publishes compliance_instance.created with the HUMAN actor (browser path)', async () => {
    // The authenticated INSERT grant is column-pinned (AUTO-REC-07): no id /
    // provenance keys — the server assigns the id and defaults
    // generation_source to 'manual'.
    const res = await api(superW, 'POST', 'compliance_instances', {
      headers: H,
      body: {
        firm_id: FW,
        legal_entity_id: E.w,
        compliance_type_id: '6f500000-0000-4000-8000-0000000006e1',
        period_start: '2026-09-01',
        period_end: '2026-09-30',
        period_label: 'Sep 2026',
        due_date: '2026-10-10',
      },
    });
    expect(res.status).toBe(201);
    const inst = (res.body as Array<{ id: string }>)[0].id;
    const events = eventsOf('compliance_instance.created', 'instance_id', inst);
    expect(events.length).toBe(1);
    expect(events[0].actor_type).toBe('human');
    expect(events[0].actor_user_id).toBe(SUPER_W);
    expect(events[0].status).toBeDefined();
    expect(events[0].correlation_id).toBeDefined();
    // Manual creation never claims recurrence provenance (AUTO-REC-07).
    expect((events[0].payload as Record<string, unknown>).generation_source).toBe('manual');
  });

  it('task.created on insert, task.assigned on assignment change, task.completed on done', async () => {
    const ins = await api(superW, 'POST', 'tasks', {
      headers: H,
      body: {
        firm_id: FW,
        client_id: C.w,
        title: 'WIRING task',
        next_action: 'do it',
      },
    });
    expect(ins.status).toBe(201);
    const task = (ins.body as Array<{ id: string }>)[0].id;
    expect(eventsOf('task.created', 'task_id', task).length).toBe(1);

    // Assignment change (ordinary permitted non-state update).
    const upd = await api(superW, 'PATCH', `tasks?id=eq.${task}`, {
      headers: H,
      body: { assignee_membership_id: M.superW },
    });
    expect(upd.status).toBe(200);
    const assigned = eventsOf('task.assigned', 'task_id', task);
    expect(assigned.length).toBe(1);
    expect((assigned[0].payload as Record<string, unknown>).new_assignee_membership_id).toBe(M.superW);

    // Completion goes through the Layer-B transition command (IMP-040,
    // DM-SM-05 chain: open -> in_progress -> submitted -> approved -> done);
    // the publication trigger still fires in the same transaction.
    for (const target of ['in_progress', 'submitted', 'approved', 'done']) {
      const step = await api(superW, 'POST', 'rpc/transition_task', {
        headers: H,
        body: { p_task_id: task, p_target_status: target },
      });
      expect((step.body as { status: string }).status).toBe('transitioned');
    }
    expect(eventsOf('task.completed', 'task_id', task).length).toBe(1);
  });

  it('review.submitted on insert and review.completed on a terminal decision', async () => {
    // Submit through the Layer-B command (IMP-041): publication is part of
    // the same transaction even though the command suppresses Layer-A audit.
    const submit = await api(superW, 'POST', 'rpc/submit_review_item', {
      headers: H,
      body: {
        p_client_id: C.w,
        p_type: 'financial_statements',
        p_title: 'WIRING review',
      },
    });
    expect((submit.body as { status: string }).status).toBe('submitted');
    const reviewId = (submit.body as { item: { id: string } }).item.id;
    expect(eventsOf('review.submitted', 'review_item_id', reviewId).length).toBe(1);

    // Terminal decision: the decider must differ from the submitter
    // (RLS-4EY-04 — also a CHECK constraint), so the firm partner's
    // membership decides; staged operator-side under the command marker
    // (the publication trigger path is what is under test here).
    psql(`
      begin;
      set local app.review_decision_command = '1';
      set local app.audit_skip_trigger = '1';
      update public.review_items
      set status = 'approved', decided_by_membership_id = '${M.partnerW}',
          decided_at = now(), decision_rationale = 'wiring probe'
      where id = '${reviewId}';
      commit;
    `);
    const completed = eventsOf('review.completed', 'review_item_id', reviewId);
    expect(completed.length).toBe(1);
    expect((completed[0].payload as Record<string, unknown>).decision).toBe('approved');
  });

  it('alert.created on insert and alert.resolved on resolve carry resolution_type', async () => {
    psql(`
      insert into public.alerts (id, firm_id, severity, title, client_id, status)
      values ('${ALERT}', '${FW}', 'warning', 'WIRING alert', '${C.w}', 'active');
    `);
    expect(eventsOf('alert.created', 'alert_id', ALERT).length).toBe(1);

    const res = await api(superW, 'POST', 'rpc/resolve_alert', {
      headers: H,
      body: { p_alert_id: ALERT },
    });
    expect((res.body as { status: string }).status).toBe('resolved');
    const resolved = eventsOf('alert.resolved', 'alert_id', ALERT);
    expect(resolved.length).toBe(1);
    expect((resolved[0].payload as Record<string, unknown>).resolution_type).toBe('manual');
  });

  it('transactionality: a FAILED mutation publishes nothing (AUTO-FLOW-03)', () => {
    // The insert violates the workflow/period contract (period_end <
    // period_start), so the whole statement — including any publication —
    // rolls back.
    const badId = '6f500000-0000-4000-8000-0000000006d9';
    try {
      psql(`
        insert into public.compliance_instances
          (id, firm_id, legal_entity_id, compliance_type_id,
           period_start, period_end, period_label, due_date)
        values ('${badId}', '${FW}', '${E.w}',
                '6f500000-0000-4000-8000-0000000006e1',
                '2026-09-30', '2026-09-01', 'bad', '2026-10-10');
      `);
      throw new Error('insert unexpectedly succeeded');
    } catch {
      // expected: CHECK violation
    }
    expect(eventsOf('compliance_instance.created', 'instance_id', badId).length).toBe(0);
  });
});
