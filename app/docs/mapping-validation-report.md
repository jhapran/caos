# Fixture → Production Mapping Validation Report

> GENERATED FILE — do not hand-edit. Regenerate from the `app/` directory with:
>
> `node scripts/validation/mapping-validation.mjs --write-report`
>
> Drift between this file and the generator is caught by the Harness Gate via
> `node scripts/validation/mapping-validation.mjs --check-report`.

- **Package:** IMP-070 — Fixture demo preservation & adapter completion.
- **Governing IDs:** IMP-070, TEST-MIG-01…15, MIG-ACC-03, MIG-VAL-03, API-INV-01, spec-10 mapping table.
- **Sources:** `docs/spec/07-api-contract.md` (API-INV-01 export classification); `docs/spec/10-migration-seed.md` (fixture → production mapping table, MIG-SEED/MIG-VAL/MIG-ACC); `docs/spec/11-testing-harness.md` (TEST-MIG-01…15).
- **Status:** non-normative document. The normative sources are the spec documents above; this report is the rendered, continuously re-validated encoding of them.

## 1. Classification summary

Total barrel-reachable exports enumerated from `src/data/index.ts`: **258**.

API-INV-01 classes:

| API-INV-01 class | Count |
| --- | --- |
| KEEP | 175 |
| EVOLVE | 20 |
| REPLACE | 6 |
| DEMO-ONLY | 57 |

Spec-10 mapping classes:

| Spec-10 mapping class | Count |
| --- | --- |
| DIRECT_SYNTHETIC | 1 |
| TRANSFORM | 5 |
| REFERENCE_SEED | 1 |
| DEMO_ONLY | 3 |
| FIXTURE_ONLY_PRESENTATION | 5 |
| NOT_DATA | 243 |

## 2. Full barrel-export classification

Every export reachable from the barrel, classified. The production dual-mode contract surface (services, boundary helpers, domain DTO types, error/context/source exports, tenancy/auth) is `KEEP` / `NOT_DATA` and is not part of the fixture-era API-INV-01 surface.

### 2a. Fixture-era surface (83 exports)

| Export | Kind | API-INV-01 class | Spec-10 mapping class | Note |
| --- | --- | --- | --- | --- |
| `ACTIVE_ALERT_COUNT` | value | DEMO-ONLY | FIXTURE_ONLY_PRESENTATION | replaced by server-derived aggregates (DM-X-03, API-R0-DASH) |
| `AGGREGATES` | value | DEMO-ONLY | FIXTURE_ONLY_PRESENTATION | replaced by server-derived aggregates (DM-X-03, API-R0-DASH) |
| `ALERTS` | value | DEMO-ONLY | TRANSFORM | alerts + alert_rules templates; alert-rule template seeding SUPERSEDED by the D3 ruling — R0 ships ZERO alert-rule seeds and zero default thresholds; AUTO-OQ-04 OPEN |
| `ASK_FIXTURES` | value | DEMO-ONLY | DEMO_ONLY | none — Ask CAOS is demo-only in R0; real AI deferred (DEC-C) |
| `AlertSeverity` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `AskAnswer` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `AskChip` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `AskTable` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `CLIENTS` | value | DEMO-ONLY | TRANSFORM | clients + one default legal_entities row each; ownerId → owner_partner_membership_id (SCH-RESP-01); CLIENTS[].gstin/pan/cin → registrations rows (TRANSFORM, separate spec-10 row) |
| `COMPLIANCE_MASTER` | value | DEMO-ONLY | REFERENCE_SEED | compliance_types system defaults + initial compliance_rule_versions; seeded but not production-activated until external CA/domain sign-off — seeded statutory versions carry domain_approval_status=pending (SCH-32) |
| `Client` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `ClientTag` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `ComplianceId` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `ComplianceType` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `DEMO_TODAY` | value | DEMO-ONLY | DEMO_ONLY | none — pinned demo date (MIG-DS-04, TEN-22); production uses server time (API-CONV-04) |
| `DEPENDENCY_CLIENTS` | value | DEMO-ONLY | DEMO_ONLY | none (derived) — production dependency board is derived from instances/tasks (AUTO-DLN-01); fixture stays in the demo adapter |
| `DEPENDENCY_TOTALS` | value | DEMO-ONLY | FIXTURE_ONLY_PRESENTATION | replaced by server-derived aggregates (DM-X-03, API-R0-DASH) |
| `DeadlineClientRow` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `DeadlineGroup` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `DemoStoreProvider` | value | DEMO-ONLY | NOT_DATA | fixture demo overlay store — demo mode only |
| `DependencyClient` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `EntityType` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `FALLBACK_ANSWER` | value | DEMO-ONLY | NOT_DATA | Ask CAOS fixture internal |
| `FIRM` | value | DEMO-ONLY | DIRECT_SYNTHETIC | firms row; string id → uuid; team splits into profiles + memberships |
| `Firm` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `FirmAggregates` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `FirmAlert` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `Industry` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `REVIEW_COUNTS` | value | DEMO-ONLY | FIXTURE_ONLY_PRESENTATION | replaced by server-derived aggregates (DM-X-03, API-R0-DASH) |
| `REVIEW_ITEMS` | value | DEMO-ONLY | TRANSFORM | review_items; display type strings → frozen R0 category keys (API-OQ-01; SCH-17 CHECK); comments → immutable task_comments (SCH-16) |
| `Reminder` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `ReviewItem` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `ReviewStatus` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `ReviewType` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `RiskFactor` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `SUGGESTED_QUESTIONS` | value | DEMO-ONLY | NOT_DATA | Ask CAOS fixture internal |
| `SearchHit` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `TASKS` | value | DEMO-ONLY | TRANSFORM | compliance_instances + tasks; generation_source 'import'/'manual', never claimed recurrence-generated (SCH-12); nextAction → tasks.next_action |
| `TEAM` | value | DEMO-ONLY | TRANSFORM | profiles + firm_memberships; one auth user + profile + membership per person; roles mapped to the SCH-03 role vocabulary |
| `TOTAL_ACTIVE` | value | DEMO-ONLY | FIXTURE_ONLY_PRESENTATION | replaced by server-derived aggregates (DM-X-03, API-R0-DASH) |
| `TaskCategory` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `TaskInstance` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `TeamMember` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `Toast` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `WORKFLOW_STATES` | value | REPLACE | NOT_DATA | production workflow vocabulary derives from the approved domain state machines (DM-SM-01…06); the fixture constant must not become the authoritative production definition |
| `WorkflowEvent` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `WorkflowState` | type | DEMO-ONLY | NOT_DATA | fixture-era domain type; production domain model is docs/spec/02 |
| `askCaos` | value | DEMO-ONLY | NOT_DATA | no R0 production counterpart; real AI deferred (DEC-C) |
| `complianceName` | value | DEMO-ONLY | NOT_DATA | fixture computation helper — logic re-implemented server-side from due_rule data |
| `daysUntil` | value | DEMO-ONLY | NOT_DATA | fixture computation helper — logic re-implemented server-side from due_rule data |
| `dueDateFor` | value | DEMO-ONLY | NOT_DATA | fixture computation helper — logic re-implemented server-side from due_rule data |
| `fetchAggregates` | value | REPLACE | NOT_DATA | live counters via the API-R0-DASH B-count read model (API-OQ-03 resolved); fixture AGGREGATES has no production counterpart (DM-X-03) |
| `fetchAlerts` | value | EVOLVE | NOT_DATA | alerts read (RLS-ALR-01); realtime per API-RT-01 |
| `fetchClient` | value | EVOLVE | NOT_DATA | Client 360 composite read (DM-X-02): one contract, several underlying reads |
| `fetchClients` | value | EVOLVE | NOT_DATA | clients read under RLS-CLI-01; paginated; offboarded excluded by default (DM-04) |
| `fetchComplianceTasks` | value | EVOLVE | NOT_DATA | instances + tasks for one compliance_type (SCH-12 drill-down index) |
| `fetchDeadline` | value | EVOLVE | NOT_DATA | same read model, single group |
| `fetchDeadlineClients` | value | EVOLVE | NOT_DATA | instance rows for the group with client/entity/assignee projection |
| `fetchDeadlines` | value | EVOLVE | NOT_DATA | server-derived board over compliance_instances (SCH-12); grouping computed server-side |
| `fetchDependencyClients` | value | REPLACE | NOT_DATA | server-derived waiting-on-client read model (API-R0-DLN); not a stored fixture |
| `fetchReviewItems` | value | EVOLVE | NOT_DATA | review_items read (RLS-RVW-01); queue view per role; realtime per API-RT-01 |
| `fetchTask` | value | EVOLVE | NOT_DATA | task + checklist + comments + dependencies read (SCH-13…16) |
| `fetchTasks` | value | EVOLVE | NOT_DATA | tasks read (RLS-TSK-01) with declared filters; paginated |
| `getAggregates` | value | REPLACE | NOT_DATA | live counters via the API-R0-DASH B-count read model (API-OQ-03 resolved); fixture AGGREGATES has no production counterpart (DM-X-03) |
| `getClient` | value | DEMO-ONLY | NOT_DATA | fixture lookup helper — fixture adapter internal |
| `getClients` | value | EVOLVE | NOT_DATA | sync twin of fetchClients; same evolved production read |
| `getCompliance` | value | DEMO-ONLY | NOT_DATA | fixture computation helper — logic re-implemented server-side from due_rule data |
| `getComplianceMaster` | value | EVOLVE | NOT_DATA | merged view: system defaults + firm overrides shadowing per TEN-07 (RLS-CTY-01) |
| `getDeadlineClients` | value | EVOLVE | NOT_DATA | sync twin of fetchDeadlineClients; same evolved production read |
| `getDeadlineGroup` | value | EVOLVE | NOT_DATA | sync twin of fetchDeadline; same evolved production read |
| `getDeadlineGroups` | value | EVOLVE | NOT_DATA | sync twin of fetchDeadlines; same evolved production read |
| `getFirm` | value | EVOLVE | NOT_DATA | firms read (RLS-FRM-01); settings write is an admin RPC (RLS-AAL-01) |
| `getTask` | value | DEMO-ONLY | NOT_DATA | sync fixture-era helper; production callers use the evolved fetchTask contract — must not become a production backend API merely because it exists |
| `getTasks` | value | EVOLVE | NOT_DATA | sync twin of fetchTasks; same evolved production read |
| `getTasksForClient` | value | EVOLVE | NOT_DATA | tasks read filtered by client (RLS-TSK-01) |
| `getTasksForCompliance` | value | EVOLVE | NOT_DATA | sync twin of fetchComplianceTasks; same evolved production read |
| `getTeam` | value | EVOLVE | NOT_DATA | firm_memberships ⋈ profiles read (RLS-MEM-01/RLS-PRF-01) |
| `matchAskQuery` | value | DEMO-ONLY | NOT_DATA | Ask CAOS fixture internal |
| `ownerOf` | value | DEMO-ONLY | NOT_DATA | fixture lookup helper — fixture adapter internal |
| `searchAll` | value | REPLACE | NOT_DATA | structured global search (API-R0-SRC — exactly six domains) via one SECURITY INVOKER function under caller RLS; page shortcuts stay client-side |
| `useDemoStore` | value | DEMO-ONLY | NOT_DATA | fixture demo overlay store — demo mode only |
| `useLiveAggregates` | value | REPLACE | NOT_DATA | live counters via the API-R0-DASH B-count read model (API-OQ-03 resolved); fixture AGGREGATES has no production counterpart (DM-X-03) |
| `withLatency` | value | DEMO-ONLY | NOT_DATA | fixture-adapter internal; absent from the Supabase adapter |

### 2b. Production dual-mode contract surface (175 exports)

| Export | Kind | API-INV-01 class | Spec-10 mapping class | Note |
| --- | --- | --- | --- | --- |
| `Aal` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ActivateRuleVersionResult` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `AddTaskDependencyInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `AddTaskDependencyResult` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `AlertListFilter` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `AlertRecord` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `AlertResolutionType` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `AlertRuleRecord` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `AlertSeverityKey` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `AlertStatus` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `AlertTransitionResult` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `AlertsService` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ApiError` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ApiErrorKind` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `Assurance` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `AuthContextValue` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `AuthProvider` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `AuthResult` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `AuthService` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `AuthSnapshot` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `AuthStatus` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `AuthUser` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `Client360Engagement` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `Client360Relationship` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `Client360Service` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `Client360View` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ClientDependencyKind` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ClientDependencyRecord` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ClientHierarchyService` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ClientIdentity` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ClientListFilter` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ClientRecord` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ClientRelationshipRecord` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ClientRiskRating` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ClientStatus` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ComplianceFrequency` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ComplianceInstanceRecord` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ComplianceInstanceState` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ComplianceInstancesService` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `CompliancePayload` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ComplianceProfileRecord` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ComplianceProfileStatus` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ComplianceRuleVersionRecord` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ComplianceRulesService` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ComplianceScopeKind` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ComplianceTypeListFilter` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ComplianceTypeRecord` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ComplianceTypeStatus` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ConfigurationError` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ContactRecord` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ContactStatus` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `CreateAlertRuleInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `CreateClientInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `CreateClientRelationshipInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `CreateComplianceTypeInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `CreateContactInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `CreateEngagementInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `CreateInstanceInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `CreateLegalEntityInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `CreateProfileInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `CreateRegistrationInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `CreateRuleVersionInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `CreateTaskInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `DASHBOARD_INSTANCE_STATES` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `DASHBOARD_TASK_STATES` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `DEADLINE_GROUP_ID_SEPARATOR` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `DashboardAggregates` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `DashboardService` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `DataSource` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `DeadlineGroupRecord` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `DeadlineInstanceRecord` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `DeadlinesService` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `DecideReviewItemInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `DecideReviewItemResult` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `DomainApprovalStatus` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `EngagementLetterStatus` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `EngagementListFilter` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `EngagementRecord` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `EngagementService` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `EngagementStatus` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `FirmMembershipView` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `GenerationSource` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `GovernanceClass` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `InstanceListFilter` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `LegalEntityRecord` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `LegalEntityStatus` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `LegalEntityType` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `LetterStatus` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `MembershipRole` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `MembershipStatus` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `MfaEnrollResult` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `MyWorkBuckets` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `MyWorkItem` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `MyWorkItemKind` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `MyWorkService` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `OPEN_INSTANCE_STATES` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ProfileListFilter` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ProfileView` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `RegistrationRecord` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `RegistrationStatus` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `RegistrationType` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `RelationType` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `RelationshipStatus` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `RemoveTaskDependencyResult` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ReviewDecision` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ReviewItemRecord` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ReviewItemSource` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ReviewItemStatus` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ReviewItemType` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ReviewQueueFilter` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `ReviewService` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `RulePayload` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `RuleVersionListFilter` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `RuleVersionStatus` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `STANDALONE_RETURNED_NEXT_ACTION` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `STRUCTURED_SEARCH_MIN_QUERY_LENGTH` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `SearchMatchClass` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `SearchService` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `StaffRef` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `StructuredSearchHit` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `StructuredSearchKind` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `SubmitReviewItemInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `TaskChecklistItemRecord` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `TaskCommentRecord` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `TaskDependencyRecord` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `TaskDetail` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `TaskListFilter` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `TaskRecord` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `TaskService` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `TaskStatus` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `TenancyService` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `TransitionInstanceInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `TransitionInstanceResult` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `TransitionTaskInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `TransitionTaskResult` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `UpdateAlertRuleInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `UpdateClientInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `UpdateClientRelationshipInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `UpdateComplianceTypeInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `UpdateContactInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `UpdateEngagementInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `UpdateInstanceInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `UpdateLegalEntityInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `UpdateProfileInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `UpdateRegistrationInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `UpdateRuleVersionDraftInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `UpdateTaskInput` | type | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `alertsService` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `authService` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `buildMyWorkBuckets` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `clearActiveFirm` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `client360Service` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `clientHierarchyService` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `complianceInstancesService` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `complianceRulesService` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `dashboardService` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `deadlinesService` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `emptyDashboardAggregates` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `engagementService` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `getActiveFirm` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `getDataSource` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `isoWeekEndDate` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `kolkataBusinessDate` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `makeDeadlineGroupId` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `myworkService` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `parseDeadlineGroupId` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `resolveDefaultActiveFirm` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `reviewService` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `searchService` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `setActiveFirm` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `taskService` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `tenancyService` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `toApiError` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `useAuth` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |
| `validateStartupConfig` | value | KEEP | NOT_DATA | production dual-mode contract (IMP-011…062); not part of the fixture-era API-INV-01 surface |

## 3. Demo-store overlay actions (not barrel exports)

The `DemoStoreProvider` overlay actions are returned by `useDemoStore()` and are therefore not named barrel exports; their API-INV-01 classes are recorded here for completeness:

| Store action | API-INV-01 class | Note |
| --- | --- | --- |
| `approveReviewItem` | EVOLVE | decide_review_item RPC with p_decision='approved' (API-R0-RVW); self-decision prohibited (RLS-4EY-04); audited |
| `returnReviewItem` | EVOLVE | decide_review_item RPC with p_decision='returned' + mandatory rationale; atomic linked-task returned + one immutable SCH-16 comment (DM-SM-06) |
| `acknowledgeAlert` | EVOLVE | alert status RPC (RLS-ALR-01; manager+); audited |
| `resolveAlert` | EVOLVE | alert resolve RPC with resolution_type='manual' (DM-OQ-05); audited |
| `sendReminder` | DEMO-ONLY | DEMO-ONLY in R0 |
| `notify` | KEEP | pure UI toast concern; unchanged |
| `dismissToast` | KEEP | pure UI toast concern; unchanged |
| `resetDemo` | DEMO-ONLY | demo-mode control only; never present in Supabase mode |

store overlays (reviewOverlay, alertOverlay, reminder merge) are REPLACE as a concept — server state replaces overlays; the fixture adapter keeps them for demo mode. They are not named barrel exports.

## 4. Fixture → production mapping table (spec 10)

The mapping table below is the executable encoding of the fixture → production entity mapping in `docs/spec/10-migration-seed.md`; the validator asserts each fixture source exists in the barrel enumeration with the exact mapping class shown.

| Fixture source | Production target | Mapping class | Notes |
| --- | --- | --- | --- |
| `FIRM` | firms row | DIRECT_SYNTHETIC | String id → uuid; team splits into profiles + memberships |
| `TEAM` | profiles + firm_memberships | TRANSFORM | One auth user + profile + membership per person; roles mapped to the SCH-03 role vocabulary; fixture "owner" ids become membership ids |
| `CLIENTS` | clients + one default legal_entities row each | TRANSFORM | ownerId → owner_partner_membership_id (SCH-RESP-01); entityType → legal_entities.entity_type; tags, risk_rating map directly; offboarded semantics per DM-04 |
| `CLIENTS[].gstin/pan/cin` | registrations rows | TRANSFORM | Identifier fields become typed registration rows (type ∈ GSTIN/PAN/CIN, SCH-07); multi-state GSTINs would need multiple rows — fixture holds at most one |
| `COMPLIANCE_MASTER` | compliance_types system defaults (NULL firm_id) + initial compliance_rule_versions | REFERENCE_SEED | dueRule text → structured due_rule jsonb on the initial version (SCH-32); scope_kind/registration_class per the DM-27 matrix; seeded but not production-activated until external CA/domain sign-off — seeded statutory versions carry domain_approval_status='pending' (DM-OQ-01; SCH-32) |
| `TASKS` | compliance_instances + tasks | TRANSFORM | Generator logic is discarded; fixture rows map to instances (structured periods; generation_source='import' or 'manual' — never claimed as recurrence-generated, SCH-12) and their linked tasks; nextAction → tasks.next_action; fixture string periods → period_start/period_end/period_label (SCH-12) |
| `REVIEW_ITEMS` | review_items | TRANSFORM | Display type strings → the frozen R0 category keys (API-OQ-01: gst_reconciliation, tds_return, itr_computation, financial_statements, audit_workpaper; SCH-17 CHECK); submitter names → memberships; comments → immutable task_comments (SCH-16); decision facts live on review_items, mutation history in audit_log |
| `ALERTS` | alerts + alert_rules templates | TRANSFORM | Each alert implies a rule; statuses map to the DM-22 lifecycle. Alert-rule template seeding is SUPERSEDED by the D3 ruling (recorded in SCH-19; reaffirmed by human ruling HRR-07=A): R0 ships ZERO alert-rule seed rows and zero default thresholds — schema capability (SCH-19) is not approved seed content; AUTO-OQ-04 remains OPEN |
| `DEPENDENCY_CLIENTS` | none (derived) | DEMO_ONLY | Production dependency board is derived from instances/tasks (AUTO-DLN-01); fixture stays in the demo adapter |
| `ASK_FIXTURES` | none | DEMO_ONLY | Ask CAOS is demo-only in R0; real AI deferred (DEC-C) |
| `AGGREGATES`, `REVIEW_COUNTS`, `ACTIVE_ALERT_COUNT`, `DEPENDENCY_TOTALS`, `TOTAL_ACTIVE` | none | FIXTURE_ONLY_PRESENTATION | Replaced by server-derived aggregates (DM-X-03, API-R0-DASH) |
| `DEMO_TODAY` | none (pinned demo date) | DEMO_ONLY | Pinned per MIG-DS-04; production uses server time (API-CONV-04) |

## 5. Fixture-only presentation data

These five constants are pre-computed fixture counters with no production counterpart. They are replaced by server-derived aggregates (DM-X-03, API-R0-DASH) and must never become a production data source:

| Constant | Fixture role |
| --- | --- |
| `AGGREGATES` | replaced by server-derived aggregates (DM-X-03, API-R0-DASH) |
| `REVIEW_COUNTS` | replaced by server-derived aggregates (DM-X-03, API-R0-DASH) |
| `ACTIVE_ALERT_COUNT` | replaced by server-derived aggregates (DM-X-03, API-R0-DASH) |
| `DEPENDENCY_TOTALS` | replaced by server-derived aggregates (DM-X-03, API-R0-DASH) |
| `TOTAL_ACTIVE` | replaced by server-derived aggregates (DM-X-03, API-R0-DASH) |

## 6. Demo-only sources

- `DEPENDENCY_CLIENTS` — the production client-dependency board is derived from instances/tasks (AUTO-DLN-01); the fixture stays in the demo adapter.
- `ASK_FIXTURES` — Ask CAOS is demo-only in R0; the canned assistant (`askCaos`, `matchAskQuery`, `SUGGESTED_QUESTIONS`, `FALLBACK_ANSWER`) has no R0 production counterpart (real AI deferred, DEC-C).
- `DEMO_TODAY` — the pinned demo date (MIG-DS-04, TEN-22); production uses server time (API-CONV-04).
- The demo store (`DemoStoreProvider` / `useDemoStore`) is demo-mode only; its overlay actions are classified in section 3.

## 7. TEST-MIG-01…15 disposition matrix

Categories: A = executed in IMP-070 (new local evidence); B = existing evidence reused/re-verified; C = conditional, not invoked; D = deferred to IMP-071; E = Phase-E/later verification.

| ID | Title | Category | Disposition / evidence | Owner |
| --- | --- | --- | --- | --- |
| TEST-MIG-01 | Phase A clean-chain reproducibility | B | Harness Gate db-reset-seed phase re-applies the migration chain every run; IMP-010 byte-identical schema acceptance evidence cited | IMP-003/IMP-010 evidence, IMP-070 records |
| TEST-MIG-02 | Adapter contract parity (MIG-VAL-03) | A | new tests/integration/migration/adapter-parity.test.ts — same @/data contract calls against fixture AND supabase adapters for all 12 domain services, DTO shape equality | IMP-070, wired into gate |
| TEST-MIG-03 | Phase C seed invariant checks (MIG-VAL-01) | B | compliance/seed integration suites green at head; named invariant suite (TEST-MIG-12) covers row-level checks | IMP-031-family evidence, IMP-070 records |
| TEST-MIG-04 | Read-model vs base-table consistency spot checks | A | new tests/integration/migration/read-model-consistency.test.ts — dashboard/deadline/search read models vs base-table derivations on seeded data | IMP-070, wired into gate |
| TEST-MIG-05 | Phase E production smoke suite | E | production not provisioned (DEC-P gated); zero IMP-070 execution claimed | IMP-071/IMP-072 (Phase E) |
| TEST-MIG-06 | Fixture mode intact while Supabase mode exists (MIG-PRIN-02) | B | tests/unit/fixture-no-network.test.ts + e2e/smoke.spec.ts fixture project green at head | IMP-014 evidence, IMP-070 re-verifies |
| TEST-MIG-07 | Supabase mode with no fixture modules loaded (MIG-DS-06a) | B (import-level) + E (bundle-level leg) | tests/unit/import-boundary.test.ts green incl. LOW-3 non-vacuity guards; bundle-level fixture exclusion remains Phase-E/MIG-VFY-E owned | IMP-014 evidence + Phase E |
| TEST-MIG-08 | Fail-closed startup matrix; no runtime fallback (MIG-DS-03/05/06c) | B | tests/unit/data-source.test.ts green at head; no new fallback path introduced by IMP-070 tooling | IMP-014 evidence, IMP-070 re-verifies |
| TEST-MIG-09 | Fixture records cannot enter a supabase DB via seeds (MIG-SEED-06) | A | new tests/integration/migration/seed-labelling.test.ts — executable refusal proof for non-local invocation; seed.sql environment label verified; no seed tooling references fixture modules | IMP-070, wired into gate |
| TEST-MIG-10 | Deterministic dev seeds, stable ids (MIG-OQ-02) | B | tests/harness/registry.json fixed-UUID registry + seed-harness idempotency + gate db-reset-seed phase green at head; MIG-OQ-02 de-facto resolved at IMP-003 | IMP-003 evidence, IMP-070 re-verifies |
| TEST-MIG-11 | Migration ordering clean from scratch + incremental (local→staging rehearsal) | B (local leg) + D (staging rehearsal leg) | local from-scratch leg proven every gate run; staging rehearsal is IMP-071-owned | IMP-071 owns staging leg |
| TEST-MIG-12 | Data-integrity suites at every phase gate (MIG-VAL-01) | A (local) | new tests/integration/migration/mig-val-01-invariants.test.ts — catalog invariants (24 tables, RLS 24/24, FORCE 20, policies 51), seed row counts, orphan scan, uniqueness, CHECK vocabulary conformance, generation provenance, audit presence | IMP-070 local; staging re-run IMP-071 |
| TEST-MIG-13 | Pilot-data backfill path if invoked (MIG-PD-01) | C | trigger condition (pilot/customer data introduced before cutover) has NOT occurred; no synthetic PASS; MIG-PD-01 text untouched | if ever triggered: mandatory documented path before Phase E (IMP-071/072) |
| TEST-MIG-14 | Rollback/recovery rehearsals per phase | D | rollback conditions documented in spec 10; staging rehearsal/disposable-rebuild drill is IMP-071 scope | IMP-071 |
| TEST-MIG-15 | Seeded statutory rule versions pending, cannot activate (MIG-SEED-02, SCH-32) | A (local) | new tests/integration/migration/statutory-pending.test.ts — every seeded statutory version draft+pending, zero active statutory, activation path rejects without domain sign-off | IMP-070 local; staging re-run IMP-071 |

Matrix completeness: 15/15 present; category totals A=5 (02, 04, 09, 12, 15), B=6 (01, 03, 06, 07, 08, 10), C=1 (13), D=2 (11, 14), E=1 (05); overlaps: 07 carries an E leg (bundle-level), 11 carries a B local leg, 12/15 staging re-runs are IMP-071 legs. No synthetic PASS terminology for conditional/deferred entries.

## 8. Limitations

1. **Granularity.** Classification is at barrel-export granularity; field-level transformation rules live in `docs/spec/10-migration-seed.md` and are not re-stated here.
2. **Bundle-level fixture exclusion.** Verifying that no fixture module ships in a production bundle is Phase-E/MIG-VFY-E scope; TEST-MIG-07 is covered at import level only here.
3. **Hosted demo checks.** Hosted demo read-only GET checks are evidence-gathering outside the gate.
4. **Vocabulary.** The MIG-ACC-03 'unsupported' vocabulary differs from the spec-10 mapping-table vocabulary; this is noted deliberately — zero exports are classified 'unsupported' and the validator fails closed if any ever are.
