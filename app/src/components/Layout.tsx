import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Command, Menu, Sparkles } from 'lucide-react';
import Navbar from './Navbar';
import Breadcrumb from './Breadcrumb';
import type { Crumb } from './Breadcrumb';
import Avatar from './Avatar';
import CommandPalette from './CommandPalette';
import ToastViewport from './Toast';
import { useDemoStore } from '@/data/store';
import { FIRM } from '@/data';

const ROUTE_LABELS: Record<string, string> = {
  brief: 'Morning Brief',
  command: 'Command Centre',
  deadlines: 'Deadlines',
  clients: 'Clients',
  compliance: 'Compliance Detail',
  ask: 'Ask CAOS',
  review: 'Review Queue',
  dependency: 'Client Dependency',
  alerts: 'Risk Alerts',
  reports: 'Reports',
};

function crumbsFor(pathname: string): Crumb[] {
  const parts = pathname.split('/').filter(Boolean);
  const crumbs: Crumb[] = [];
  let acc = '';
  parts.forEach((p, i) => {
    acc += `/${p}`;
    const label = ROUTE_LABELS[p] ?? decodeURIComponent(p);
    crumbs.push({ label, href: i < parts.length - 1 ? acc : undefined });
  });
  return crumbs;
}

/**
 * App shell (all pages except landing): fixed left sidebar (240px / icon rail)
 * + sticky 60px topbar + content slot via <Outlet/>.
 * Layout owns the sidebar offset — pages never compensate for nav width.
 */
export default function Layout() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { activeAlertCount } = useDemoStore();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    setMobileNav(false);
  }, [location.pathname]);

  const crumbs = crumbsFor(location.pathname);

  return (
    <div className="min-h-[100dvh] bg-paper">
      <Navbar mobileOpen={mobileNav} onCloseMobile={() => setMobileNav(false)} />

      {/* Content column — offset matches sidebar width at each breakpoint */}
      <div className="md:pl-16 xl:pl-60">
        {/* Topbar (60px, sticky) */}
        <header className="sticky top-0 z-30 flex h-[60px] items-center gap-3 border-b border-line bg-card px-4 md:px-7">
          <button
            type="button"
            className="rounded-md p-2 text-ink-2 hover:bg-paper-deep md:hidden"
            onClick={() => setMobileNav(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <Breadcrumb items={crumbs.length ? crumbs : [{ label: 'Morning Brief' }]} className="hidden sm:flex" />

          <div className="flex-1" />

          {/* Global search (⌘K) */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex w-44 items-center gap-2 rounded-lg border border-line bg-paper px-3 py-1.5 text-[12px] text-ink-3 transition-colors hover:border-ink-3/50 lg:w-64"
          >
            <Command className="h-3.5 w-3.5" />
            <span className="flex-1 text-left">Search or jump to…</span>
            <kbd className="rounded border border-line bg-card px-1 font-mono text-[10px]">⌘K</kbd>
          </button>

          {/* Ask CAOS quick pill */}
          <button
            type="button"
            onClick={() => navigate('/ask')}
            className="hidden items-center gap-1.5 rounded-full bg-violet px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-violet/85 sm:flex"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Ask CAOS
          </button>

          {/* Notifications */}
          <button
            type="button"
            onClick={() => navigate('/alerts')}
            className="relative rounded-lg p-2 text-ink-2 transition-colors hover:bg-paper-deep"
            aria-label={`${activeAlertCount} active alerts`}
          >
            <Bell className="h-[18px] w-[18px]" />
            {activeAlertCount > 0 && (
              <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-critical font-mono text-[9px] font-semibold text-white tnum">
                {activeAlertCount}
              </span>
            )}
          </button>

          {/* Date chip */}
          <span className="hidden rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[11px] text-ink-2 lg:inline-flex">
            Tue, 09 Sep 2025
          </span>

          <Avatar name={FIRM.team[0].name} size="sm" />
        </header>

        {/* Page content slot — 1440px max, centered */}
        <main className="mx-auto w-full max-w-[1440px] px-4 py-7 md:px-7 lg:px-8">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ToastViewport />
    </div>
  );
}
