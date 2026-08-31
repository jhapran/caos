import { describe, expect, it } from 'vitest';

import { cn } from '@/lib/utils';

describe('cn()', () => {
  it('joins class names', () => {
    expect(cn('px-2', 'py-1')).toBe('px-2 py-1');
  });

  it('drops falsy values', () => {
    const flag = Boolean(0); // false at runtime; not a constant expression
    expect(cn('px-2', flag && 'hidden', undefined, 'py-1')).toBe('px-2 py-1');
  });

  it('merges conflicting Tailwind classes (tailwind-merge)', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });
});
