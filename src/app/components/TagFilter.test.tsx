import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { setupUser } from '../../test/userEvent';
import { TagFilter } from './TagFilter';
import type { Tag } from '../../lib/tags';

// Disable Framer Motion animations so AnimatePresence mounts/unmounts immediately.
vi.mock('motion/react', async (importOriginal) => {
  const React = await import('react');
  const mod = await importOriginal<typeof import('motion/react')>();
  return {
    ...mod,
    // Render motion.* elements as plain HTML elements (strip animation props).
    motion: new Proxy({} as typeof mod.motion, {
      get(_: unknown, tag: string) {
        return ({ children, initial, animate, exit, variants, custom, layout, transition, layoutId, ...rest }: Record<string, unknown>) =>
          React.createElement(tag as keyof React.JSX.IntrinsicElements, rest as React.HTMLAttributes<HTMLElement>, children as React.ReactNode);
      },
    }),
    // AnimatePresence renders children directly — no deferred exit animations.
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

function makeTags(count: number): Tag[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `tag-${i + 1}`,
    name: `Tag ${i + 1}`,
  }));
}

describe('TagFilter', () => {
  it('renders "All" button alongside every provided tag', () => {
    const tags = makeTags(3);
    render(<TagFilter tags={tags} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    tags.forEach((tag) => {
      expect(screen.getByRole('button', { name: tag.name })).toBeInTheDocument();
    });
  });

  it('"All" button has active styling when selected is null', () => {
    render(<TagFilter tags={makeTags(2)} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'All' }).className).toContain('bg-white/20');
  });

  it('a tag button has active styling when its id is selected', () => {
    const tags = makeTags(2);
    render(<TagFilter tags={tags} selected="tag-1" onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Tag 1' }).className).toContain('bg-white/20');
  });

  it('clicking "All" calls onSelect(null)', async () => {
    const onSelect = vi.fn();
    const user = setupUser();
    render(<TagFilter tags={makeTags(2)} selected="tag-1" onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('clicking a tag calls onSelect with that tag id', async () => {
    const onSelect = vi.fn();
    const user = setupUser();
    render(<TagFilter tags={makeTags(3)} selected={null} onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: 'Tag 2' }));
    expect(onSelect).toHaveBeenCalledWith('tag-2');
  });

  it('clicking the currently-active tag calls onSelect(null) to deselect', async () => {
    const onSelect = vi.fn();
    const user = setupUser();
    render(<TagFilter tags={makeTags(3)} selected="tag-1" onSelect={onSelect} />);
    await user.click(screen.getByRole('button', { name: 'Tag 1' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('does not show "Show More" button when there are 5 or fewer tags', () => {
    render(<TagFilter tags={makeTags(5)} selected={null} onSelect={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument();
  });

  it('shows "Show More" when there are more than 5 tags', () => {
    render(<TagFilter tags={makeTags(7)} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: /show more/i })).toBeInTheDocument();
  });

  it('clicking "Show More" reveals extra tags and relabels button to "Show Less"', async () => {
    const user = setupUser();
    render(<TagFilter tags={makeTags(7)} selected={null} onSelect={vi.fn()} />);

    // Tags beyond the first 5 are not visible initially
    expect(screen.queryByRole('button', { name: 'Tag 6' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show more/i }));

    expect(screen.getByRole('button', { name: 'Tag 6' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show less/i })).toBeInTheDocument();
  });

  it('clicking "Show Less" hides extra tags again', async () => {
    const user = setupUser();
    render(<TagFilter tags={makeTags(7)} selected={null} onSelect={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /show more/i }));
    expect(screen.getByRole('button', { name: 'Tag 6' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show less/i }));
    expect(screen.queryByRole('button', { name: 'Tag 6' })).not.toBeInTheDocument();
  });
});
