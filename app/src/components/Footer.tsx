import { Link } from 'react-router-dom';

/** Landing footer — dark, minimal (landing page only). */
export default function Footer() {
  return (
    <footer className="border-t border-paper/10 bg-brand-deep">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
        <img src="/logo.svg" alt="CAOS" className="h-7 w-auto opacity-90" />
        <p className="text-[12px] text-paper/50">Seeded demo · No real client data · CAOS © 2025</p>
        <Link
          to="/brief"
          className="text-[12px] font-medium text-gold-soft underline decoration-gold/40 underline-offset-4 transition-colors hover:text-gold"
        >
          Enter Live Demo →
        </Link>
      </div>
    </footer>
  );
}
