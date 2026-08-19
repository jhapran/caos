import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Crumb {
  label: string;
  href?: string;
}

/** Breadcrumb — clickable trail that powers drill-down wayfinding. */
export default function Breadcrumb({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center gap-1 text-[13px]', className)}>
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <Fragment key={`${item.label}-${i}`}>
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-ink-3" aria-hidden />}
            {item.href && !last ? (
              <Link
                to={item.href}
                className="text-ink-2 transition-colors hover:text-brand hover:underline hover:decoration-gold hover:underline-offset-2"
              >
                {item.label}
              </Link>
            ) : (
              <span className={cn(last ? 'font-medium text-ink' : 'text-ink-2')}>{item.label}</span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
