/**
 * IMP-022 — Clients list (`/clients`), live on the @/data boundary.
 *
 * Data: clientHierarchyService.listClients (API-R0-CLI list contract —
 * status filter, name sort, offset pagination at the API-CONV-02 default
 * page size 50) plus client360Service.listActiveStaff for partner display
 * names. Empty collections are normal results, never errors
 * (API-ERR-02); provider failures render a deterministic error state
 * with retry (API-CONV-06).
 *
 * The "New client" affordance is shown only to roles with write scope
 * (manager+ per RLS-CLI-02) as a UX hint — authorization itself is
 * enforced by the database, and denials surface as errors (API-ERR-03).
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';

import DataTable, { type Column } from '@/components/DataTable';
import EmptyState from '@/components/EmptyState';
import StatusPill from '@/components/StatusPill';
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
  type ClientRecord,
  type ClientRiskRating,
  type ClientStatus,
  type StaffRef,
} from '@/data';

import { CLIENT_STATUS_LABEL, RISK_LABEL } from './labels';

const PAGE_SIZE = 50; // API-CONV-02 default; max 200.
const WRITE_ROLES = new Set(['super_admin', 'partner', 'manager']); // RLS-CLI-02

interface NewClientForm {
  name: string;
  industry: string;
  riskRating: ClientRiskRating | '';
  ownerPartnerMembershipId: string;
  managerMembershipId: string;
}

const EMPTY_FORM: NewClientForm = {
  name: '',
  industry: '',
  riskRating: '',
  ownerPartnerMembershipId: '',
  managerMembershipId: '',
};

export default function ClientsPage() {
  const navigate = useNavigate();
  const [clients, setClients] = useState<ClientRecord[] | null>(null);
  const [staff, setStaff] = useState<StaffRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ClientStatus | ''>('');
  const [page, setPage] = useState(0);
  const [canWrite, setCanWrite] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<NewClientForm>(EMPTY_FORM);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const staffById = useMemo(() => new Map(staff.map((s) => [s.membershipId, s])), [staff]);

  // Data load: async IIFE so no setState runs synchronously inside the
  // effect (react-hooks/set-state-in-effect); retry goes through the
  // reload tick from the error-state button (an event handler).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await clientHierarchyService.listClients({
          status: statusFilter || undefined,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        });
        if (!cancelled) {
          setClients(rows);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : 'Could not load clients');
          setClients([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [statusFilter, page, reloadTick]);

  const retry = () => {
    setClients(null);
    setError(null);
    setReloadTick((t) => t + 1);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [memberships, directory] = await Promise.all([
          tenancyService.listMyMemberships(),
          client360Service.listActiveStaff(),
        ]);
        if (cancelled) return;
        setStaff(directory);
        const activeFirm = getActiveFirm();
        const mine =
          memberships.find((m) => m.firmId === activeFirm && m.status === 'active') ??
          memberships.find((m) => m.status === 'active');
        setCanWrite(!!mine && WRITE_ROLES.has(mine.role));
      } catch {
        // The directory is a display affordance; the list itself stays
        // usable without it (names fall back to a dash).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSubmitError(null);
    try {
      const created = await clientHierarchyService.createClient({
        name: form.name.trim(),
        industry: form.industry.trim() || null,
        riskRating: form.riskRating || null,
        ownerPartnerMembershipId: form.ownerPartnerMembershipId,
        managerMembershipId: form.managerMembershipId || null,
      });
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      navigate(`/clients/${created.id}`);
    } catch (err) {
      // API-ERR-03: write denials surface to the user, never swallowed.
      setSubmitError(err instanceof ApiError ? err.message : 'Could not create the client');
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<ClientRecord>[] = [
    {
      key: 'name',
      header: 'Client',
      render: (c) => <span className="font-medium text-ink">{c.name}</span>,
      sortValue: (c) => c.name,
    },
    { key: 'industry', header: 'Industry', render: (c) => c.industry ?? '—' },
    {
      key: 'risk',
      header: 'Risk',
      render: (c) => (c.riskRating ? RISK_LABEL[c.riskRating] : '—'),
    },
    {
      key: 'partner',
      header: 'Partner',
      render: (c) => staffById.get(c.ownerPartnerMembershipId)?.fullName ?? '—',
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) => <StatusPill status={CLIENT_STATUS_LABEL[c.status]} />,
    },
    {
      key: 'tags',
      header: 'Tags',
      render: (c) => (
        <span className="text-ink-3">{c.tags.length ? c.tags.join(', ') : '—'}</span>
      ),
    },
  ];

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-ink">Clients</h1>
          <p className="mt-1 text-[13px] text-ink-3">
            The firm&rsquo;s client book. Select a client to open Client 360.
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> New client
          </Button>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Label htmlFor="status-filter" className="text-[13px] text-ink-3">
          Status
        </Label>
        <Select
          value={statusFilter || 'all'}
          onValueChange={(v) => {
            setPage(0);
            setStatusFilter(v === 'all' ? '' : (v as ClientStatus));
          }}
        >
          <SelectTrigger id="status-filter" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All (except offboarded)</SelectItem>
            {Object.entries(CLIENT_STATUS_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <EmptyState
          title="Couldn’t load clients"
          description={error}
          action={{ label: 'Retry', onClick: retry }}
        />
      ) : clients === null ? (
        <p className="py-16 text-center text-[13px] text-ink-3">Loading clients…</p>
      ) : clients.length === 0 ? (
        <EmptyState
          title="No clients found"
          description="No clients match the current filter in this workspace."
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={clients}
            rowKey={(c) => c.id}
            onRowClick={(c) => navigate(`/clients/${c.id}`)}
            pageSize={PAGE_SIZE}
            emptyMessage="No clients on this page"
          />
          <div className="flex items-center justify-between text-[13px] text-ink-3">
            <span>
              Page {page + 1} · showing {clients.length} client{clients.length === 1 ? '' : 's'}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={clients.length < PAGE_SIZE}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New client</DialogTitle>
            <DialogDescription>
              Create the commercial relationship. Legal entities and registrations are added from
              Client 360.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nc-name">Client name</Label>
              <Input
                id="nc-name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nc-industry">Industry</Label>
              <Input
                id="nc-industry"
                value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Risk rating</Label>
              <Select
                value={form.riskRating || 'unset'}
                onValueChange={(v) =>
                  setForm({ ...form, riskRating: v === 'unset' ? '' : (v as ClientRiskRating) })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">Not set</SelectItem>
                  {Object.entries(RISK_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Responsible partner</Label>
              <Select
                value={form.ownerPartnerMembershipId}
                onValueChange={(v) => setForm({ ...form, ownerPartnerMembershipId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a partner" />
                </SelectTrigger>
                <SelectContent>
                  {staff
                    .filter((s) => s.role === 'partner' || s.role === 'super_admin')
                    .map((s) => (
                      <SelectItem key={s.membershipId} value={s.membershipId}>
                        {s.fullName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Manager (optional)</Label>
              <Select
                value={form.managerMembershipId || 'none'}
                onValueChange={(v) =>
                  setForm({ ...form, managerMembershipId: v === 'none' ? '' : v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="No manager assigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No manager assigned</SelectItem>
                  {staff.map((s) => (
                    <SelectItem key={s.membershipId} value={s.membershipId}>
                      {s.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {submitError ? <p className="text-sm text-critical">{submitError}</p> : null}
            <DialogFooter>
              <Button type="submit" disabled={busy || !form.name.trim() || !form.ownerPartnerMembershipId}>
                {busy ? 'Creating…' : 'Create client'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
