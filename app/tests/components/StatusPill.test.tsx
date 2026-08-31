import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import StatusPill, { statusPalette } from '@/components/StatusPill';

describe('statusPalette()', () => {
  it('maps known statuses to their color family', () => {
    expect(statusPalette('Filed').dot).toBe('bg-success');
    expect(statusPalette('Overdue').dot).toBe('bg-critical');
  });

  it('falls back to the neutral palette for unknown statuses', () => {
    expect(statusPalette('Not A Real Status').text).toBe('text-ink-2');
  });
});

describe('<StatusPill />', () => {
  it('renders the status text (proves jsdom render + jest-dom matchers)', () => {
    render(<StatusPill status="Ready to File" />);
    const pill = screen.getByText('Ready to File');
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveClass('text-brand');
  });

  it('applies the small size variant', () => {
    render(<StatusPill status="Filed" size="sm" />);
    expect(screen.getByText('Filed')).toHaveClass('text-[11px]');
  });
});
