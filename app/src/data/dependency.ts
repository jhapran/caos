// Client dependency: 48 clients blocking 79 tasks (design.md §8).
// ABC 7 · XYZ 5 · PQR 4 · remaining 45 clients share 63 blocked tasks (1–2 each).

import { CLIENTS } from './clients';
import type { DependencyClient } from './types';

const DOC_POOL = [
  'Bank statements (Aug)', 'Purchase register', 'Sales register', 'TDS challans',
  'Trial balance', 'Form 16A', 'Rent agreements', 'Salary register',
  '26AS statement', 'Inventory statement', 'Loan statements', 'GSTR-2A reconciliation',
];

// Small extended-portfolio clients beyond the 34 named entities (long tail of the firm).
const EXTRA_CLIENTS = [
  'Shree Ganesh Provision Stores', 'Nirmala Nursing Home', 'Falcon Freight Carriers',
  'Sunbeam Playschool', 'Om Sai Distributors', 'Krishna Flour Mill',
  'Bluebird Salon & Spa', 'Silverline Security Services', 'Anand Sweets & Snacks',
  'Paramount Printers', 'Citylight Electricals', 'Rainbow Playschool Trust',
  'Everest Cycle Works', 'Lotus Ladies Wear',
];

function build(): DependencyClient[] {
  const out: DependencyClient[] = [];
  const push = (clientId: string, clientName: string, blockingTasks: number, oldestWaitDays: number, ownerId: string, idx: number) => {
    const docs: string[] = [];
    for (let i = 0; i < Math.min(1 + (idx % 3), DOC_POOL.length); i++) {
      const doc = DOC_POOL[(idx * 3 + i) % DOC_POOL.length];
      if (!docs.includes(doc)) docs.push(doc);
    }
    out.push({
      clientId,
      clientName,
      blockingTasks,
      missingDocs: docs,
      oldestWaitDays,
      lastReminderAt: new Date(new Date('2025-09-09T09:30:00+05:30').getTime() - (1 + (idx % 5)) * 86400000).toISOString(),
      ownerId,
    });
  };

  // Headline blockers (must match PRD narrative)
  push('c-abc', 'ABC Pvt Ltd', 7, 12, 'u-priya', 0);
  push('c-xyz', 'XYZ LLP', 5, 9, 'u-rahul', 1);
  push('c-pqr', 'PQR Industries', 4, 8, 'u-priya', 2);

  // Rest of the named clients — 31 clients
  const named = CLIENTS.filter((c) => !['c-abc', 'c-xyz', 'c-pqr'].includes(c.id));
  let remaining = 79 - 16; // 63 tasks to distribute over 45 clients
  named.forEach((c, i) => {
    const tasks = i < 14 ? 2 : 1;
    push(c.id, c.name, tasks, 3 + ((i * 7) % 9), c.ownerId, i + 3);
    remaining -= tasks;
  });
  // Extended-portfolio long tail — 14 clients, 1 blocked task each (remaining = 63 - (14*2 + 17*1) = 18 > 14, so bump a few)
  EXTRA_CLIENTS.forEach((name, i) => {
    const tasks = i < remaining - (EXTRA_CLIENTS.length - 1 - i) ? 2 : 1;
    push(`c-ext-${i + 1}`, name, tasks, 2 + ((i * 5) % 7), ['u-amit', 'u-neha', 'u-rahul'][i % 3], i + 34);
    remaining -= tasks;
  });
  // Safety net: if any remainder survives, add it to the first extended client.
  if (remaining > 0) {
    const target = out[out.length - EXTRA_CLIENTS.length];
    target.blockingTasks += remaining;
  }
  return out;
}

export const DEPENDENCY_CLIENTS: DependencyClient[] = build();

export const DEPENDENCY_TOTALS = {
  clients: DEPENDENCY_CLIENTS.length, // 48
  blockedTasks: DEPENDENCY_CLIENTS.reduce((s, c) => s + c.blockingTasks, 0), // 79
};
