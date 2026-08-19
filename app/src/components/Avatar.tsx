import { cn } from '@/lib/utils';

const PALETTES = [
  { bg: '#E3F0ED', fg: '#0E5F52' },
  { bg: '#F7EEDF', fg: '#8A5A12' },
  { bg: '#EAF1FD', fg: '#175CD3' },
  { bg: '#F1ECFB', fg: '#6941C6' },
  { bg: '#FBEAE8', fg: '#C0362C' },
  { bg: '#E6F4EC', fg: '#157A4E' },
];

/** Avatar — initials on a deterministic pastel derived from the name. */
export default function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const initials = name
    .replace(/^CA\s+/i, '')
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const p = PALETTES[hash % PALETTES.length];
  const sizes = {
    xs: 'h-6 w-6 text-[10px]',
    sm: 'h-8 w-8 text-[11px]',
    md: 'h-9 w-9 text-[12px]',
    lg: 'h-11 w-11 text-[14px]',
  };
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold', sizes[size], className)}
      style={{ backgroundColor: p.bg, color: p.fg }}
      aria-label={name}
      title={name}
    >
      {initials}
    </span>
  );
}
