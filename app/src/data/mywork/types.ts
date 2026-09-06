/**
 * IMP-042 (data-adapter slice) — My Work: domain types (provider-neutral)
 * plus the DEC-L bucketing rules as PURE functions shared by both adapters.
 *
 * My Work (API-R0-MWK, DEC-L) is a personal read model: exactly four
 * buckets — Today, This Week, Waiting, Returned — over the caller's OWN
 * assigned/actionable work (every staff role; billing has none). There is
 * no write surface and no recommendation intelligence (DEC-L).
 *
 * Canonical work identity (DEC-L): an item is either task-backed (kind
 * 'task') or a standalone returned review item (kind 'returned_review',
 * task_id IS NULL). A returned ReviewItem linked to a Task surfaces the
 * TASK as the canonical item — the linked ReviewItem is never additionally
 * surfaced.
 *
 * next_action (DEC-L): a task surfaces its stored tasks.next_action
 * (DM-13, PRD §44); a standalone returned ReviewItem carries exactly
 * STANDALONE_RETURNED_NEXT_ACTION. Reviewer rationale is NEVER next_action.
 *
 * The bucket-assignment, business-date, and sorting rules live in this
 * module as pure functions so the fixture and Supabase adapters apply ONE
 * implementation of DEC-L (single source, unit-testable without a clock or
 * a backend). Adapter responsibilities are only: gather the caller's own
 * eligible work under RLS, canonicalize returned items, and mark each item
 * with the Returned-precedence flag.
 */
import type { DataSource } from '@/data/source';

// --- Vocabulary ------------------------------------------------------------------

/** Canonical work identity: task-backed, or standalone returned review. */
export type MyWorkItemKind = 'task' | 'returned_review';

/** The deterministic contract action for a standalone returned ReviewItem
 *  (DEC-L — exact string; reviewer rationale is never next_action). */
export const STANDALONE_RETURNED_NEXT_ACTION = 'Address reviewer feedback';

// --- Record (read DTO) -------------------------------------------------------------

/** One canonical My Work item (DEC-L). */
export interface MyWorkItem {
  /** Canonical identity: the task id for task-backed items, the review item
   *  id for standalone returned items. */
  id: string;
  kind: MyWorkItemKind;
  title: string;
  clientId: string;
  /** Display reference; null when the client row is not resolvable under
   *  the caller's RLS (never an error — the item is the caller's work). */
  clientName: string | null;
  /** ISO date 'YYYY-MM-DD'; NULL due dates are excluded from the date
   *  buckets but the item may still appear in Waiting or Returned (DEC-L). */
  dueDate: string | null;
  priority: string;
  /** The DM-SM-05 task status for task-backed items; 'returned' for
   *  standalone returned review items (DM-SM-06). */
  status: string;
  /** DEC-L: tasks.next_action for tasks; STANDALONE_RETURNED_NEXT_ACTION
   *  for standalone returned items. Never reviewer rationale. */
  nextAction: string;
  /** DEC-L single-bucket precedence marker: true when the item enters via
   *  the Returned rule (a standalone returned ReviewItem, or a task
   *  canonicalized from a task-linked returned ReviewItem). Returned →
   *  Waiting → Today → This Week. */
  returned: boolean;
  /** The mandatory blocker record for Waiting items (DM-SM-05). */
  waitingReason: string | null;
  /** Source rows: taskId for task-backed items; reviewItemId is the linked
   *  returned ReviewItem that claimed a task (traceability) or the
   *  standalone item itself. */
  taskId: string | null;
  reviewItemId: string | null;
}

/** The four DEC-L buckets. Exactly these four, in this precedence order. */
export interface MyWorkBuckets {
  today: MyWorkItem[];
  thisWeek: MyWorkItem[];
  waiting: MyWorkItem[];
  returned: MyWorkItem[];
}

// --- Business-date rules (DEC-L: Asia/Kolkata) ---------------------------------------

/**
 * The current CAOS business date in Asia/Kolkata (DEC-L business
 * timezone), as 'YYYY-MM-DD'. Implemented via Intl — no timezone library
 * dependency. Fixture/demo mode passes the pinned demo clock (DEMO_TODAY,
 * TEN-22); production passes the real current time.
 */
export function kolkataBusinessDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * The end of the current ISO week (Sunday), INCLUSIVE, as 'YYYY-MM-DD',
 * for a given business date (DEC-L This Week upper bound). ISO weeks run
 * Monday–Sunday; on a Sunday the end is that Sunday itself.
 */
export function isoWeekEndDate(businessDate: string): string {
  const day = new Date(`${businessDate}T00:00:00.000Z`);
  const weekday = day.getUTCDay(); // 0 = Sunday … 6 = Saturday
  const offset = (7 - weekday) % 7; // days remaining through Sunday
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
}

// --- Bucketing + sorting (DEC-L, pure) ------------------------------------------------

/**
 * The existing authoritative task priority order, highest first (DEC-L:
 * "No new priority enum is introduced"). priority is free text in SCH-13
 * (default 'normal'); this ranks the de-facto R0 labels — high(4) >
 * medium(3) > normal(2) > low(1) — and puts unrecognized values below the
 * known labels without rejecting them.
 */
const PRIORITY_RANK: Record<string, number> = {
  high: 4,
  medium: 3,
  normal: 2,
  low: 1,
};

function priorityRank(priority: string): number {
  return PRIORITY_RANK[priority] ?? 0;
}

/** DEC-L sort: due_date ASC NULLS LAST, then priority highest-first, then
 *  a stable ID tie-breaker. Specified for the date buckets; applied to all
 *  four buckets so every bucket has one deterministic order. */
function compareItems(a: MyWorkItem, b: MyWorkItem): number {
  if (a.dueDate === null && b.dueDate === null) return a.id.localeCompare(b.id);
  if (a.dueDate === null) return 1;
  if (b.dueDate === null) return -1;
  const byDate = a.dueDate.localeCompare(b.dueDate);
  if (byDate !== 0) return byDate;
  const byPriority = priorityRank(b.priority) - priorityRank(a.priority);
  if (byPriority !== 0) return byPriority;
  return a.id.localeCompare(b.id);
}

/**
 * DEC-L bucket assignment over the caller's canonical items.
 * Single-bucket precedence — each item appears in exactly one bucket:
 *   Returned → Waiting → Today → This Week.
 *   - Returned: items the adapter marked returned (canonicalization);
 *   - Waiting: DM-SM-05 'waiting' tasks (waitingReason rides along);
 *   - Today: dueDate <= the business date (overdue-inclusive);
 *   - This Week: dueDate > the business date AND <= the end of the current
 *     ISO week, inclusive;
 *   - dueDate IS NULL is excluded from both date buckets;
 *   - anything else (due beyond this ISO week) is not surfaced.
 * `businessDate` is the Asia/Kolkata business date 'YYYY-MM-DD' (see
 * kolkataBusinessDate); string comparison is exact for ISO dates.
 */
export function buildMyWorkBuckets(items: MyWorkItem[], businessDate: string): MyWorkBuckets {
  const weekEnd = isoWeekEndDate(businessDate);
  const buckets: MyWorkBuckets = { today: [], thisWeek: [], waiting: [], returned: [] };
  for (const item of items) {
    if (item.returned) {
      buckets.returned.push(item);
    } else if (item.status === 'waiting') {
      buckets.waiting.push(item);
    } else if (item.dueDate !== null && item.dueDate <= businessDate) {
      buckets.today.push(item);
    } else if (item.dueDate !== null && item.dueDate <= weekEnd) {
      buckets.thisWeek.push(item);
    }
  }
  buckets.today.sort(compareItems);
  buckets.thisWeek.sort(compareItems);
  buckets.waiting.sort(compareItems);
  buckets.returned.sort(compareItems);
  return buckets;
}

/** The empty read result (no session / no live membership / billing role /
 *  no active-firm context — API-ERR-02 collection semantics: an empty
 *  collection, never an error). */
export function emptyMyWorkBuckets(): MyWorkBuckets {
  return { today: [], thisWeek: [], waiting: [], returned: [] };
}

// --- Service contract (API-R0-MWK) ------------------------------------------------------

/**
 * The provider-neutral My Work contract (API-R0-MWK, DEC-L). Two
 * implementations (fixture demo track / Supabase production) sit behind
 * this interface; consumers import `myworkService` from `@/data`.
 *
 * Read-only: there is NO write surface and no aggregate SECURITY DEFINER
 * RPC (DM-X-02 precedent) — the production adapter composes plain
 * RLS-protected task/review reads, so the composition can never widen
 * table RLS. Visibility is personal: the caller's live membership is the
 * task assignee or reviewer; standalone returned items are the caller's
 * own submissions; billing (and non-staff roles) receive the empty
 * contract. Collection semantics are API-ERR-02: nothing visible → empty
 * buckets, never an error.
 */
export interface MyWorkService {
  readonly mode: DataSource;

  /** The caller's four DEC-L buckets, computed against the Asia/Kolkata
   *  business date. */
  getMyWork(): Promise<MyWorkBuckets>;
}
