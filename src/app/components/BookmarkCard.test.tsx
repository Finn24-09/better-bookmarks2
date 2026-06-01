import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { setupUser } from '../../test/userEvent';
import { BookmarkCard } from './BookmarkCard';

describe('BookmarkCard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clicking the edit (pencil) button calls the onEdit prop', async () => {
    const onEdit = vi.fn();
    const user = setupUser();
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
    const user = setupUser();

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

  // ---------------------------------------------------------------------------
  // M-04 / SEC-011 / CR-050 — defense-in-depth scheme allowlist on click
  // ---------------------------------------------------------------------------
  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['vbscript:MsgBox("xss")'],
    ['file:///etc/passwd'],
    ['ftp://example.com/file'],
    ['not a url at all'],
  ])('Open button does NOT call window.open for unsafe URL %s', async (badUrl) => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const user = setupUser();

    render(<BookmarkCard title="Bad" url={badUrl} tags={[]} />);

    const playButton = screen.getAllByRole('button', { name: /open bookmark/i })[0];
    await user.click(playButton);

    expect(openSpy).not.toHaveBeenCalled();
  });

  it.each(['http://example.com/x', 'https://example.com/x', 'HTTPS://EXAMPLE.com/x'])(
    'Open button DOES call window.open for safe URL %s',
    async (goodUrl) => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      const user = setupUser();

      render(<BookmarkCard title="Good" url={goodUrl} tags={[]} />);
      const playButton = screen.getAllByRole('button', { name: /open bookmark/i })[0];
      await user.click(playButton);

      expect(openSpy).toHaveBeenCalledWith(goodUrl, '_blank', 'noopener,noreferrer');
    },
  );

  // ---------------------------------------------------------------------------
  // CR-007 — thumbnail render-side scheme allowlist (URL parse, not regex)
  // ---------------------------------------------------------------------------
  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<script>'],
    ['file:///etc/passwd'],
    ['not a url at all'],
  ])('does not render an img tag for unsafe thumbnail URL %s', (badThumb) => {
    render(<BookmarkCard title="x" url="https://example.com" tags={[]} thumbnail={badThumb} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders an img tag for a blob: thumbnail URL', () => {
    render(
      <BookmarkCard
        title="x"
        url="https://example.com"
        tags={[]}
        thumbnail="blob:https://example.com/abc-123"
      />,
    );
    expect(screen.getByRole('img')).toBeInTheDocument();
  });
});
