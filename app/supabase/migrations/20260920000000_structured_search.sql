-- ============================================================================
-- IMP-061 — Structured global search (API-R0-SRC; IMP061-R1…R11 + M1-A)
--
-- ONE production structured-search function behind the Command Palette
-- (R8-B SECURITY INVOKER COMPOSITION): React → @/data search service →
-- public.structured_search(text) → the caller's ORDINARY RLS. The function
-- is SECURITY INVOKER — every table read below is filtered by the existing
-- policies exactly as a direct PostgREST read would be; search can never
-- widen row visibility (API-SEC-01, RLS-TEN-02).
--
-- Contract points implemented here:
--   R1  — exactly six kinds: client, legal_entity, registration, task,
--         compliance_instance, staff (ACTIVE firm_memberships of the
--         selected active firm). No seventh domain.
--   R3-B— identifiers (registrations.value) match EXACT or PREFIX only,
--         case-sensitive literal; textual names/labels match
--         case-insensitive substring with prefix ranked ahead of
--         substring-only. Input is treated literally: the LIKE escape
--         character is escaped FIRST, then the two wildcards; every LIKE
--         carries an explicit ESCAPE clause, so %, _, backslash, quotes and
--         operator-looking input (eq., or(, ilike., …) can never become
--         wildcard/filter syntax. plpgsql parameters are never interpolated
--         into SQL text — no dynamic SQL anywhere.
--   R4  — server-side minimum query length: trimmed input shorter than 2
--         characters returns ZERO rows (never an error).
--   R5  — caps enforced server-side BEFORE final shaping: at most 5 hits
--         per kind (per-branch ORDER BY … LIMIT 5) and at most 20 hits
--         globally (outer LIMIT 20). No pagination. Deterministic ordering:
--         match class (exact → prefix → substring), then the canonical
--         kind order, then the row id — a stable non-product technical
--         tie-break; no popularity/recency/fuzzy ranking.
--   R6  — authorization is ordinary caller RLS. The function takes NO
--         firm_id parameter (API-CONV-05): the active firm is the untrusted
--         x-active-firm selector revalidated against live membership by the
--         existing policies on every statement (RLS-CTX-02, RLS-MECH-01).
--         Staff hits are pinned through ACTIVE firm_memberships of the
--         selected active firm — profile visibility alone never produces a
--         staff hit, and invited/suspended/removed memberships are not
--         searchable staff.
--   R7  — registration matching uses the full authorized value, but the
--         projection returns ONLY the identifier type + last four
--         characters (values of four or fewer characters render a fixed
--         bullet mask, revealing nothing). The raw value never appears in
--         any returned column; href carries the parent client id only.
--   R10 — offboarded clients visible under the caller's ordinary RLS stay
--         searchable; their status is returned truthfully so the UI can
--         badge them Offboarded.
--   M1-A— the compliance-instance branch LEFT JOINs compliance_types under
--         the caller's RLS: an instance whose type row the caller cannot
--         read still survives on a period_label match, the hidden type name
--         never reaches the label, and partner/manager type-name matching
--         works only where their ordinary RLS actually reads the type.
--   R11-A— navigation is optional and truthful: client/legal_entity/
--         registration hits carry /clients/:clientId (entity/registration
--         via the authorized parent Client 360 surface); task,
--         compliance_instance and staff hits carry NULL — no fabricated
--         destination.
--   R9  — the raw query string is never persisted: this function writes
--         nothing (no audit/telemetry/error capture of q).
-- ============================================================================

create or replace function public.structured_search(p_query text)
returns table (
  kind text,
  id uuid,
  label text,
  sub text,
  href text,
  match_class text,
  status text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_q text := btrim(p_query);
  v_escaped text;
  v_sub text;
  v_pre text;
begin
  -- IMP061-R4: server-side minimum live-data query length. Short input is a
  -- truthful empty result (API-ERR-02), never an enumeration of tenant data.
  if v_q is null or char_length(v_q) < 2 then
    return;
  end if;

  -- IMP061-R3 literal treatment: escape the escape character FIRST, then
  -- the LIKE wildcards. Both patterns below are used only with ESCAPE '\'.
  v_escaped := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  v_sub := '%' || v_escaped || '%';
  v_pre := v_escaped || '%';

  return query
  with ranked as (
    -- --- client (R10: offboarded stays searchable, status truthfully carried)
    select * from (
      select
        'client'::text as kind,
        c.id,
        c.name as label,
        coalesce(c.industry, 'Client') as sub,
        ('/clients/' || c.id::text) as href,
        case when c.name ilike v_pre escape '\' then 'prefix' else 'substring' end as match_class,
        c.status
      from public.clients c
      where c.name ilike v_sub escape '\'
      order by case when c.name ilike v_pre escape '\' then 0 else 1 end, c.id
      limit 5
    ) hc
    union all
    -- --- legal_entity (navigates to the authorized parent Client 360, R11-A)
    select * from (
      select
        'legal_entity'::text,
        le.id,
        le.legal_name,
        nullif(concat_ws(' · ', le.entity_type, cl.name), ''),
        case when cl.id is not null then '/clients/' || cl.id::text end,
        case when le.legal_name ilike v_pre escape '\' then 'prefix' else 'substring' end,
        null::text
      from public.legal_entities le
      left join public.clients cl
        on cl.firm_id = le.firm_id and cl.id = le.client_id
      where le.legal_name ilike v_sub escape '\'
      order by case when le.legal_name ilike v_pre escape '\' then 0 else 1 end, le.id
      limit 5
    ) he
    union all
    -- --- registration (R7: full value matches; only type + last four return)
    select * from (
      select
        'registration'::text,
        r.id,
        (r.type || ' ····' ||
          case when char_length(r.value) > 4 then right(r.value, 4) else '••••' end),
        nullif(concat_ws(' · ', le.legal_name, cl.name), ''),
        case when cl.id is not null then '/clients/' || cl.id::text end,
        case when r.value = v_q then 'exact' else 'prefix' end,
        null::text
      from public.registrations r
      left join public.legal_entities le
        on le.firm_id = r.firm_id and le.id = r.legal_entity_id
      left join public.clients cl
        on cl.firm_id = le.firm_id and cl.id = le.client_id
      where r.value = v_q or r.value like v_pre escape '\'
      order by case when r.value = v_q then 0 else 1 end, r.id
      limit 5
    ) hr
    union all
    -- --- task (R11-A: non-navigable — /my-work is caller-owned work, not a
    --     general task-detail destination)
    select * from (
      select
        'task'::text,
        t.id,
        t.title,
        nullif(concat_ws(' · ', t.status, cl.name), ''),
        null::text,
        case when t.title ilike v_pre escape '\' then 'prefix' else 'substring' end,
        null::text
      from public.tasks t
      left join public.clients cl
        on cl.firm_id = t.firm_id and cl.id = t.client_id
      where t.title ilike v_sub escape '\'
      order by case when t.title ilike v_pre escape '\' then 0 else 1 end, t.id
      limit 5
    ) ht
    union all
    -- --- compliance_instance (M1-A: LEFT JOIN compliance_types under caller
    --     RLS — the instance survives on period_label when the type row is
    --     invisible; a hidden type name never matches and never labels)
    select * from (
      select
        'compliance_instance'::text,
        ci.id,
        case
          when ct.name is not null then ct.name || ' — ' || ci.period_label
          else ci.period_label
        end,
        ci.state,
        null::text,
        case
          when ci.period_label ilike v_pre escape '\' or ct.name ilike v_pre escape '\'
            then 'prefix'
          else 'substring'
        end,
        null::text
      from public.compliance_instances ci
      left join public.compliance_types ct
        on ct.id = ci.compliance_type_id
      where ci.period_label ilike v_sub escape '\'
         or ct.name ilike v_sub escape '\'
      order by
        case
          when ci.period_label ilike v_pre escape '\' or ct.name ilike v_pre escape '\'
            then 0
          else 1
        end,
        ci.id
      limit 5
    ) hi
    union all
    -- --- staff (R6: pinned through ACTIVE firm_memberships of the SELECTED
    --     active firm; the profile join decorates only — an invisible profile
    --     can never create a hit, and a visible profile without an ACTIVE
    --     selected-firm membership cannot either)
    select * from (
      select
        'staff'::text,
        m.id,
        p.full_name,
        ('Team · ' || m.role),
        null::text,
        case when p.full_name ilike v_pre escape '\' then 'prefix' else 'substring' end,
        null::text
      from public.firm_memberships m
      join public.profiles p
        on p.id = m.user_id
      where m.firm_id = public.req_active_firm()
        and m.status = 'active'
        and p.full_name ilike v_sub escape '\'
      order by case when p.full_name ilike v_pre escape '\' then 0 else 1 end, m.id
      limit 5
    ) hs
  )
  select r.kind, r.id, r.label, r.sub, r.href, r.match_class, r.status
  from ranked r
  order by
    case r.match_class when 'exact' then 0 when 'prefix' then 1 else 2 end,
    case r.kind
      when 'client' then 0
      when 'legal_entity' then 1
      when 'registration' then 2
      when 'task' then 3
      when 'compliance_instance' then 4
      else 5
    end,
    r.id
  limit 20;
end;
$$;

comment on function public.structured_search(text) is
  'IMP-061 API-R0-SRC structured global search (IMP061-R1…R11, M1-A): six domains under ordinary caller RLS; SECURITY INVOKER; server-side min length 2, caps 5/kind + 20 global, deterministic ordering, literal escaped matching, masked registration identifiers (type + last four), truthful offboarded status, ACTIVE-membership staff pin, optional truthful navigation (R11-A). Reads only — the raw query is never persisted (R9).';

-- Grants: browser search is an authenticated capability only. Revoke the
-- default PUBLIC execute first, then grant the minimum (the
-- active_membership_role/list_client_identities precedent).
revoke all on function public.structured_search(text) from public, anon, authenticated, service_role;
grant execute on function public.structured_search(text) to authenticated;
