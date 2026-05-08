import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api';
import { ManageTagsModal } from './ManageTagsModal';
import type { Tag } from '../../lib/tags';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const mockCryptoKey = vi.hoisted(() => ({} as CryptoKey));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    cryptoKey: mockCryptoKey,
    userId: 'user-uuid-123',
  }),
}));

vi.mock('../../lib/tags', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/tags')>();
  return {
    ...mod,
    updateTag: vi.fn(),
    deleteTag: vi.fn(),
    getBookmarkTagCounts: vi.fn(),
  };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { updateTag, deleteTag, getBookmarkTagCounts } from '../../lib/tags';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTag(overrides: Partial<Tag> = {}): Tag {
  return { id: 'tag-1', name: 'Personal', keyVersion: 1, ...overrides };
}

interface RenderProps {
  open?: boolean;
  tags?: Tag[];
  onClose?: () => void;
  onSave?: () => void;
  onTagDeleted?: (id: string) => void;
}

function renderModal(props: RenderProps = {}) {
  const onClose = props.onClose ?? vi.fn();
  const onSave = props.onSave ?? vi.fn();
  const onTagDeleted = props.onTagDeleted ?? vi.fn();
  return {
    onClose,
    onSave,
    onTagDeleted,
    ...render(
      <ManageTagsModal
        open={props.open ?? true}
        tags={props.tags ?? [makeTag()]}
        onClose={onClose}
        onSave={onSave}
        onTagDeleted={onTagDeleted}
      />,
    ),
  };
}

describe('ManageTagsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateTag).mockResolvedValue(undefined);
    vi.mocked(deleteTag).mockResolvedValue(undefined);
    vi.mocked(getBookmarkTagCounts).mockResolvedValue(new Map());
  });

  // -------------------------------------------------------------------------
  // Render / list
  // -------------------------------------------------------------------------
  it('renders the "Manage Tags" heading when open', () => {
    renderModal();
    expect(screen.getByText('Manage Tags')).toBeInTheDocument();
  });

  it('renders empty-state copy when tags array is empty', () => {
    renderModal({ tags: [] });
    expect(screen.getByText(/no tags yet/i)).toBeInTheDocument();
  });

  it('renders one row per tag with the decrypted name visible', () => {
    renderModal({
      tags: [
        makeTag({ id: 't1', name: 'Personal' }),
        makeTag({ id: 't2', name: 'Work' }),
        makeTag({ id: 't3', name: 'Travel' }),
      ],
    });
    expect(screen.getByText('Personal')).toBeInTheDocument();
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('Travel')).toBeInTheDocument();
  });

  it('does not render a search input when there are 10 or fewer tags', () => {
    const tags = Array.from({ length: 10 }, (_, i) => makeTag({ id: `t${i}`, name: `Tag${i}` }));
    renderModal({ tags });
    expect(screen.queryByPlaceholderText(/search tags/i)).not.toBeInTheDocument();
  });

  it('renders a search input when there are more than 10 tags and filters the list', async () => {
    const user = userEvent.setup();
    const tags = Array.from({ length: 12 }, (_, i) =>
      makeTag({ id: `t${i}`, name: `Tag${i}` }),
    );
    renderModal({ tags });
    const searchInput = screen.getByPlaceholderText(/search tags/i);
    expect(searchInput).toBeInTheDocument();
    await user.type(searchInput, 'Tag1');
    expect(screen.getByText('Tag1')).toBeInTheDocument();
    expect(screen.getByText('Tag10')).toBeInTheDocument();
    expect(screen.getByText('Tag11')).toBeInTheDocument();
    expect(screen.queryByText('Tag2')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // A11y on the row idle state
  // -------------------------------------------------------------------------
  it('Pencil button has aria-label "Rename {name}"', () => {
    renderModal({ tags: [makeTag({ name: 'Personal' })] });
    expect(screen.getByLabelText('Rename Personal')).toBeInTheDocument();
  });

  it('Trash button has aria-label "Delete {name}"', () => {
    renderModal({ tags: [makeTag({ name: 'Personal' })] });
    expect(screen.getByLabelText('Delete Personal')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Rename — UI transitions and save validation
  // -------------------------------------------------------------------------
  it('clicking pencil swaps the row to an input prefilled with the current name', async () => {
    const user = userEvent.setup();
    renderModal({ tags: [makeTag({ name: 'Personal' })] });
    await user.click(screen.getByLabelText('Rename Personal'));
    const input = screen.getByLabelText('New name for Personal') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('Personal');
  });

  it('pre-fills the edit input with the trimmed name so legacy whitespace can be fixed', async () => {
    const user = userEvent.setup();
    // Legacy record whose decrypted name has surrounding whitespace, e.g.
    // a tag created before the createTag trim fix landed.
    renderModal({ tags: [makeTag({ id: 'tag-x', name: ' Personal ' })] });
    // jsdom collapses repeated whitespace inside aria-label lookups, so
    // match the trimmed substring rather than the raw template.
    await user.click(screen.getByLabelText(/^Rename .*Personal/i));
    const input = screen.getByLabelText(/^New name for .*Personal/i) as HTMLInputElement;
    expect(input.value).toBe('Personal');
    // The user wants to commit the trimmed value as-is — Save must be enabled
    // because the seeded value differs from the legacy raw original.
    const saveBtn = screen.getByLabelText('Save rename');
    expect(saveBtn).not.toBeDisabled();
    await user.click(saveBtn);
    await waitFor(() => {
      expect(updateTag).toHaveBeenCalledWith(
        'tag-x',
        'Personal',
        'user-uuid-123',
        mockCryptoKey,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it('Save is disabled when the trimmed value equals the current name (no-op)', async () => {
    const user = userEvent.setup();
    renderModal({ tags: [makeTag({ name: 'Personal' })] });
    await user.click(screen.getByLabelText('Rename Personal'));
    const saveBtn = screen.getByLabelText('Save rename');
    expect(saveBtn).toBeDisabled();
  });

  it('Save is disabled when the trimmed value is empty', async () => {
    const user = userEvent.setup();
    renderModal({ tags: [makeTag({ name: 'Personal' })] });
    await user.click(screen.getByLabelText('Rename Personal'));
    const input = screen.getByLabelText('New name for Personal');
    await user.clear(input);
    await user.type(input, '   ');
    expect(screen.getByLabelText('Save rename')).toBeDisabled();
  });

  it('Save is disabled when the value exceeds MAX_TAG_LENGTH (100 chars)', async () => {
    const user = userEvent.setup();
    renderModal({ tags: [makeTag({ name: 'Personal' })] });
    await user.click(screen.getByLabelText('Rename Personal'));
    const input = screen.getByLabelText('New name for Personal');
    await user.clear(input);
    await user.type(input, 'a'.repeat(101));
    expect(screen.getByLabelText('Save rename')).toBeDisabled();
  });

  it('Save with a new value calls updateTag and onSave', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderModal({ tags: [makeTag({ id: 'tag-x', name: 'Personal' })], onSave });
    await user.click(screen.getByLabelText('Rename Personal'));
    const input = screen.getByLabelText('New name for Personal');
    await user.clear(input);
    await user.type(input, 'Renamed');
    await user.click(screen.getByLabelText('Save rename'));

    await waitFor(() => {
      expect(updateTag).toHaveBeenCalledWith(
        'tag-x',
        'Renamed',
        'user-uuid-123',
        mockCryptoKey,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(onSave).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Rename — error handling
  // -------------------------------------------------------------------------
  it('on 409 from updateTag, shows the literal frontend toast (not PostgREST body) and preserves typed value', async () => {
    const user = userEvent.setup();
    // PostgREST raw body would be e.g. "duplicate key value violates unique constraint tags_user_id_name_hmac_key"
    vi.mocked(updateTag).mockRejectedValue(
      new ApiError(409, 'duplicate key value violates unique constraint tags_user_id_name_hmac_key'),
    );
    renderModal({ tags: [makeTag({ name: 'Personal' })] });
    await user.click(screen.getByLabelText('Rename Personal'));
    const input = screen.getByLabelText('New name for Personal') as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'Work');
    await user.click(screen.getByLabelText('Save rename'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('A tag with that name already exists.');
    });
    // The PostgREST raw message must NOT have been used as the toast text.
    expect(toast.error).not.toHaveBeenCalledWith(
      expect.stringContaining('duplicate key value'),
    );
    // Row stays in edit mode with typed value preserved
    const stillThere = screen.getByLabelText('New name for Personal') as HTMLInputElement;
    expect(stillThere.value).toBe('Work');
  });

  it('on network failure, shows a generic toast and preserves typed value (does not reset to original)', async () => {
    const user = userEvent.setup();
    vi.mocked(updateTag).mockRejectedValue(new Error('network down'));
    renderModal({ tags: [makeTag({ name: 'Personal' })] });
    await user.click(screen.getByLabelText('Rename Personal'));
    const input = screen.getByLabelText('New name for Personal') as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'TypedValue');
    await user.click(screen.getByLabelText('Save rename'));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const stillThere = screen.getByLabelText('New name for Personal') as HTMLInputElement;
    expect(stillThere.value).toBe('TypedValue');
  });

  it('Esc inside the rename input cancels edit mode and returns focus to the Pencil button', async () => {
    const user = userEvent.setup();
    renderModal({ tags: [makeTag({ name: 'Personal' })] });
    await user.click(screen.getByLabelText('Rename Personal'));
    const input = screen.getByLabelText('New name for Personal');
    await user.type(input, '{Escape}');
    // Edit mode exited
    expect(screen.queryByLabelText('New name for Personal')).not.toBeInTheDocument();
    // Focus returned to Pencil
    await waitFor(() => expect(screen.getByLabelText('Rename Personal')).toHaveFocus());
  });

  // -------------------------------------------------------------------------
  // Delete — confirm flow
  // -------------------------------------------------------------------------
  it('clicking trash shows the confirm prompt with the count from getBookmarkTagCounts', async () => {
    const user = userEvent.setup();
    vi.mocked(getBookmarkTagCounts).mockResolvedValue(new Map([['tag-x', 2]]));
    renderModal({ tags: [makeTag({ id: 'tag-x', name: 'Personal' })] });
    await waitFor(() =>
      expect(screen.getByLabelText('Used in 2 bookmarks')).toBeInTheDocument(),
    );
    await user.click(screen.getByLabelText('Delete Personal'));
    expect(screen.getByText(/Removed from 2 bookmarks \(approx\.\)/i)).toBeInTheDocument();
  });

  it('confirm prompt has role="alert"', async () => {
    const user = userEvent.setup();
    renderModal({ tags: [makeTag({ name: 'Personal' })] });
    await user.click(screen.getByLabelText('Delete Personal'));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('clicking the inline Delete button calls deleteTag, onTagDeleted(id), then onSave', async () => {
    const user = userEvent.setup();
    const onTagDeleted = vi.fn();
    const onSave = vi.fn();
    renderModal({
      tags: [makeTag({ id: 'tag-x', name: 'Personal' })],
      onTagDeleted,
      onSave,
    });
    await user.click(screen.getByLabelText('Delete Personal'));
    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      expect(deleteTag).toHaveBeenCalledWith(
        'tag-x',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(onTagDeleted).toHaveBeenCalledWith('tag-x');
      expect(onSave).toHaveBeenCalled();
    });
  });

  it('Cancel returns the row to idle state', async () => {
    const user = userEvent.setup();
    renderModal({ tags: [makeTag({ name: 'Personal' })] });
    await user.click(screen.getByLabelText('Delete Personal'));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Delete Personal')).toBeInTheDocument();
  });

  it('Esc in confirm-delete state cancels the confirm without calling onClose (modal stays open)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderModal({ tags: [makeTag({ name: 'Personal' })], onClose });
    await user.click(screen.getByLabelText('Delete Personal'));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Esc on the confirm prompt — the row's keydown handler must stop propagation
    // so Radix Dialog does not trigger close.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Concurrency — only one row in edit/confirm at a time
  // -------------------------------------------------------------------------
  it('opening a second row in edit mode cancels the first (typed value is lost)', async () => {
    const user = userEvent.setup();
    renderModal({
      tags: [
        makeTag({ id: 't1', name: 'First' }),
        makeTag({ id: 't2', name: 'Second' }),
      ],
    });
    await user.click(screen.getByLabelText('Rename First'));
    const firstInput = screen.getByLabelText('New name for First');
    await user.clear(firstInput);
    await user.type(firstInput, 'TypedFirst');

    // Open a second row's pencil — should cancel the first
    await user.click(screen.getByLabelText('Rename Second'));

    expect(screen.queryByLabelText('New name for First')).not.toBeInTheDocument();
    expect(screen.getByLabelText('New name for Second')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------
  it('re-renders correctly when the tags prop changes (rename appears after parent refresh)', async () => {
    const { rerender } = renderModal({ tags: [makeTag({ id: 't1', name: 'Old' })] });
    expect(screen.getByText('Old')).toBeInTheDocument();
    rerender(
      <ManageTagsModal
        open={true}
        tags={[makeTag({ id: 't1', name: 'New' })]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onTagDeleted={vi.fn()}
      />,
    );
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.queryByText('Old')).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Per-tag usage pill (idle rows only)
  // -------------------------------------------------------------------------
  it('renders usage-count pills using getBookmarkTagCounts (not paginated bookmarks prop)', async () => {
    vi.mocked(getBookmarkTagCounts).mockResolvedValue(
      new Map([
        ['t-used2', 2],
        ['t-used1', 1],
      ]),
    );
    const tags = [
      makeTag({ id: 't-used2', name: 'UsedTwice' }),
      makeTag({ id: 't-used1', name: 'UsedOnce' }),
      makeTag({ id: 't-unused', name: 'UnusedTag' }),
    ];
    renderModal({ tags });

    await waitFor(() =>
      expect(screen.getByLabelText('Used in 2 bookmarks')).toHaveTextContent('2'),
    );
    expect(screen.getByLabelText('Used in 1 bookmark')).toHaveTextContent('1');
    expect(screen.getByLabelText('Used in 0 bookmarks')).toHaveTextContent('0');
  });

  it('does NOT render the usage pill while a row is in edit state', async () => {
    const user = userEvent.setup();
    vi.mocked(getBookmarkTagCounts).mockResolvedValue(new Map([['tag-x', 2]]));
    renderModal({ tags: [makeTag({ id: 'tag-x', name: 'Personal' })] });

    await waitFor(() =>
      expect(screen.getByLabelText('Used in 2 bookmarks')).toBeInTheDocument(),
    );
    await user.click(screen.getByLabelText('Rename Personal'));
    expect(screen.queryByLabelText('Used in 2 bookmarks')).not.toBeInTheDocument();
  });

  it('does NOT render the usage pill while a row is in confirm-delete state', async () => {
    const user = userEvent.setup();
    vi.mocked(getBookmarkTagCounts).mockResolvedValue(new Map([['tag-x', 1]]));
    renderModal({ tags: [makeTag({ id: 'tag-x', name: 'Personal' })] });

    await waitFor(() =>
      expect(screen.getByLabelText('Used in 1 bookmark')).toBeInTheDocument(),
    );
    await user.click(screen.getByLabelText('Delete Personal'));
    expect(screen.queryByLabelText('Used in 1 bookmark')).not.toBeInTheDocument();
  });

  it('aria-label uses singular "bookmark" only for 1, plural "bookmarks" for 0/2/many', async () => {
    vi.mocked(getBookmarkTagCounts).mockResolvedValue(
      new Map([
        ['t1', 1],
        ['t2', 2],
        ['t5', 5],
      ]),
    );
    const tags = [
      makeTag({ id: 't0', name: 'Zero' }),
      makeTag({ id: 't1', name: 'One' }),
      makeTag({ id: 't2', name: 'Two' }),
      makeTag({ id: 't5', name: 'Five' }),
    ];
    renderModal({ tags });

    await waitFor(() =>
      expect(screen.getByLabelText('Used in 5 bookmarks')).toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Used in 0 bookmarks')).toBeInTheDocument();
    expect(screen.getByLabelText('Used in 1 bookmark')).toBeInTheDocument();
    expect(screen.getByLabelText('Used in 2 bookmarks')).toBeInTheDocument();
  });

  it('usage pill counts are correct on rows surviving a search filter', async () => {
    const user = userEvent.setup();
    vi.mocked(getBookmarkTagCounts).mockResolvedValue(
      new Map([
        ['t3', 2],
        ['t7', 3],
      ]),
    );
    const tags = Array.from({ length: 11 }, (_, i) => makeTag({ id: `t${i}`, name: `Tag${i}` }));
    renderModal({ tags });

    await waitFor(() =>
      expect(screen.getByLabelText('Used in 2 bookmarks')).toBeInTheDocument(),
    );

    const searchInput = screen.getByPlaceholderText(/search tags/i);
    await user.type(searchInput, 'Tag3');

    expect(screen.getByLabelText('Used in 2 bookmarks')).toBeInTheDocument();
    expect(screen.queryByLabelText('Used in 3 bookmarks')).not.toBeInTheDocument();
  });

  it('aborts in-flight apiFetch calls when the modal unmounts', async () => {
    const user = userEvent.setup();
    let receivedSignal: AbortSignal | undefined;
    vi.mocked(updateTag).mockImplementation(async (_id, _name, _userId, _key, options) => {
      receivedSignal = options?.signal;
      // never resolve so the request would still be "in flight" when we unmount
      return new Promise<void>(() => {});
    });

    const { unmount } = renderModal({ tags: [makeTag({ name: 'Personal' })] });
    await user.click(screen.getByLabelText('Rename Personal'));
    const input = screen.getByLabelText('New name for Personal');
    await user.clear(input);
    await user.type(input, 'Renamed');
    await user.click(screen.getByLabelText('Save rename'));

    await waitFor(() => expect(receivedSignal).toBeDefined());
    expect(receivedSignal!.aborted).toBe(false);

    act(() => unmount());

    expect(receivedSignal!.aborted).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Counts data flow (issue #29)
  // -------------------------------------------------------------------------
  it('calls getBookmarkTagCounts exactly once when the modal opens', async () => {
    renderModal({ tags: [makeTag({ id: 'tag-x', name: 'Personal' })] });
    await waitFor(() => expect(getBookmarkTagCounts).toHaveBeenCalledTimes(1));
  });

  it('does NOT call getBookmarkTagCounts when the modal is rendered with open=false', async () => {
    renderModal({ open: false, tags: [makeTag({ id: 'tag-x', name: 'Personal' })] });
    await new Promise((r) => setTimeout(r, 0));
    expect(getBookmarkTagCounts).not.toHaveBeenCalled();
  });

  it('falls back to 0 in the pill when getBookmarkTagCounts rejects (modal stays usable)', async () => {
    vi.mocked(getBookmarkTagCounts).mockRejectedValue(new Error('boom'));
    renderModal({ tags: [makeTag({ id: 'tag-x', name: 'Personal' })] });
    await waitFor(() =>
      expect(screen.getByLabelText('Used in 0 bookmarks')).toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Rename Personal')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete Personal')).toBeInTheDocument();
  });

  it('re-fetches counts when the modal is closed and re-opened', async () => {
    const { rerender } = render(
      <ManageTagsModal
        open={true}
        tags={[makeTag({ id: 'tag-x', name: 'Personal' })]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onTagDeleted={vi.fn()}
      />,
    );
    await waitFor(() => expect(getBookmarkTagCounts).toHaveBeenCalledTimes(1));

    rerender(
      <ManageTagsModal
        open={false}
        tags={[makeTag({ id: 'tag-x', name: 'Personal' })]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onTagDeleted={vi.fn()}
      />,
    );
    rerender(
      <ManageTagsModal
        open={true}
        tags={[makeTag({ id: 'tag-x', name: 'Personal' })]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onTagDeleted={vi.fn()}
      />,
    );
    await waitFor(() => expect(getBookmarkTagCounts).toHaveBeenCalledTimes(2));
  });

  it('clears usageByTagId on close so reopening never flashes stale counts', async () => {
    vi.mocked(getBookmarkTagCounts).mockResolvedValueOnce(new Map([['tag-x', 5]]));

    const { rerender } = render(
      <ManageTagsModal
        open={true}
        tags={[makeTag({ id: 'tag-x', name: 'Personal' })]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onTagDeleted={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Used in 5 bookmarks')).toBeInTheDocument(),
    );

    rerender(
      <ManageTagsModal
        open={false}
        tags={[makeTag({ id: 'tag-x', name: 'Personal' })]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onTagDeleted={vi.fn()}
      />,
    );

    // Reopen with a never-resolving fetch so any visible count must come from
    // local state. The fix clears state on close, so the pill must read 0.
    vi.mocked(getBookmarkTagCounts).mockImplementationOnce(
      () => new Promise<Map<string, number>>(() => {}),
    );
    rerender(
      <ManageTagsModal
        open={true}
        tags={[makeTag({ id: 'tag-x', name: 'Personal' })]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onTagDeleted={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('Used in 5 bookmarks')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Used in 0 bookmarks')).toBeInTheDocument();
  });

  it('aborts an in-flight count fetch when the modal closes', async () => {
    let receivedSignal: AbortSignal | undefined;
    vi.mocked(getBookmarkTagCounts).mockImplementation(async (options) => {
      receivedSignal = options?.signal;
      return new Promise<Map<string, number>>(() => {});
    });

    const { rerender } = render(
      <ManageTagsModal
        open={true}
        tags={[makeTag({ id: 'tag-x', name: 'Personal' })]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onTagDeleted={vi.fn()}
      />,
    );
    await waitFor(() => expect(receivedSignal).toBeDefined());
    expect(receivedSignal!.aborted).toBe(false);

    rerender(
      <ManageTagsModal
        open={false}
        tags={[makeTag({ id: 'tag-x', name: 'Personal' })]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onTagDeleted={vi.fn()}
      />,
    );

    expect(receivedSignal!.aborted).toBe(true);
  });
});
