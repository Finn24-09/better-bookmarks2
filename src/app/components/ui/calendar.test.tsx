import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Calendar } from './calendar';

describe('Calendar', () => {
  it('renders a calendar with navigation buttons (v9 DayPicker API)', () => {
    render(<Calendar mode="single" />);
    const navButtons = screen.getAllByRole('button');
    expect(navButtons.length).toBeGreaterThanOrEqual(2);
  });

  it('renders with a selected date (v9 single mode)', () => {
    const selected = new Date(2024, 0, 15);
    render(<Calendar mode="single" selected={selected} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders with custom className', () => {
    const { container } = render(<Calendar mode="single" className="custom-class" />);
    expect(container.firstChild).not.toBeNull();
  });
});
