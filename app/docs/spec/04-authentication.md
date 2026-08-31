# 04 — Authentication

- **Status:** Approved (Batch 2)
- **Approval status:** Approved (Batch 2). Open/provisional items remain governed by their recorded future gates — AUTH-OQ-02 exact platform session-configuration values are verified during implementation (not assumed; recorded in `13`, tested via `11` TEST-AUTH-*); the session figures in AUTH-08 are approved targets, not claimed platform behaviour.

## Purpose

Defines **authentication only** — "who are you?" — for staff and (as
architecture) client portal users, per DEC-I and DEC-Q. Authorization — "what
are you allowed to do?" — is explicitly out of scope and owned by
`05-authorization-rls.md` (Batch 3). This document ends at identity issuance,
session lifecycle, and MFA; it grants no permissions.

## Scope

- The unified identity model: one authenticated identity, independent staff
  and client relationship families.
- Staff authentication on Supabase Auth: invitation/sign-up, login, logout,
  password reset, magic link, TOTP MFA enrolment/challenge, session policy,
  disabled/suspended users, membership removal, MFA device-loss recovery.
- Client portal authentication architecture (email OTP) — **design only**;
  the portal is not built in Release 0 (DEC-K).
- The MFA policy (approved target).

## Non-goals

- No authorization, roles-to-permissions mapping, or RLS (owned by `05`).
- No SSO/SCIM (enterprise phase, DEC-I).
- No portal implementation (Release 2; spec `21-portal.md` later).
- No credential values, project URLs, or secrets of any kind.

## Boundary statement (AUTH-00)

Authentication establishes identity and assurance level (AAL); it never
encodes permissions. Everything this spec produces — a verified user id, an
authenticated session, an MFA assurance level — is *input* to the
authorization layer specified in `05-authorization-rls.md`. No table, route,
or feature may treat "logged in" as "allowed".

## Requirements

### Unified identity model

- **AUTH-01:** One `auth.users` identity per person. The target model is:

```
auth.users
    ├── zero or more FirmMembership records        (staff relationships)
    └── zero or more ClientPortalUser / client-access mappings
                                                   (client relationships)
```

  A single authenticated person may be staff of Firm A, a client contact of
  Firm B, both, or neither (DM-X-05). **A client portal access mapping must
  not create a FirmMembership; holding a client mapping must not prohibit a
  FirmMembership elsewhere; duplicate auth identities must never be created
  because a person holds both staff and client relationships.** RLS evaluates
  the applicable relationship and active context (specified in `05`).

### Staff authentication

- **AUTH-02:** Staff sign-in methods at launch: **email/password** and
  **magic link** (passwordless email). Both may be enabled; a firm cannot
  disable both.
- **AUTH-03 — Invitation/sign-up:** Staff relationships are created by
  invitation only. A firm admin (role check is authorization, `05`) invites an
  email; the system creates (or reuses, if the person already has an identity)
  the auth identity plus a FirmMembership in `invited` state (DM-03). The
  invitee sets a password (or uses magic link) on first use; accepting the
  invitation transitions the membership to `active`. Self-service public
  sign-up does not exist — no open registration surface.
- **AUTH-04 — Login:** Email + password, or magic link email → one-time
  link → session. Failed-attempt handling uses Supabase Auth defaults;
  lockout/rate-limit configuration is recorded in
  `13-operations-observability.md` if stricter limits are configured.
- **AUTH-05 — Logout:** Revokes the current session (refresh token). "Log out
  everywhere" revokes all of the user's refresh tokens.
- **AUTH-06 — Password reset:** Email-based reset flow via Supabase Auth;
  reset links are single-use and time-limited. After reset, existing sessions
  are revoked (force re-login).
- **AUTH-07 — Magic link:** Single-use, time-limited email link producing a
  full session. Magic-link sessions carry the same assurance as password
  sessions for the purposes of this spec.
- **AUTH-08 — Session policy (explicit working targets, replacing silent
  provider defaults):**
  - access token lifetime: approximately **1 hour** (short-lived);
  - **rotating refresh tokens**;
  - **inactivity timeout target: 12 hours**;
  - **absolute session lifetime target: 7 days**;
  - logout revokes the relevant session (AUTH-05);
  - disabled/suspended/removed users lose access **promptly** — revocation is
    triggered at the state change, not left to token expiry (AUTH-13/14/15);
  - actions the security model marks sensitive may require recent MFA / AAL2
    (AUTH-10; which actions is an authorization/audit decision, `05`/`08`).
  - **All exact Supabase capability and configuration values for these
    targets must be verified during implementation** (recorded in `13`);
    this spec claims no unsupported platform behaviour. Where a target cannot
    be met natively, the gap is documented and an enforcement mechanism
    proposed rather than assumed.

### MFA (TOTP)

- **AUTH-09 — Mechanism:** TOTP via Supabase Auth MFA. Enrolment adds a
  verified factor; challenge upgrades the session to AAL2. Sensitive actions
  (specified in `05`/`08`) may require AAL2 even within an active session.
- **AUTH-10 — MFA policy (approved target):** **Mandatory TOTP MFA for ALL
  staff accounts:**

| Role (DM-03) | MFA requirement |
|---|---|
| Super Admin | **Mandatory** |
| Partner | **Mandatory** |
| Manager | **Mandatory** |
| Senior | **Mandatory** |
| Article/Executive | **Mandatory** |
| Billing | **Mandatory** |
| External Consultant | **Mandatory** when the role is introduced (deferred role) |
| Client User (portal) | Optional / firm-policy-controlled initially (PRD §58) |

  Rationale: a production CA-firm application handling sensitive financial
  and compliance data (PRD §66). This is the approved target unless a later
  commercial or usability decision explicitly changes it. Enforcement
  mechanics (e.g. enrolment forced at first login; access limited until
  enrolled) are specified with the authz mechanism in `05`.
- **AUTH-11 — MFA device-loss recovery:** No insecure MFA bypass. Recovery is
  **admin-assisted**: an administrator with appropriate authorization
  initiates recovery; **identity verification of the requester is required**
  out-of-band; the recovery action is **audit-logged** (actor, target, time,
  verification method); the **existing MFA factor is revoked before new
  enrolment** is permitted. Recovery codes may be evaluated later, only if
  they can be implemented securely and are supported by the selected
  authentication design.

### Disabled, suspended, and removed users

- **AUTH-12 — Disabled user:** Disabling (ban at auth level) immediately
  blocks new sessions and revokes existing ones; the profile is retained for
  audit referential integrity (DM-02).
- **AUTH-13 — Suspended membership:** Suspension is a *membership* state
  (DM-03), not an auth ban: the user keeps their identity but gains nothing
  from that firm. To meet AUTH-08's promptness target, suspension triggers an
  explicit session/token revocation call rather than waiting for token
  expiry; any residual access window is bounded by the access-token lifetime
  (~1 hour) and must be measured during implementation.
- **AUTH-14 — Membership removal:** Soft removal (DM-03); historical
  attribution (task assignee, audit actor) survives. Sessions are revoked as
  in AUTH-13. If the user holds no remaining active relationships (staff or
  client), login yields an authenticated session with no tenant context and
  an empty workspace.

### Client portal authentication (architecture only — not R0)

- **AUTH-15:** Portal access is granted through a client-access mapping
  linking a Contact (DM-08) to an `auth.users` identity, scoped to exactly
  one client organisation per mapping. Per AUTH-01, this mapping is
  independent of any FirmMembership the same person may hold; portal
  authorization is a separate, narrower policy family in `05` and the active
  context (staff vs client, and which firm/client) is explicit in every
  request.
- **AUTH-16:** Portal sign-in is **email OTP** (6-digit code and/or magic
  link in the same email) per DEC-Q. OTP codes are single-use, short-lived,
  rate-limited. SMS/WhatsApp OTP are later additive options (DEC-Q).
- **AUTH-17:** Portal sessions follow AUTH-08 targets unless a tighter
  portal-specific policy is set; sessions are fully revoked on contact
  deactivation or portal-access removal.
- **AUTH-18:** Complete access logging (PRD §58) applies to portal
  authentication events; login history capture is specified in
  `08-audit-security.md`.

## Assumptions

- AUTH-A-01: Supabase Auth supports the required TOTP MFA, invite, and OTP
  flows natively on the chosen tier; any tier limitation discovered in the
  Batch 3 spike is reported as a new open question.
- AUTH-A-02: Transactional email delivery (invites, OTP, resets) will exist
  via a provider configured at the Supabase project level; provider selection
  is an operations decision (`13`), not made here.
- AUTH-A-03: AUTH-08 session targets are engineering targets pending platform
  verification (per the requirement itself), not claims about Supabase
  behaviour.

## Dependencies

- Upstream: `01-decisions.md` (DEC-I, DEC-K, DEC-Q), `02-domain-model.md`
  (DM-02 Profile, DM-03 FirmMembership, DM-08 Contact, DM-X-05 unified
  identity), `03-tenancy-environments.md` (TEN-17 secrets boundary).
- Downstream: `05-authorization-rls.md` (consumes identity, AAL, and the
  relationship/context model), `08-audit-security.md` (login history, auth
  event and recovery-action logging), `13-operations-observability.md`
  (email provider, rate limits, session-setting verification).

## Open Questions

| ID | Question | Owner spec | Status |
|---|---|---|---|
| AUTH-OQ-01 | Manager MFA? | — | **Resolved:** MFA mandatory for ALL staff roles (AUTH-10), approved target; portal MFA optional/firm-policy |
| AUTH-OQ-02 | Explicit session policy? | — | **Resolved as targets:** AUTH-08 (1 h access, rotating refresh, 12 h inactivity, 7 d absolute); exact Supabase configuration values remain **open for verification during implementation** (recorded in `13`) — not claimed as supported behaviour |
| AUTH-OQ-03 | MFA device-loss recovery? | — | **Resolved:** admin-assisted recovery with identity verification, audit logging, factor revocation before re-enrolment (AUTH-11); recovery codes deferred for later secure evaluation |

**Intentionally unresolved (owned elsewhere):** final JWT-claims vs
membership-lookup authorization mechanism (DEC-J spike, `05`); exact audit
context propagation mechanism (`08`); production-region approval (DEC-P).

## Acceptance Criteria

- AUTH-ACC-01: Every mandated flow (invitation, login, logout, password
  reset, magic link, MFA enrolment, MFA challenge, session refresh, session
  expiry, disabled user, membership removal, client email OTP) has a numbered
  requirement.
- AUTH-ACC-02: The authentication/authorization boundary (AUTH-00) is
  explicit; no permission logic appears in this document.
- AUTH-ACC-03: The unified identity model (AUTH-01) is stated; nothing in the
  document implies staff and client identities are mutually exclusive or
  duplicated.
- AUTH-ACC-04: The MFA matrix covers all staff roles plus portal users;
  mandatory-for-all-staff is the stated approved target.
- AUTH-ACC-05: Session policy is explicit (AUTH-08) and platform capabilities
  are marked for verification rather than assumed.
- AUTH-ACC-06: Portal requirements are marked architecture-only and cannot be
  read as Release 0 scope (DEC-K).
- AUTH-ACC-07: No credentials or secrets appear in the document.

## Consequence of Change

Authentication choices are load-bearing for the authorization spike in `05`
(AAL claims, membership states, context evaluation) and audit design in `08`
(login history, recovery logging). Changing MFA policy or the identity model
post-launch is a security-posture change requiring requester sign-off;
changing flows (invite/login/reset) affects `05`, `08`, and the Release 0
plan's first slice.

## Approval Status

Approved (Batch 2). AUTH-OQ-01 (manager MFA — MFA mandatory for all staff
roles) and AUTH-OQ-03 (MFA device-loss recovery) are resolved as recorded.
Open/provisional items remain governed by their recorded future gates:
AUTH-OQ-02 — the session figures in AUTH-08 (1 h access token, rotating
refresh, 12 h inactivity, 7 d absolute) are approved targets; exact
platform configuration values are verified during implementation (not
assumed; recorded in `13`, tested via `11` TEST-AUTH-*). Authorization
remains owned by `05` (AUTH-00 boundary); nothing in this document defines
authorization policy.
