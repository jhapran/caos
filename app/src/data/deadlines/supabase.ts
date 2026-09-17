/**
 * IMP-051 (data-adapter slice) — Deadlines: SUPABASE adapter (production).
 *
 * Plain PostgREST reads under RLS (API-ARCH-03; DM-X-02 / My Work
 * precedent): the two IMP-051 security_invoker views carry the server-side
 * derivations (board aggregation, dependency ageing — AUTO-DLN-01,
 * API-ARCH-05), and the drill-down composes plain RLS-protected base-table
 * reads (compliance_instances + client/entity/assignee projections), so the
 * composition can never widen table RLS. Tenant isolation is identical to
 * the underlying instance/task reads (RLS-CIN-01/RLS-TSK-01): cross-firm
 * zero, manager portfolio scope, senior/article assigned-only.
 *
 * The operative due_date is read everywhere; the immutable
 * calculated_due_date provenance is never read or exposed by this contract
 * (SCH-12, AUTO-DLN-01). Day/period values are derived server-side on the
 * Asia/Kolkata business date inside the views; this adapter performs no
 * date reinterpretation.
 *
 * Collection semantics are API-ERR-02: empty scope → empty collection,
 * never an error and never fabricated rows. Errors are translated once
 * through toApiError() (API-ERR-01); no Supabase SDK or PostgREST types
 * cross this boundary.
 */
import { toApiError } from '@/data/errors';
import { getSupabaseClient } from '@/lib/supabaseClient';

import {
  parseDeadlineGroupId,
  type ClientDependencyKind,
  type ClientDependencyRecord,
  type DeadlineGroupRecord,
  type DeadlineInstanceRecord,
  type DeadlinesService,
} from './types';

// --- Row shapes (snake_case; the view/SCH-12 columns this read model needs) --------

interface DeadlineBoardRow {
  group_id: string;
  compliance_type_id: string;
  compliance_name: string;
  due_date: string;
  days_left: number;
  total_clients: number;
  filed: number;
  ready_to_file: number;
  in_progress: number;
  waiting: number;
  under_review: number;
  not_started: number;
  at_risk: number;
}

interface InstanceRow {
  id: string;
  client_id: string;
  legal_entity_id: string;
  compliance_type_id: string;
  period_label: string;
  state: string;
  due_date: string;
  assignee_membership_id: string | null;
  reviewer_membership_id: string | null;
}

interface DependencyRow {
  kind: ClientDependencyKind;
  id: string;
  client_id: string;
  client_name: string | null;
  label: string;
  period_label: string | null;
  waiting_reason: string | null;
  status: string;
  waiting_since: string | null;
  age_days: number;
  due_date: string | null;
  assignee_membership_id: string | null;
  reviewer_membership_id: string | null;
}

interface NameRow {
  id: string;
  name: string;
}

interface MembershipNameRow {
  id: string;
  user_id: string;
}

interface ProfileNameRow {
  id: string;
  full_name: string | null;
}

const INSTANCE_COLUMNS =
  'id, client_id, legal_entity_id, compliance_type_id, period_label, state, due_date, ' +
  'assignee_membership_id, reviewer_membership_id';

/** Staff display names: firm_memberships ⋈ profiles under the caller's own
 *  RLS (RLS-MEM-01/RLS-PRF-01 — the client360 precedent). Unresolvable
 *  names render null, never fail the read. */
async function resolveStaffNames(
  membershipIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (membershipIds.length === 0) return names;
  const client = getSupabaseClient();
  const { data: membershipRows, error: membershipError } = await client
    .from('firm_memberships')
    .select('id, user_id')
    .in('id', membershipIds);
  if (membershipError) throw toApiError(membershipError);
  const memberships = (membershipRows ?? []) as unknown as MembershipNameRow[];
  const userIds = [...new Set(memberships.map((m) => m.user_id))];
  if (userIds.length === 0) return names;
  const { data: profileRows, error: profileError } = await client
    .from('profiles')
    .select('id, full_name')
    .in('id', userIds);
  if (profileError) throw toApiError(profileError);
  const profiles = new Map(
    ((profileRows ?? []) as unknown as ProfileNameRow[]).map((p) => [p.id, p.full_name]),
  );
  for (const m of memberships) {
    const name = profiles.get(m.user_id);
    if (name) names.set(m.id, name);
  }
  return names;
}

export const supabaseDeadlines: DeadlinesService = {
  mode: 'supabase',

  async listDeadlineGroups(): Promise<DeadlineGroupRecord[]> {
    const client = getSupabaseClient();
    // Projection A: the security_invoker deadline board view — underlying
    // RLS-CIN-01 does the row filtering; the x-active-firm selector rides
    // on the request (RLS-CTX-02).
    const { data, error } = await client
      .from('deadline_board')
      .select(
        'group_id, compliance_type_id, compliance_name, due_date, days_left, ' +
          'total_clients, filed, ready_to_file, in_progress, waiting, under_review, ' +
          'not_started, at_risk',
      )
      .order('due_date', { ascending: true })
      .order('compliance_type_id', { ascending: true });
    if (error) throw toApiError(error);
    return ((data ?? []) as unknown as DeadlineBoardRow[]).map((r) => ({
      groupId: r.group_id,
      complianceTypeId: r.compliance_type_id,
      complianceName: r.compliance_name,
      dueDate: r.due_date,
      daysLeft: r.days_left,
      totalClients: r.total_clients,
      filed: r.filed,
      readyToFile: r.ready_to_file,
      inProgress: r.in_progress,
      waiting: r.waiting,
      underReview: r.under_review,
      notStarted: r.not_started,
      atRisk: r.at_risk,
    }));
  },

  async listDeadlineGroupInstances(groupId: string): Promise<DeadlineInstanceRecord[]> {
    const parsed = parseDeadlineGroupId(groupId);
    if (!parsed) return [];
    const client = getSupabaseClient();

    // Projection B: plain RLS-backed base-table reads (the reviewed
    // approach — no extra persisted DB object required). The operative
    // due_date addresses the group; calculated_due_date is never read.
    const { data, error } = await client
      .from('compliance_instances')
      .select(INSTANCE_COLUMNS)
      .eq('compliance_type_id', parsed.complianceTypeId)
      .eq('due_date', parsed.dueDate)
      .order('id', { ascending: true });
    if (error) throw toApiError(error);
    const instances = (data ?? []) as unknown as InstanceRow[];
    if (instances.length === 0) return [];

    const businessDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    const clientIds = [...new Set(instances.map((i) => i.client_id))];
    const entityIds = [...new Set(instances.map((i) => i.legal_entity_id))];
    const typeIds = [...new Set(instances.map((i) => i.compliance_type_id))];
    const membershipIds = [
      ...new Set(
        instances
          .flatMap((i) => [i.assignee_membership_id, i.reviewer_membership_id])
          .filter((x): x is string => x !== null),
      ),
    ];

    const [clientsRes, entitiesRes, typesRes, staffNames] = await Promise.all([
      client.from('clients').select('id, name').in('id', clientIds),
      client.from('legal_entities').select('id, legal_name').in('id', entityIds),
      client.from('compliance_types').select('id, name').in('id', typeIds),
      resolveStaffNames(membershipIds),
    ]);
    if (clientsRes.error) throw toApiError(clientsRes.error);
    if (entitiesRes.error) throw toApiError(entitiesRes.error);
    if (typesRes.error) throw toApiError(typesRes.error);

    const clientNames = new Map(
      ((clientsRes.data ?? []) as unknown as NameRow[]).map((c) => [c.id, c.name]),
    );
    const entityNames = new Map(
      ((entitiesRes.data ?? []) as unknown as Array<{ id: string; legal_name: string }>).map(
        (e) => [e.id, e.legal_name],
      ),
    );
    const typeNames = new Map(
      ((typesRes.data ?? []) as unknown as NameRow[]).map((t) => [t.id, t.name]),
    );

    return instances.map((i) => ({
      id: i.id,
      clientId: i.client_id,
      clientName: clientNames.get(i.client_id) ?? null,
      legalEntityId: i.legal_entity_id,
      entityName: entityNames.get(i.legal_entity_id) ?? null,
      complianceTypeId: i.compliance_type_id,
      complianceName: typeNames.get(i.compliance_type_id) ?? null,
      periodLabel: i.period_label,
      state: i.state,
      dueDate: i.due_date,
      daysLeft: Math.round(
        (Date.parse(`${i.due_date}T00:00:00Z`) - Date.parse(`${businessDate}T00:00:00Z`)) / 86400000,
      ),
      assigneeMembershipId: i.assignee_membership_id,
      assigneeName: i.assignee_membership_id
        ? (staffNames.get(i.assignee_membership_id) ?? null)
        : null,
      reviewerMembershipId: i.reviewer_membership_id,
      reviewerName: i.reviewer_membership_id
        ? (staffNames.get(i.reviewer_membership_id) ?? null)
        : null,
    }));
  },

  async listClientDependencies(): Promise<ClientDependencyRecord[]> {
    const client = getSupabaseClient();
    // Projection C: the security_invoker client-dependency view — instances
    // in information_requested plus waiting tasks; underlying RLS filters.
    const { data, error } = await client
      .from('client_dependency_board')
      .select(
        'kind, id, client_id, client_name, label, period_label, waiting_reason, status, ' +
          'waiting_since, age_days, due_date, assignee_membership_id, reviewer_membership_id',
      )
      .order('age_days', { ascending: false })
      .order('id', { ascending: true });
    if (error) throw toApiError(error);
    return ((data ?? []) as unknown as DependencyRow[]).map((r) => ({
      kind: r.kind,
      id: r.id,
      clientId: r.client_id,
      clientName: r.client_name,
      label: r.label,
      periodLabel: r.period_label,
      waitingReason: r.waiting_reason,
      status: r.status,
      waitingSince: r.waiting_since,
      ageDays: r.age_days,
      dueDate: r.due_date,
      assigneeMembershipId: r.assignee_membership_id,
      reviewerMembershipId: r.reviewer_membership_id,
    }));
  },
};
