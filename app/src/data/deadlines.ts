// Deadlines board: groups of task instances by compliance × period (design.md §8).
// Counts are derived live from TASKS so drill-downs always reconcile.

import { getCompliance } from './compliance';
import { daysUntil, TASKS } from './tasks';
import type { Client, DeadlineGroup, TaskInstance } from './types';
import { getClient } from './clients';

export function getDeadlineGroups(): DeadlineGroup[] {
  const map = new Map<string, DeadlineGroup>();
  for (const t of TASKS) {
    const key = `${t.complianceId}::${t.period}`;
    let g = map.get(key);
    if (!g) {
      const master = getCompliance(t.complianceId);
      g = {
        id: key,
        complianceId: t.complianceId,
        complianceName: master.name,
        period: t.period,
        dueDate: t.dueDate,
        daysLeft: daysUntil(t.dueDate),
        totalClients: 0,
        filed: 0,
        readyToFile: 0,
        inProgress: 0,
        waiting: 0,
        underReview: 0,
        notStarted: 0,
        atRisk: 0,
      };
      map.set(key, g);
    }
    g.totalClients += 1;
    if (t.category === 'completed') g.filed += 1;
    else if (t.state === 'Ready to File') g.readyToFile += 1;
    else if (t.category === 'in-progress') g.inProgress += 1;
    else if (t.category === 'waiting') g.waiting += 1;
    else if (t.category === 'under-review') g.underReview += 1;
    else g.notStarted += 1;
    if (t.atRisk) g.atRisk += 1;
  }
  return [...map.values()].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export function getDeadlineGroup(id: string): DeadlineGroup | undefined {
  return getDeadlineGroups().find((g) => g.id === id);
}

export interface DeadlineClientRow {
  task: TaskInstance;
  client: Client;
}

/** Drill-down: the filterable client list behind any deadline number. */
export function getDeadlineClients(id: string): DeadlineClientRow[] {
  const [complianceId, period] = id.split('::');
  return TASKS.filter((t) => t.complianceId === complianceId && t.period === period)
    .map((task) => ({ task, client: getClient(task.clientId)! }))
    .filter((r) => r.client)
    .sort((a, b) => b.task.riskScore - a.task.riskScore);
}
