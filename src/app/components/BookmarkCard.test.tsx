import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BookmarkCard } from './BookmarkCard';

describe('BookmarkCard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Play buttons open the bookmark URL in a new tab', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const user = userEvent.setup();

    render(
      <BookmarkCard
        title="My Video"
        url="https://example.com/video"
        tags={[]}
      />,
    );

    // There are two Play buttons (desktop overlay + mobile), both labelled "Open bookmark"
    const playButtons = screen.getAllByRole('button', { name: /open bookmark/i });
    expect(playButtons.length).toBeGreaterThanOrEqual(1);

    await user.click(playButtons[0]);

    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com/video',
      '_blank',
      'noopener,noreferrer',
    );
  });
});
