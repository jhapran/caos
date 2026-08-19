import GreetingBand from './brief/GreetingBand';
import BriefCards from './brief/BriefCards';
import AttentionList from './brief/AttentionList';
import AskBar from './brief/AskBar';

/**
 * Partner Morning Brief (/brief) — the PRD north star: understandable in under
 * 60 seconds. Greeting band, 3×2 brief-card grid, streaming AI attention list,
 * and the Ask CAOS entry bar. Everything on screen is click-through.
 */
export default function MorningBrief() {
  return (
    <div className="space-y-6">
      <GreetingBand />
      <BriefCards />
      <AttentionList />
      <AskBar />
    </div>
  );
}
