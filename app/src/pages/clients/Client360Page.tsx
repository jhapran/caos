/**
 * IMP-022 — Client 360 (`/clients/:clientId`), the staff-side client hub.
 *
 * Data: client360Service.getClient360 (API-R0-CLI composite read, DM-X-02)
 * — one contract, several RLS-scoped underlying reads. Writes (add legal
 * entity / add registration) reuse the IMP-020 clientHierarchyService
 * contracts; IMP-022 adds no new mutation contracts.
 *
 * State semantics:
 *   loading            — explicit, never a permanent spinner;
 *   null result        — ONE safe "not found" surface for unknown AND
 *                        inaccessible ids alike (API-ERR-02 — no existence
 *                        oracle, no tab/behavior difference);
 *   ApiError           — deterministic error panel with retry;
 *   empty collections  — per-section empty states, never confused with a
 *                        missing client.
 *
 * Deferred tabs (Compliance / Documents / Communications / Financials)
 * render explicit deferred states — no fixture domain data is ever shown
 * in supabase mode, and no production content is fabricated.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarClock, Landmark, MessageSquare, ShieldQuestion } from 'lucide-react';

import DataTable, { type Column } from '@/components/DataTable';
import EmptyState from '@/components/EmptyState';
import StatusPill from '@/components/StatusPill';
import Tabs from '@/components/Tabs';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ApiError,
  client360Service,
  clientHierarchyService,
  getActiveFirm,
  tenancyService,
  type Client360Relationship,
  type Client360View,
  type LegalEntityRecord,
  type LegalEntityType,
  type RegistrationType,
} from '@/data';

import {
  CLIENT_STATUS_LABEL,
  ENGAGEMENT_STATUS_LABEL,
  ENTITY_STATUS_LABEL,
  ENTITY_TYPE_LABEL,
  LETTER_STATUS_LABEL,
  REGISTRATION_STATUS_LABEL,
  RELATION_TYPE_LABEL,
  RELATIONSHIP_STATUS_LABEL,
  RISK_LABEL,
} from './labels';

const WRITE_ROLES = new Set(['super_admin', 'partner', 'manager']); // RLS-CLI-02
const REGISTRATION_TYPES: RegistrationType[] = [
  'PAN',
  'GSTIN',
  'TAN',
  'CIN',
  'LLPIN',
  'DIN',
  'PT',
  'PF',
  'ESI',
  'OTHER',
];

function DeferredTab({ label, detail }: { label: string; detail: string }) {
  return (
    <EmptyState
      icon={CalendarClock}
      title={`${label} — coming in a later release`}
      description={detail}
    />
  );
}

export default function Client360Page() {
  const { clientId = '' } = useParams();
  // Result is keyed by the requested id: a param change automatically
  // re-enters the loading state without a synchronous setState in the
  // effect (react-hooks/set-state-in-effect).
  const [result, setResult] = useState<{
    id: string;
    view: Client360View | null;
    error: string | null;
  } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const view = await client360Service.getClient360(clientId);
        if (!cancelled) setResult({ id: clientId, view, error: null });
      } catch (e) {
        if (!cancelled) {
          setResult({
            id: clientId,
            view: null,
            error: e instanceof ApiError ? e.message : 'Could not load this client',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, reloadTick]);

  const reload = () => setReloadTick((t) => t + 1);
  const current = result?.id === clientId ? result : null;
  const error = current?.error ?? null;
  const view: Client360View | null | undefined = current ? current.view : undefined;
  const [tab, setTab] = useState('overview');
  const [canWrite, setCanWrite] = useState(false);

  // Dialog state
  const [entityDialog, setEntityDialog] = useState(false);
  const [regDialogFor, setRegDialogFor] = useState<LegalEntityRecord | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [entityForm, setEntityForm] = useState({
    entityType: 'private_limited' as LegalEntityType,
    legalName: '',
    incorporationDate: '',
    registeredAddress: '',
  });
  const [regForm, setRegForm] = useState({
    type: 'PAN' as RegistrationType,
    value: '',
    state: '',
    validFrom: '',
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const memberships = await tenancyService.listMyMemberships();
        if (cancelled) return;
        const activeFirm = getActiveFirm();
        const mine =
          memberships.find((m) => m.firmId === activeFirm && m.status === 'active') ??
          memberships.find((m) => m.status === 'active');
        setCanWrite(!!mine && WRITE_ROLES.has(mine.role));
      } catch {
        // Affordance only — authorization stays with the database.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onCreateEntity(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSubmitError(null);
    try {
      await clientHierarchyService.createLegalEntity({
        clientId,
        entityType: entityForm.entityType,
        legalName: entityForm.legalName.trim(),
        incorporationDate: entityForm.incorporationDate || null,
        registeredAddress: entityForm.registeredAddress.trim() || null,
      });
      setEntityDialog(false);
      setEntityForm({
        entityType: 'private_limited',
        legalName: '',
        incorporationDate: '',
        registeredAddress: '',
      });
      reload();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Could not add the legal entity');
    } finally {
      setBusy(false);
    }
  }

  async function onCreateRegistration(e: FormEvent) {
    e.preventDefault();
    if (!regDialogFor) return;
    setBusy(true);
    setSubmitError(null);
    try {
      await clientHierarchyService.createRegistration({
        legalEntityId: regDialogFor.id,
        type: regForm.type,
        value: regForm.value.trim(),
        state: regForm.state.trim() || null,
        validFrom: regForm.validFrom || null,
      });
      setRegDialogFor(null);
      setRegForm({ type: 'PAN', value: '', state: '', validFrom: '' });
      reload();
    } catch (err) {
      // Duplicate (firm, type, value) surfaces as conflict (API-R0-REG).
      setSubmitError(err instanceof ApiError ? err.message : 'Could not add the registration');
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="p-6">
        <EmptyState
          title="Couldn’t load Client 360"
          description={error}
          action={{ label: 'Retry', onClick: reload }}
        />
      </div>
    );
  }
  if (view === undefined) {
    return <p className="p-6 text-[13px] text-ink-3">Loading Client 360…</p>;
  }
  if (view === null) {
    // API-ERR-02: identical surface for nonexistent and inaccessible ids.
    return (
      <div className="p-6">
        <EmptyState
          icon={ShieldQuestion}
          title="Client not found"
          description="This client does not exist in your current workspace."
        />
        <p className="mt-4 text-center text-[13px]">
          <Link to="/clients" className="text-brand hover:underline">
            Back to clients
          </Link>
        </p>
      </div>
    );
  }

  const { client } = view;
  const registrationsByEntity = new Map<string, typeof view.registrations>();
  for (const r of view.registrations) {
    registrationsByEntity.set(r.legalEntityId, [
      ...(registrationsByEntity.get(r.legalEntityId) ?? []),
      r,
    ]);
  }

  const relationshipColumns: Column<Client360Relationship>[] = [
    {
      key: 'from',
      header: 'From',
      render: (r) => (
        <Link to={`/clients/${r.fromClientId}`} className="font-medium text-brand hover:underline">
          {r.fromEntityName}
        </Link>
      ),
    },
    { key: 'type', header: 'Relationship', render: (r) => RELATION_TYPE_LABEL[r.relationType] },
    {
      key: 'to',
      header: 'To',
      render: (r) =>
        r.toClientId ? (
          <Link
            to={`/clients/${r.toClientId}`}
            className="font-medium text-brand hover:underline"
          >
            {r.toEntityName}
          </Link>
        ) : (
          <span className="text-ink-3">{r.toEntityName}</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusPill status={RELATIONSHIP_STATUS_LABEL[r.status]} />,
    },
    {
      key: 'dates',
      header: 'Effective',
      render: (r) => (
        <span className="tnum text-ink-3">
          {r.effectiveFrom ?? '—'} → {r.effectiveTo ?? 'present'}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5 p-6">
      <div>
        <p className="text-[12px] text-ink-3">
          <Link to="/clients" className="hover:text-brand">
            Clients
          </Link>{' '}
          / {client.name}
        </p>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="font-display text-2xl text-ink">{client.name}</h1>
          <StatusPill status={CLIENT_STATUS_LABEL[client.status]} />
          {client.riskRating ? (
            <span className="text-[12px] text-ink-3">Risk: {RISK_LABEL[client.riskRating]}</span>
          ) : null}
        </div>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        items={[
          { id: 'overview', label: 'Overview' },
          { id: 'entities', label: 'Entities & identifiers', count: view.legalEntities.length },
          { id: 'relationships', label: 'Relationships', count: view.relationships.length },
          { id: 'engagements', label: 'Engagements', count: view.engagements.length },
          { id: 'compliance', label: 'Compliance' },
          { id: 'documents', label: 'Documents' },
          { id: 'communications', label: 'Communications' },
          { id: 'financials', label: 'Financials' },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-xl border border-line bg-card p-5">
            <h2 className="text-[14px] font-semibold text-ink">Client overview</h2>
            <dl className="mt-4 grid grid-cols-[140px_1fr] gap-y-2.5 text-[13px]">
              <dt className="text-ink-3">Industry</dt>
              <dd className="text-ink">{client.industry ?? '—'}</dd>
              <dt className="text-ink-3">Partner</dt>
              <dd className="text-ink">{view.ownerPartner?.fullName ?? '—'}</dd>
              <dt className="text-ink-3">Manager</dt>
              <dd className="text-ink">{view.manager?.fullName ?? '—'}</dd>
              <dt className="text-ink-3">Risk rating</dt>
              <dd className="text-ink">
                {client.riskRating ? RISK_LABEL[client.riskRating] : '—'}
              </dd>
              <dt className="text-ink-3">Tags</dt>
              <dd className="text-ink">{client.tags.length ? client.tags.join(', ') : '—'}</dd>
              <dt className="text-ink-3">Identifiers</dt>
              <dd className="text-ink">
                {view.registrations.length
                  ? view.registrations.map((r) => `${r.type} ${r.value}`).join(' · ')
                  : '—'}
              </dd>
            </dl>
          </section>

          <section className="rounded-xl border border-line bg-card p-5">
            <h2 className="text-[14px] font-semibold text-ink">Contacts</h2>
            {view.contacts.length === 0 ? (
              <p className="mt-4 text-[13px] text-ink-3">No contacts recorded for this client.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {view.contacts.map((c) => (
                  <li key={c.id} className="text-[13px]">
                    <span className="font-medium text-ink">{c.name}</span>
                    {c.isPrimary ? (
                      <span className="ml-2 rounded-full bg-gold-soft px-1.5 py-px text-[11px] font-semibold text-gold">
                        Primary
                      </span>
                    ) : null}
                    <span className="block text-ink-3">
                      {[c.roleTitle, c.email, c.phone].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {tab === 'entities' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            {canWrite && (
              <Button size="sm" onClick={() => setEntityDialog(true)}>
                Add legal entity
              </Button>
            )}
          </div>
          {view.legalEntities.length === 0 ? (
            <EmptyState
              icon={Landmark}
              title="No legal entities"
              description="This client has no legal entities recorded yet."
            />
          ) : (
            view.legalEntities.map((entity) => (
              <section key={entity.id} className="rounded-xl border border-line bg-card p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h3 className="text-[14px] font-semibold text-ink">{entity.legalName}</h3>
                    <StatusPill status={ENTITY_STATUS_LABEL[entity.status]} size="sm" />
                  </div>
                  {canWrite && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSubmitError(null);
                        setRegDialogFor(entity);
                      }}
                    >
                      Add registration
                    </Button>
                  )}
                </div>
                <p className="mt-1 text-[12px] text-ink-3">
                  {ENTITY_TYPE_LABEL[entity.entityType]}
                  {entity.incorporationDate ? ` · Incorporated ${entity.incorporationDate}` : ''}
                  {entity.registeredAddress ? ` · ${entity.registeredAddress}` : ''}
                </p>
                <div className="mt-4">
                  <DataTable
                    columns={[
                      { key: 'type', header: 'Type', render: (r) => r.type },
                      {
                        key: 'value',
                        header: 'Identifier',
                        render: (r) => <span className="tnum font-medium">{r.value}</span>,
                      },
                      { key: 'state', header: 'State', render: (r) => r.state ?? '—' },
                      {
                        key: 'validity',
                        header: 'Validity',
                        render: (r) => (
                          <span className="tnum text-ink-3">
                            {r.validFrom ?? '—'} → {r.validTo ?? 'open'}
                          </span>
                        ),
                      },
                      {
                        key: 'status',
                        header: 'Status',
                        render: (r) => (
                          <StatusPill status={REGISTRATION_STATUS_LABEL[r.status]} size="sm" />
                        ),
                      },
                    ]}
                    rows={registrationsByEntity.get(entity.id) ?? []}
                    rowKey={(r) => r.id}
                    emptyMessage="No registrations recorded"
                  />
                </div>
              </section>
            ))
          )}
        </div>
      )}

      {tab === 'relationships' &&
        (view.relationships.length === 0 ? (
          <EmptyState
            title="No relationships"
            description="No group or related-party links are recorded for this client’s entities."
          />
        ) : (
          <DataTable
            columns={relationshipColumns}
            rows={view.relationships}
            rowKey={(r) => r.id}
          />
        ))}

      {tab === 'engagements' &&
        (view.engagements.length === 0 ? (
          <EmptyState
            title="No engagements"
            description="No professional-service engagements are recorded for this client."
          />
        ) : (
          <DataTable
            columns={[
              {
                key: 'services',
                header: 'Service lines',
                render: (e) => e.engagement.serviceLines.join(', ') || '—',
              },
              {
                key: 'partner',
                header: 'Responsible partner',
                render: (e) => e.responsiblePartnerName ?? '—',
              },
              {
                key: 'letter',
                header: 'Engagement letter',
                render: (e) => (
                  <StatusPill status={LETTER_STATUS_LABEL[e.engagement.letterStatus]} size="sm" />
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (e) => (
                  <StatusPill status={ENGAGEMENT_STATUS_LABEL[e.engagement.status]} size="sm" />
                ),
              },
              {
                key: 'period',
                header: 'Period',
                render: (e) => <span className="tnum">{e.engagement.periodLabel ?? '—'}</span>,
              },
              {
                key: 'signed',
                header: 'Signed',
                render: (e) => (
                  <span className="tnum text-ink-3">
                    {e.engagement.signedAt?.slice(0, 10) ?? '—'}
                  </span>
                ),
              },
            ]}
            rows={view.engagements}
            rowKey={(e) => e.engagement.id}
          />
        ))}

      {tab === 'compliance' && (
        <DeferredTab
          label="Compliance"
          detail="Live compliance status for this client arrives with the Compliance Engine release. Nothing here is fixture data."
        />
      )}
      {tab === 'documents' && (
        <DeferredTab
          label="Documents"
          detail="Client documents arrive with the Documents release."
        />
      )}
      {tab === 'communications' && (
        <EmptyState
          icon={MessageSquare}
          title="No communications yet"
          description="Emails, reminders, portal messages and notes will appear here when client communications land in a later release."
        />
      )}
      {tab === 'financials' && (
        <DeferredTab
          label="Financial snapshot"
          detail="Revenue, receivables and period comparisons arrive with accounting integrations in a later release."
        />
      )}

      <Dialog open={entityDialog} onOpenChange={setEntityDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add legal entity</DialogTitle>
            <DialogDescription>
              The company, LLP, individual or other legal person this client operates through.
              Entity type cannot be changed later.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onCreateEntity} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="le-name">Legal name</Label>
              <Input
                id="le-name"
                required
                value={entityForm.legalName}
                onChange={(e) => setEntityForm({ ...entityForm, legalName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Entity type</Label>
              <Select
                value={entityForm.entityType}
                onValueChange={(v) => setEntityForm({ ...entityForm, entityType: v as LegalEntityType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ENTITY_TYPE_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="le-incorp">Incorporation date</Label>
              <Input
                id="le-incorp"
                type="date"
                value={entityForm.incorporationDate}
                onChange={(e) => setEntityForm({ ...entityForm, incorporationDate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="le-address">Registered address</Label>
              <Input
                id="le-address"
                value={entityForm.registeredAddress}
                onChange={(e) => setEntityForm({ ...entityForm, registeredAddress: e.target.value })}
              />
            </div>
            {submitError ? <p className="text-sm text-critical">{submitError}</p> : null}
            <DialogFooter>
              <Button type="submit" disabled={busy || !entityForm.legalName.trim()}>
                {busy ? 'Saving…' : 'Add entity'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!regDialogFor} onOpenChange={(open) => !open && setRegDialogFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add registration</DialogTitle>
            <DialogDescription>
              A statutory identifier for {regDialogFor?.legalName}. GSTIN registrations require a
              state.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onCreateRegistration} className="space-y-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={regForm.type}
                onValueChange={(v) => setRegForm({ ...regForm, type: v as RegistrationType })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REGISTRATION_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-value">Identifier</Label>
              <Input
                id="reg-value"
                required
                value={regForm.value}
                onChange={(e) => setRegForm({ ...regForm, value: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-state">State{regForm.type === 'GSTIN' ? ' (required)' : ''}</Label>
              <Input
                id="reg-state"
                required={regForm.type === 'GSTIN'}
                value={regForm.state}
                onChange={(e) => setRegForm({ ...regForm, state: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-valid-from">Valid from</Label>
              <Input
                id="reg-valid-from"
                type="date"
                value={regForm.validFrom}
                onChange={(e) => setRegForm({ ...regForm, validFrom: e.target.value })}
              />
            </div>
            {submitError ? <p className="text-sm text-critical">{submitError}</p> : null}
            <DialogFooter>
              <Button type="submit" disabled={busy || !regForm.value.trim()}>
                {busy ? 'Saving…' : 'Add registration'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
