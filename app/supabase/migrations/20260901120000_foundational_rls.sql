-- IMP-012 — Foundational production RLS (tenant core: SCH-01…03)
--
-- Implements the RESOLVED DEC-J mechanism (05 RLS-MECH-01) on the IMP-010
-- tenant-core tables:
--   auth.uid() (JWT) establishes IDENTITY only;
--   authorization is a LIVE read of public.firm_memberships on every
--   request (status + role current as of the check — suspension, removal,
--   downgrade and trusted upgrade take effect on the next authorization
--   check with no JWT refresh; IMP-004 spike evidence).
-- No JWT firm/role/membership claim is ever used as authorization data.
--
-- Requirement IDs: RLS-PRIN-01…04, RLS-CTX-01…03, RLS-TEN-01/02,
-- RLS-FRM-01, RLS-PRF-01, RLS-MEM-01, RLS-STF-01…07 (tenant-core cells),
-- RLS-SVC-01…03, RLS-AAL-01…03.
-- NOT here: per-domain policies (IMP-020+), audit (IMP-013), break-glass
-- (RLS-SUP-* — needs IMP-013 audit machinery; TEST-RLS-SUP-01 not claimed).
--
-- RLS is enabled on all three tables. FORCE ROW LEVEL SECURITY is
-- intentionally NOT set: RLS-PRIN-02's "enabled and forced" applies to
-- tenant-owned tables (SCH-04+, which carry firm_id and land later, where
-- forcing is safe); here forcing would (a) recurse the SECURITY DEFINER
-- live-membership helper on firm_memberships and (b) break owner-run
-- seed/maintenance writes that carry no JWT. Owner bypass on these three
-- global/root tables is accepted and documented.

-- ---------------------------------------------------------------------------
-- Helper functions (05 DEC-J "Helper-function rules")
-- ---------------------------------------------------------------------------

-- public.active_membership_role(uuid) — the ONE Security Definer helper.
-- Why it exists: the firm_memberships read policy must consult
-- firm_memberships itself; a plain in-policy subquery is infinite RLS
-- recursion. This function is the resolved DEC-J live lookup: it reads the
-- caller's CURRENT membership row for one firm and returns the role only
-- when the membership is active right now.
-- Security properties (security-critical — review carefully):
--   * SECURITY DEFINER, owned by the table owner, so it bypasses RLS on
--     firm_memberships — but ONLY for the exact predicate below
--     (auth.uid() + firm + status='active'); it exposes nothing else.
--   * pinned empty search_path; every referenced object fully qualified;
--     no caller-controlled SQL; STABLE; single static statement.
--   * EXECUTE revoked from PUBLIC/anon; granted to authenticated only.
create or replace function public.active_membership_role(p_firm_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.firm_memberships m
  where m.firm_id = p_firm_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
$$;

comment on function public.active_membership_role(uuid) is
  'IMP-012 DEC-J live membership lookup (RLS-MECH-01): current role of auth.uid() in the given firm, or NULL when no ACTIVE membership exists. SECURITY DEFINER solely to avoid RLS self-recursion on firm_memberships; never a convenience bypass.';

-- public.req_active_firm() — the UNTRUSTED active-firm selector
-- (RLS-CTX-02). Reading the x-active-firm request header never grants
-- anything by itself; policies always combine it with a live membership
-- check. Reused by tenant-owned tables in later packages.
create or replace function public.req_active_firm()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select nullif(current_setting('request.headers', true)::jsonb ->> 'x-active-firm', '')::uuid
$$;

comment on function public.req_active_firm() is
  'IMP-012 active-firm context (RLS-CTX-02): untrusted x-active-firm request header. Context only — validated against live membership wherever used.';

-- public.shares_active_firm_with(uuid) — profiles co-member predicate
-- (RLS-PRF-01). SECURITY DEFINER: a SECURITY INVOKER version would be
-- constrained by the firm_memberships SELECT policy, which is scoped by
-- the x-active-firm selector — profile co-member visibility must NOT
-- depend on which firm the caller currently has selected (a directory
-- lookup carries no firm context). The definer predicate below is exactly
-- the intended disclosure rule and nothing more: both sides must hold an
-- ACTIVE membership in a shared firm. Same pinned-search_path /
-- minimal-grant discipline as active_membership_role; it is never called
-- from a firm_memberships policy, so no recursion.
create or replace function public.shares_active_firm_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.firm_memberships mine
    join public.firm_memberships theirs on theirs.firm_id = mine.firm_id
    where mine.user_id = (select auth.uid())
      and mine.status = 'active'
      and theirs.user_id = p_user_id
      and theirs.status = 'active'
  )
$$;

comment on function public.shares_active_firm_with(uuid) is
  'IMP-012 RLS-PRF-01: true when auth.uid() and the given user share at least one firm where both hold ACTIVE memberships. SECURITY DEFINER (selector-independent directory lookup); exact-predicate only, never a bypass.';

revoke all on function public.active_membership_role(uuid) from public, anon;
revoke all on function public.req_active_firm() from public, anon;
revoke all on function public.shares_active_firm_with(uuid) from public, anon;
grant execute on function public.active_membership_role(uuid) to authenticated;
grant execute on function public.req_active_firm() to authenticated;
grant execute on function public.shares_active_firm_with(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Grants (least privilege at BOTH layers — spec 12 IMP-012 / user §15).
-- IMP-010 revoked everything fail-closed; re-grant only what the policies
-- below actually support. anon gets NOTHING (RLS-SVC-03).
-- ---------------------------------------------------------------------------

-- firms: staff read own firm row; super_admin may write firm SETTINGS
-- fields only — id/plan/status are not staff-writable (plan/status are
-- platform lifecycle, DM-SM-01; id is immutable). No INSERT (firm
-- provisioning is a platform/migration concern), no DELETE (SCH-01
-- lifecycle: never hard-deleted).
grant select on public.firms to authenticated;
grant update (name, frn, city, settings) on public.firms to authenticated;

-- profiles: co-members read BASIC DISPLAY FIELDS ONLY (RLS-PRF-01 —
-- column-level grant is the field boundary; phone is not display data).
-- Self may write own display/contact fields; id is immutable (no grant).
-- No INSERT (profile creation is the deferred provisioning RPC) / DELETE.
grant select (id, full_name, avatar_url) on public.profiles to authenticated;
grant update (full_name, avatar_url, phone) on public.profiles to authenticated;

-- firm_memberships: roster read + super_admin administration
-- (invite/suspend/remove/role). Column-level INSERT/UPDATE: the approved
-- write surface is exactly invite (firm_id/user_id/role/status/invited_by)
-- and suspend/remove/role-change (role/status) — identity and key columns
-- (id, user_id, firm_id) are never mutable. No DELETE — removal is the
-- status transition to 'removed' (SCH-03: never hard-deleted).
grant select on public.firm_memberships to authenticated;
grant insert (firm_id, user_id, role, status, invited_by) on public.firm_memberships to authenticated;
grant update (role, status) on public.firm_memberships to authenticated;

-- ---------------------------------------------------------------------------
-- RLS — firms (RLS-FRM-01)
-- ---------------------------------------------------------------------------
alter table public.firms enable row level security;

-- Read: live active membership in that firm. Multi-firm users see each of
-- their firms (this is what powers the firm switcher); suspended/removed
-- memberships see nothing (RLS-STF-07). No selector required here — the
-- row itself proves tenancy.
create policy firms_select_member on public.firms
  for select to authenticated
  using (public.active_membership_role(id) is not null);

-- Write: super_admin of that firm only (matrix §11: partner read-only).
create policy firms_update_super_admin on public.firms
  for update to authenticated
  using (public.active_membership_role(id) = 'super_admin')
  with check (public.active_membership_role(id) = 'super_admin');

-- ---------------------------------------------------------------------------
-- RLS — profiles (RLS-PRF-01). Profiles are identity/display data — never
-- membership or role authority (TEN-05); visibility must not become a
-- cross-tenant disclosure path, hence active memberships on BOTH sides.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy profiles_select_own_or_shared_firm on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or public.shares_active_firm_with(id)
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- RLS — firm_memberships (RLS-MEM-01 + RLS-AAL-01)
-- ---------------------------------------------------------------------------
alter table public.firm_memberships enable row level security;

-- Read: (a) own rows always — powers the firm switcher and lets a user see
-- their own invited/suspended state; (b) the roster of the SELECTED active
-- firm, only with a live active membership in it. The x-active-firm
-- selector is untrusted: without the live membership it selects nothing
-- (RLS-CTX-02). Partner read-all is covered by (b).
create policy memberships_select_own_or_active_firm on public.firm_memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      firm_id = public.req_active_firm()
      and public.active_membership_role(firm_id) is not null
    )
  );

-- Invite (INSERT): super_admin of the target firm, AAL2 step-up
-- (RLS-AAL-01: membership creation). inviter identity is server-derived —
-- the caller may only stamp themselves.
create policy memberships_insert_super_admin_aal2 on public.firm_memberships
  for insert to authenticated
  with check (
    public.active_membership_role(firm_id) = 'super_admin'
    and (select auth.jwt() ->> 'aal') = 'aal2'
    and invited_by = (select auth.uid())
  );

-- Suspend / remove / role change (UPDATE): super_admin, AAL2 (RLS-AAL-01:
-- removal and role changes). USING pins the CURRENT row's firm; WITH CHECK
-- pins the NEW row's firm — a row can never be moved into a firm the
-- caller does not super-admin. Non-super-admins can therefore never touch
-- role/status/firm_id/user_id, so self-elevation is impossible.
create policy memberships_update_super_admin_aal2 on public.firm_memberships
  for update to authenticated
  using (
    public.active_membership_role(firm_id) = 'super_admin'
    and (select auth.jwt() ->> 'aal') = 'aal2'
  )
  with check (
    public.active_membership_role(firm_id) = 'super_admin'
    and (select auth.jwt() ->> 'aal') = 'aal2'
  );

-- No DELETE policy and no DELETE grant: memberships are never hard-deleted.

-- ---------------------------------------------------------------------------
-- Notes for reviewers
-- ---------------------------------------------------------------------------
-- * AAL is read from the JWT's `aal` claim — an AUTHENTICATION assurance
--   claim issued by GoTrue at verification time, not tenant/role authority
--   (DEC-J untouched). RLS-AAL-03's freshness window is an
--   implementation-validated value not fixed by spec; Release-0 checks the
--   level only. Recorded in 13.
-- * Later audit requirement: membership administration writes are
--   audit-relevant (AUD-CAT-01) — IMP-013 attaches the audit layer; this
--   migration implements only the authorization boundary.
-- * PostgREST semantics verified during implementation: UPDATE/DELETE row
--   scans and INSERT/UPDATE RETURNING are additionally filtered by the
--   SELECT policy. Membership administration calls therefore carry the
--   x-active-firm header for the firm being administered (RLS-CTX-01 —
--   exactly one active context per request), and profile self-writes use
--   `Prefer: return=minimal` (or a display-column select) because
--   RETURNING * would require SELECT privilege on non-display columns.
