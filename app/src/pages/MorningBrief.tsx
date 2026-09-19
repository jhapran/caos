import GreetingBand from './brief/GreetingBand';
import BriefCards from './brief/BriefCards';
import AttentionList from './brief/AttentionList';
import AskBar from './brief/AskBar';
import { useDashboardAggregates } from '@/hooks/useDashboardAggregates';

/**
 * Partner Morning Brief (/brief) — the PRD north star: understandable in under
 * 60 seconds. Greeting band, 3×2 brief-card grid, streaming AI attention list,
 * and the Ask CAOS entry bar. Everything on screen is click-through.
 *
 * IMP-060: ONE aggregate composition per page render (API-OQ-03 B-count
 * intent) — GreetingBand and BriefCards receive this state as props. Called
 * unconditionally for stable hook order; the fixture adapter is cheap.
 */
export default function MorningBrief() {
  const dashboard = useDashboardAggregates();
  return (
    <div className="space-y-6">
      <GreetingBand dashboard={dashboard} />
      <BriefCards dashboard={dashboard} />
      <AttentionList />
      <AskBar />
    </div>
  );
}
