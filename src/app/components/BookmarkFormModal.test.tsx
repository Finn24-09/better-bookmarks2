import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BookmarkFormModal } from './BookmarkFormModal';
import type { Tag } from '../../lib/tags';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    cryptoKey: {} as CryptoKey,
    userId: 'user-1',
  }),
}));

vi.mock('../../lib/bookmarks', () => ({
  createBookmark: vi.fn(),
  updateBookmark: vi.fn(),
  deleteBookmark: vi.fn(),
}));

vi.mock('../../lib/tags', () => ({
  createTag: vi.fn(),
  setBookmarkTags: vi.fn(),
}));

import { createBookmark, updateBookmark, deleteBookmark } from '../../lib/bookmarks';
import { setBookmarkTags } from '../../lib/tags';

// ---------------------------------------------------------------------------

const AVAILABLE_TAGS: Tag[] = [
  { id: 'tag-1', name: 'React' },
  { id: 'tag-2', name: 'TypeScript' },
];

const EDIT_DATA = {
  id: 'bm-1',
  title: 'Existing Title',
  url: 'https://existing.com',
  thumbnailUrl: null,
  tagIds: [] as string[],
};

describe('BookmarkFormModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(setBookmarkTags).mockResolvedValue(undefined as never);
  });

  function renderAdd(props: { onSave?: () => void; onClose?: () => void } = {}) {
    const onSave = props.onSave ?? vi.fn();
    const onClose = props.onClose ?? vi.fn();
    render(
      <BookmarkFormModal
        open={true}
        onClose={onClose}
        initialData={null}
        availableTags={AVAILABLE_TAGS}
        onSave={onSave}
      />,
    );
    return { onSave, onClose };
  }

  function renderEdit(props: { onSave?: () => void; onClose?: () => void } = {}) {
    const onSave = props.onSave ?? vi.fn();
    const onClose = props.onClose ?? vi.fn();
    render(
      <BookmarkFormModal
        open={true}
        onClose={onClose}
        initialData={EDIT_DATA}
        availableTags={AVAILABLE_TAGS}
        onSave={onSave}
      />,
    );
    return { onSave, onClose };
  }

  it('shows "Add Bookmark" heading when initialData is null', () => {
    renderAdd();
    expect(screen.getByText('Add Bookmark')).toBeInTheDocument();
  });

  it('shows "Edit Bookmark" heading when initialData is provided', () => {
    renderEdit();
    expect(screen.getByText('Edit Bookmark')).toBeInTheDocument();
  });

  it('Delete button absent in add mode', () => {
    renderAdd();
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
  });

  it('Delete button present in edit mode', () => {
    renderEdit();
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
  });

  it('submitting an empty form shows required errors on Title and URL', async () => {
    const user = userEvent.setup();
    renderAdd();
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => {
      expect(screen.getByText('Title is required')).toBeInTheDocument();
      expect(screen.getByText('URL is required')).toBeInTheDocument();
    });
  });

  it('successful add calls createBookmark + setBookmarkTags, then onSave and onClose', async () => {
    vi.mocked(createBookmark).mockResolvedValue({ id: 'new-bm' } as never);
    const onSave = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <BookmarkFormModal
        open={true}
        onClose={onClose}
        initialData={null}
        availableTags={AVAILABLE_TAGS}
        onSave={onSave}
      />,
    );

    await user.type(screen.getByPlaceholderText('Enter bookmark title\u2026'), 'New Title');
    // Both URL inputs have the same placeholder; the first is the required URL field
    await user.type(screen.getAllByPlaceholderText('https://\u2026')[0], 'https://example.com');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(createBookmark).toHaveBeenCalled();
      expect(setBookmarkTags).toHaveBeenCalledWith('new-bm', [], []);
      expect(onSave).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('successful edit calls updateBookmark + setBookmarkTags, then onSave and onClose', async () => {
    vi.mocked(updateBookmark).mockResolvedValue(undefined as never);
    const onSave = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <BookmarkFormModal
        open={true}
        onClose={onClose}
        initialData={EDIT_DATA}
        availableTags={AVAILABLE_TAGS}
        onSave={onSave}
      />,
    );

    const titleInput = screen.getByPlaceholderText('Enter bookmark title\u2026');
    await user.clear(titleInput);
    await user.type(titleInput, 'Updated Title');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(updateBookmark).toHaveBeenCalledWith(
        'bm-1',
        expect.objectContaining({ title: 'Updated Title' }),
        expect.any(Object),
      );
      expect(setBookmarkTags).toHaveBeenCalled();
      expect(onSave).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('clicking Delete calls deleteBookmark, then onSave and onClose', async () => {
    vi.mocked(deleteBookmark).mockResolvedValue(undefined as never);
    const onSave = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <BookmarkFormModal
        open={true}
        onClose={onClose}
        initialData={EDIT_DATA}
        availableTags={AVAILABLE_TAGS}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      expect(deleteBookmark).toHaveBeenCalledWith('bm-1');
      expect(onSave).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('Save button shows "Saving\u2026" while the promise is pending', async () => {
    let resolveFn!: (v: unknown) => void;
    vi.mocked(createBookmark).mockImplementation(
      () => new Promise((res) => { resolveFn = res; }),
    );
    const user = userEvent.setup();
    renderAdd();

    await user.type(screen.getByPlaceholderText('Enter bookmark title\u2026'), 'Test');
    await user.type(screen.getAllByPlaceholderText('https://\u2026')[0], 'https://example.com');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /saving/i })).toBeInTheDocument(),
    );

    resolveFn({ id: 'bm-new' });
  });

  it('shows the API error message when createBookmark rejects', async () => {
    vi.mocked(createBookmark).mockRejectedValue(new Error('Server error'));
    const user = userEvent.setup();
    renderAdd();

    await user.type(screen.getByPlaceholderText('Enter bookmark title\u2026'), 'Test');
    await user.type(screen.getAllByPlaceholderText('https://\u2026')[0], 'https://example.com');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.getByText('Server error')).toBeInTheDocument(),
    );
  });
});
