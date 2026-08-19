import type { AskAnswer } from '@/data';

/** One Q→A exchange in the Ask CAOS conversation. */
export interface ConversationTurn {
  id: number;
  query: string;
  answer?: AskAnswer;
  /** True when the answer is the best-effort fallback rather than a fixture. */
  isFallback?: boolean;
}
