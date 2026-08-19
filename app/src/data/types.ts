// CAOS demo data types — single source of truth (design.md §8)

export interface TeamMember {
  id: string;
  name: string;
  initials: string;
  role: string;
}

export interface Firm {
  name: string;
  shortName: string;
  frn: string;
  city: string;
  fy: string;
  ay: string;
  team: TeamMember[];
}

export type Industry =
  | 'Manufacturing'
  | 'Trading'
  | 'IT Services'
  | 'Pharma'
  | 'Realty'
  | 'Hospitality'
  | 'NGO';

export type EntityType = 'Pvt Ltd' | 'LLP' | 'Ltd' | 'Partnership' | 'Proprietorship' | 'Trust';

export type ClientTag = 'GST' | 'TDS' | 'Audit' | 'MCA' | 'ITR' | 'PF/ESI' | 'Advance Tax';

export interface Client {
  id: string;
  name: string;
  entityType: EntityType;
  city: string;
  industry: Industry;
  turnoverBand: string; // e.g. "₹5–25 Cr"
  ownerId: string;
  tags: ClientTag[];
  gstin?: string;
  pan?: string;
  cin?: string;
}

export type ComplianceId =
  | 'gstr1'
  | 'gstr3b'
  | 'tds24q'
  | 'tds26q'
  | 'itr'
  | 'tax-audit'
  | 'stat-audit'
  | 'mca-aoc4'
  | 'mca-mgt7'
  | 'advance-tax'
  | 'pf-esi';

export interface ComplianceType {
  id: ComplianceId;
  name: string;
  shortName: string;
  category: 'GST' | 'TDS' | 'Income Tax' | 'Audit' | 'MCA' | 'Payroll';
  frequency: 'Monthly' | 'Quarterly' | 'Annual' | 'Event-based';
  dueRule: string; // human-readable statutory rule
  periods: string[]; // FY 2024-25 period labels
}

export const WORKFLOW_STATES = [
  'Not Started',
  'Information Requested',
  'Information Received',
  'Preparation',
  'Internal Review',
  'Client Approval',
  'Ready to File',
  'Filed',
  'Acknowledgement Received',
  'Closed',
] as const;

export type WorkflowState = (typeof WORKFLOW_STATES)[number];

export type TaskCategory = 'completed' | 'in-progress' | 'waiting' | 'under-review' | 'not-started';

export interface RiskFactor {
  label: string;
  points: number;
  detail: string;
}

export interface Reminder {
  sentAt: string; // ISO
  channel: 'Email' | 'WhatsApp' | 'Call';
  by: string;
}

export interface WorkflowEvent {
  state: WorkflowState;
  at: string; // ISO timestamp
  actor: string;
}

export interface TaskInstance {
  id: string;
  clientId: string;
  complianceId: ComplianceId;
  period: string; // e.g. "Sep 2025" / "Q2 FY25"
  dueDate: string; // ISO date
  state: WorkflowState;
  category: TaskCategory;
  ownerId: string;
  riskScore: number; // 0-100
  riskFactors: RiskFactor[];
  missingDocs: string[];
  reminders: Reminder[];
  history: WorkflowEvent[];
  filedAt?: string;
  atRisk: boolean;
}

export interface DeadlineGroup {
  id: string;
  complianceId: ComplianceId;
  complianceName: string;
  period: string;
  dueDate: string;
  daysLeft: number;
  totalClients: number;
  filed: number;
  readyToFile: number;
  inProgress: number;
  waiting: number;
  underReview: number;
  notStarted: number;
  atRisk: number;
}

export type ReviewType = 'GST Reconciliation' | 'TDS' | 'ITR' | 'Financial Statements' | 'Audit Workpaper';
export type ReviewStatus = 'pending' | 'approved' | 'returned';

export interface ReviewItem {
  id: string;
  type: ReviewType;
  clientId: string;
  title: string;
  period: string;
  submittedBy: string;
  submittedAt: string;
  status: ReviewStatus;
  priority: 'high' | 'medium' | 'low';
  note: string;
  comments: { at: string; by: string; text: string }[];
}

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface FirmAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  clientId?: string;
  complianceId?: ComplianceId;
  raisedAt: string;
  ownerId: string;
  status: 'active' | 'acknowledged' | 'resolved';
  recommendedAction: string;
}

export interface DependencyClient {
  clientId: string;
  clientName: string;
  blockingTasks: number;
  missingDocs: string[];
  oldestWaitDays: number;
  lastReminderAt?: string;
  ownerId: string;
}

export interface AskChip {
  label: string;
  value: string;
}

export interface AskTable {
  columns: string[];
  rows: string[][];
}

export interface AskAnswer {
  question: string;
  summary: string;
  chips: AskChip[];
  table?: AskTable;
  followUps: string[];
}

export interface FirmAggregates {
  active: number;
  completed: number;
  inProgress: number;
  waiting: number;
  underReview: number;
  atRisk: number;
  notStarted: number;
}
