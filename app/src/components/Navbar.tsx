import { NavLink, useNavigate } from 'react-router-dom';
import {

  CalendarClock,
  FileText,
  FileBarChart2,
  Gauge,
  Link2,
  RotateCcw,
  Sparkles,
  Sunrise,
  TriangleAlert,
  X,
} from 'lucide-react';
import Badge from './Badge';
import Avatar from './Avatar';
import { useDemoStore } from '@/data/store';
import { DEPENDENCY_TOTALS, FIRM } from '@/data';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Sunrise;
  badge?: { value: number; tone: 'gold' | 'critical' | 'neutral' };
  violet?: boolean;
}

/**
 * Sidebar navigation ("Navbar") — 240px brand-deep, gold active bar,
 * icon rail below xl, overlay drawer on mobile.
 */
export default function Navbar({ mobileOpen, onCloseMobile }: { mobileOpen: boolean; onCloseMobile: () => void }) {
  const { reviewPendingCount, activeAlertCount, resetDemo } = useDemoStore();
  const navigate = useNavigate();

  const items: NavItem[] = [
    { to: '/brief', label: 'Morning Brief', icon: Sunrise },
    { to: '/command', label: 'Command Centre', icon: Gauge },
    { to: '/deadlines', label: 'Deadlines', icon: CalendarClock },
    { to: '/review', label: 'Review Queue', icon: FileBarChart2, badge: { value: reviewPendingCount, tone: 'gold' } },
    { to: '/dependency', label: 'Client Dependency', icon: Link2, badge: { value: DEPENDENCY_TOTALS.clients, tone: 'neutral' } },
    { to: '/alerts', label: 'Risk Alerts', icon: TriangleAlert, badge: { value: activeAlertCount, tone: 'critical' } },
    { to: '/ask', label: 'Ask CAOS', icon: Sparkles, violet: true },
    { to: '/reports', label: 'Reports', icon: FileText },
  ];

  const nav = (isMobile: boolean) => (
    <div className="flex h-full w-60 flex-col bg-brand-deep text-paper">
      {/* Wordmark + gold rule */}
      <div className="px-5 pt-5 pb-4">
          <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label="Go to landing"
            className="flex items-center"
          >
            <img src="/logo.svg" alt="CAOS" className="h-8 w-auto" />
          </button>
          {isMobile && (
            <button type="button" onClick={onCloseMobile} aria-label="Close menu" className="rounded-md p-1 text-paper/60 hover:text-paper">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className="mt-3 h-px w-full bg-gold/70" />
      </div>

      {/* Nav items */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Primary">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={isMobile ? onCloseMobile : undefined}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors',
                isActive
                  ? 'bg-brand text-paper'
                  : item.violet
                    ? 'text-paper/75 hover:bg-violet/25 hover:text-paper'
                    : 'text-paper/65 hover:bg-paper/10 hover:text-paper',
              )
            }
          >
            {({ isActive }) => (
              <>
                {/* 3px gold active bar */}
                <span className={cn('absolute left-0 h-6 w-[3px] rounded-r transition-opacity', isActive ? 'bg-gold opacity-100' : 'opacity-0')} />
                <item.icon className={cn('h-[18px] w-[18px] shrink-0', item.violet && !isActive && 'text-violet-soft')} strokeWidth={1.8} />
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge && item.badge.value > 0 && (
                  <Badge tone={item.badge.tone} className={cn(isActive && 'bg-gold text-white')}>
                    {item.badge.value}
                  </Badge>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer: firm card + user chip + demo controls */}
      <div className="space-y-3 border-t border-paper/10 px-4 py-4">
        <div
          className="relative overflow-hidden rounded-lg border border-paper/10 bg-paper/5 px-3 py-2.5"
        >
          <div
            className="pointer-events-none absolute inset-0"
            style={{ backgroundImage: 'url(/pattern-ledger.svg)', backgroundSize: '160px' }}
            aria-hidden
          />
          <div className="relative">
            <div className="text-[12px] leading-4 font-semibold">{FIRM.shortName}</div>
            <div className="mt-0.5 font-mono text-[10px] text-paper/50">FRN {FIRM.frn} · {FIRM.city}</div>
            <div className="mt-1.5 inline-flex rounded-full border border-gold/40 bg-gold/15 px-2 py-px font-mono text-[10px] text-gold-soft">
              {FIRM.fy}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <Avatar name={FIRM.team[0].name} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium">{FIRM.team[0].name}</div>
            <div className="text-[10px] text-paper/50">{FIRM.team[0].role}</div>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="rounded-full border border-paper/15 px-2 py-px font-mono text-[9.5px] tracking-wide text-paper/45 uppercase">
            Seeded demo data
          </span>
          <button
            type="button"
            onClick={() => {
              resetDemo();
              navigate('/brief');
            }}
            className="flex items-center gap-1 text-[10.5px] text-paper/45 transition-colors hover:text-gold-soft"
            title="Reset demo data"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop: fixed icon rail < xl, full sidebar ≥ xl */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden md:block xl:hidden" aria-label="Primary">
        <IconRail items={items} />
      </aside>
      <aside className="fixed inset-y-0 left-0 z-40 hidden xl:block" aria-label="Primary">
        {nav(false)}
      </aside>
      {/* Mobile overlay drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={onCloseMobile} aria-hidden />
          <div className="absolute inset-y-0 left-0">{nav(true)}</div>
        </div>
      )}
    </>
  );
}

/** Collapsed icon rail (< 1280px). */
function IconRail({ items }: { items: NavItem[] }) {
  const navigate = useNavigate();
  return (
    <div className="flex h-full w-16 flex-col bg-brand-deep text-paper">
      <div className="flex justify-center px-2 pt-5 pb-4">
        <button type="button" onClick={() => navigate('/')} aria-label="Go to landing" className="flex items-center">
          <img src="/favicon.svg" alt="CAOS" className="h-8 w-8" />
        </button>
      </div>
      <nav className="flex-1 space-y-1 px-2" aria-label="Primary">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={item.label}
            className={({ isActive }) =>
              cn(
                'relative flex items-center justify-center rounded-lg py-2.5 transition-colors',
                isActive ? 'bg-brand text-paper' : 'text-paper/60 hover:bg-paper/10 hover:text-paper',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span className={cn('absolute left-0 h-5 w-[3px] rounded-r', isActive ? 'bg-gold' : 'bg-transparent')} />
                <item.icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="flex justify-center px-2 py-4">
        <Avatar name={FIRM.team[0].name} size="sm" />
      </div>
    </div>
  );
}
