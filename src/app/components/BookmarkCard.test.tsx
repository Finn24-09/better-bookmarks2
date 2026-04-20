import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BookmarkCard } from './BookmarkCard';

describe('BookmarkCard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clicking the edit (pencil) button calls the onEdit prop', async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(
      <BookmarkCard
        title="My Video"
        url="https://example.com/video"
        tags={[]}
        onEdit={onEdit}
      />,
    );
    // The edit button has no aria-label; find it by excluding the play buttons.
    const editButton = screen.getAllByRole('button').find(
      (b) => b.getAttribute('aria-label') !== 'Open bookmark',
    )!;
    await user.click(editButton);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('renders a gradient placeholder div (no img element) when no thumbnail is provided', () => {
    render(<BookmarkCard title="My Video" url="https://example.com/video" tags={[]} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders an img element when a valid thumbnail URL is provided', () => {
    render(
      <BookmarkCard
        title="My Video"
        url="https://example.com/video"
        thumbnail="https://example.com/thumb.jpg"
        tags={[]}
      />,
    );
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/thumb.jpg');
  });

  it('falls back to the placeholder (no img) when the img fires an error', () => {
    render(
      <BookmarkCard
        title="My Video"
        url="https://example.com/video"
        thumbnail="https://example.com/thumb.jpg"
        tags={[]}
      />,
    );
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
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
