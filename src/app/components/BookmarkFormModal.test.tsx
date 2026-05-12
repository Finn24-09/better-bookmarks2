import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

// Partial mock (vi.importActual) keeps real MAX_*_LENGTH exports intact; flat mock would set them undefined and silently disable the maxLength validators (NaN attribute + "undefined characters or fewer" error string).
vi.mock('../../lib/bookmarks', async () => {
  const actual = await vi.importActual<typeof import('../../lib/bookmarks')>('../../lib/bookmarks');
  return {
    ...actual,
    createBookmark: vi.fn(),
    updateBookmark: vi.fn(),
    deleteBookmark: vi.fn(),
  };
});

// Partial mock (vi.importActual) keeps real MAX_TAG_LENGTH export intact; flat mock would break TagMultiSelect's render-time length check.
vi.mock('../../lib/tags', async () => {
  const actual = await vi.importActual<typeof import('../../lib/tags')>('../../lib/tags');
  return {
    ...actual,
    createTag: vi.fn(),
    setBookmarkTags: vi.fn(),
  };
});

vi.mock('../../lib/thumbnails', () => ({
  uploadThumbnail: vi.fn(),
  deleteThumbnailImage: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock('../../lib/titleFetch', () => ({
  fetchBookmarkTitle: vi.fn(),
  TitleFetchError: class TitleFetchError extends Error {
    constructor(public kind: string) { super(kind); }
  },
}));

import { createBookmark, updateBookmark, deleteBookmark } from '../../lib/bookmarks';
import { setBookmarkTags } from '../../lib/tags';
import { uploadThumbnail, deleteThumbnailImage } from '../../lib/thumbnails';
import { fetchBookmarkTitle, TitleFetchError } from '../../lib/titleFetch';
import { toast } from 'sonner';

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
  thumbnailFileId: null,
  thumbnailOriginalName: null,
  tagIds: [] as string[],
};

const EDIT_DATA_WITH_FILE = {
  id: 'bm-2',
  title: 'File Thumb Bookmark',
  url: 'https://example.com',
  thumbnailUrl: null,
  thumbnailFileId: 'img-existing',
  thumbnailOriginalName: 'existing-photo.jpg',
  tagIds: [] as string[],
};

describe('BookmarkFormModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(setBookmarkTags).mockResolvedValue(undefined as never);
    vi.mocked(deleteThumbnailImage).mockResolvedValue(undefined as never);
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
    let resolveFn!: (v: { id: string } | PromiseLike<{ id: string }>) => void;
    vi.mocked(createBookmark).mockImplementation(
      () => new Promise<{ id: string }>((res) => { resolveFn = res; }),
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

  it('shows a toast error when createBookmark rejects', async () => {
    vi.mocked(createBookmark).mockRejectedValue(new Error('Server error'));
    const user = userEvent.setup();
    renderAdd();

    await user.type(screen.getByPlaceholderText('Enter bookmark title\u2026'), 'Test');
    await user.type(screen.getAllByPlaceholderText('https://\u2026')[0], 'https://example.com');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Server error'),
    );
  });

  // -------------------------------------------------------------------------
  // Thumbnail file upload
  // -------------------------------------------------------------------------

  it('shows an "Upload image" button in the thumbnail section', () => {
    renderAdd();
    expect(screen.getByRole('button', { name: /upload image/i })).toBeInTheDocument();
  });

  it('after uploading a file, shows the filename chip and hides the URL input', async () => {
    vi.mocked(uploadThumbnail).mockResolvedValue('img-new');
    renderAdd();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['fake'], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('photo.jpg')).toBeInTheDocument();
      // Thumbnail URL input should be gone (only the main bookmark URL remains)
      expect(screen.queryAllByPlaceholderText('https://\u2026')).toHaveLength(1);
    });
  });

  it('clicking Remove deletes the uploaded file and shows the URL input again', async () => {
    vi.mocked(uploadThumbnail).mockResolvedValue('img-new');
    const user = userEvent.setup();
    renderAdd();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['fake'], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText('photo.jpg')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /remove/i }));

    await waitFor(() => {
      expect(deleteThumbnailImage).toHaveBeenCalledWith('img-new');
      expect(screen.queryAllByPlaceholderText('https://\u2026')).toHaveLength(2);
    });
  });

  it('when initialData has thumbnailFileId, shows the filename chip instead of URL input', () => {
    render(
      <BookmarkFormModal
        open={true}
        onClose={vi.fn()}
        initialData={EDIT_DATA_WITH_FILE}
        availableTags={AVAILABLE_TAGS}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText('existing-photo.jpg')).toBeInTheDocument();
    expect(screen.queryAllByPlaceholderText('https://\u2026')).toHaveLength(1);
  });

  it('saving in file mode passes thumbnailFileId and null thumbnailUrl to createBookmark', async () => {
    vi.mocked(uploadThumbnail).mockResolvedValue('img-uploaded');
    vi.mocked(createBookmark).mockResolvedValue({ id: 'new-bm' } as never);
    const user = userEvent.setup();
    renderAdd();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['fake'], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('photo.jpg')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('Enter bookmark title\u2026'), 'New Title');
    await user.type(screen.getAllByPlaceholderText('https://\u2026')[0], 'https://example.com');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(createBookmark).toHaveBeenCalledWith(
        expect.objectContaining({ thumbnailFileId: 'img-uploaded', thumbnailUrl: null }),
        expect.any(Object),
        'user-1',
      );
    });
  });

  it('closing the modal after a new upload calls deleteThumbnailImage (cleanup)', async () => {
    vi.mocked(uploadThumbnail).mockResolvedValue('img-cleanup');
    const user = userEvent.setup();
    renderAdd();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['fake'], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText('photo.jpg')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    await waitFor(() => {
      expect(deleteThumbnailImage).toHaveBeenCalledWith('img-cleanup');
    });
  });

  it('uploading a replacement file deletes the previously uploaded pending file', async () => {
    vi.mocked(uploadThumbnail)
      .mockResolvedValueOnce('img-first')
      .mockResolvedValueOnce('img-second');
    renderAdd();

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    // First upload
    fireEvent.change(fileInput, { target: { files: [new File(['f1'], 'photo1.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(screen.getByText('photo1.jpg')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: /replace/i })).toBeInTheDocument();

    // Second upload (replace)
    fireEvent.change(fileInput, { target: { files: [new File(['f2'], 'photo2.jpg', { type: 'image/jpeg' })] } });

    await waitFor(() => {
      expect(deleteThumbnailImage).toHaveBeenCalledWith('img-first');
      expect(screen.getByText('photo2.jpg')).toBeInTheDocument();
    });
  });

  it('deleting a bookmark that has a thumbnailFileId also deletes the image', async () => {
    vi.mocked(deleteBookmark).mockResolvedValue(undefined as never);
    const user = userEvent.setup();
    render(
      <BookmarkFormModal
        open={true}
        onClose={vi.fn()}
        initialData={EDIT_DATA_WITH_FILE}
        availableTags={AVAILABLE_TAGS}
        onSave={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      expect(deleteBookmark).toHaveBeenCalledWith('bm-2');
      expect(deleteThumbnailImage).toHaveBeenCalledWith('img-existing');
    });
  });

  it('shows inline error when title exceeds MAX_TITLE_LENGTH instead of submitting', async () => {
    render(<BookmarkFormModal open onClose={() => {}} availableTags={AVAILABLE_TAGS} onSave={() => {}} />);

    // The HTML maxLength on the input is MAX_TITLE_LENGTH + 1 = 501, so a 501-char
    // value can be set; one over the validator's cap so the inline error fires.
    fireEvent.change(screen.getByPlaceholderText('Enter bookmark title\u2026'), {
      target: { value: 'a'.repeat(501) },
    });
    // Required URL too, otherwise required validator wins ahead of maxLength.
    // getAllByPlaceholderText(...)[0] mirrors the existing tests in this file —
    // the URL field and the thumbnailUrl field share the placeholder
    // 'https://\u2026' so getByPlaceholderText would throw.
    fireEvent.change(screen.getAllByPlaceholderText('https://\u2026')[0], {
      target: { value: 'https://example.com' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/500 characters or fewer/i)).toBeInTheDocument();
    expect(createBookmark).not.toHaveBeenCalled();
  });

  it('shows inline error when URL exceeds MAX_URL_LENGTH instead of submitting', async () => {
    render(<BookmarkFormModal open onClose={() => {}} availableTags={AVAILABLE_TAGS} onSave={() => {}} />);

    // Title is required — provide a valid one so the URL maxLength validator
    // is what fires, not the title required check.
    fireEvent.change(screen.getByPlaceholderText('Enter bookmark title\u2026'), {
      target: { value: 'A title' },
    });

    // Build a 2001-char URL. The HTML maxLength on the input is
    // MAX_URL_LENGTH + 1 = 2001, so the value can be set; one over the
    // validator's cap so the inline error fires. The leading 'https://'
    // ensures the value would otherwise pass the URL-format validator —
    // the test thereby also confirms that react-hook-form runs maxLength
    // before validate (the documented rule order).
    const longUrl = 'https://example.com/' + 'a'.repeat(1981);
    expect(longUrl.length).toBe(2001);
    fireEvent.change(screen.getAllByPlaceholderText('https://\u2026')[0], {
      target: { value: longUrl },
    });

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/2000 characters or fewer/i)).toBeInTheDocument();
    expect(createBookmark).not.toHaveBeenCalled();
  });

  it('shows inline error when thumbnail URL exceeds MAX_URL_LENGTH instead of submitting', async () => {
    render(<BookmarkFormModal open onClose={() => {}} availableTags={AVAILABLE_TAGS} onSave={() => {}} />);

    // Title and URL are required for submit to even reach the thumbnail field's
    // validators — provide valid values for both.
    fireEvent.change(screen.getByPlaceholderText('Enter bookmark title\u2026'), {
      target: { value: 'A title' },
    });
    const inputs = screen.getAllByPlaceholderText('https://\u2026');
    fireEvent.change(inputs[0], { target: { value: 'https://example.com' } });

    // Thumbnail URL field is the second input with the 'https://\u2026' placeholder
    // (URL field is first). 'https://thumb.example.com/' is 26 chars;
    // 26 + 1975 = 2001 — one over MAX_URL_LENGTH so the validator fires.
    const longThumb = 'https://thumb.example.com/' + 'a'.repeat(1975);
    expect(longThumb.length).toBe(2001);
    fireEvent.change(inputs[1], { target: { value: longThumb } });

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/2000 characters or fewer/i)).toBeInTheDocument();
    expect(createBookmark).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Auto-fill title button (metadata-fetcher integration)
  // ---------------------------------------------------------------------------
  describe('auto-fill title button', () => {
    it('hidden when URL field is empty', () => {
      renderAdd();
      expect(screen.queryByRole('button', { name: /auto-fill title/i })).not.toBeInTheDocument();
    });

    it('hidden when URL is malformed (fails RHF validate)', async () => {
      renderAdd();
      const url = screen.getAllByPlaceholderText('https://…')[0];
      fireEvent.change(url, { target: { value: 'not-a-url' } });
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: /auto-fill title/i })).not.toBeInTheDocument(),
      );
    });

    it('visible when URL is a valid http(s) value', () => {
      renderAdd();
      const url = screen.getAllByPlaceholderText('https://…')[0];
      fireEvent.change(url, { target: { value: 'https://example.com' } });
      expect(screen.getByRole('button', { name: /auto-fill title/i })).toBeInTheDocument();
    });

    it('on success: fills the title field via setValue', async () => {
      vi.mocked(fetchBookmarkTitle).mockResolvedValueOnce('Fetched Title');
      renderAdd();
      const url = screen.getAllByPlaceholderText('https://…')[0];
      fireEvent.change(url, { target: { value: 'https://example.com' } });
      fireEvent.click(screen.getByRole('button', { name: /auto-fill title/i }));
      const title = screen.getByPlaceholderText('Enter bookmark title…') as HTMLInputElement;
      await waitFor(() => expect(title.value).toBe('Fetched Title'));
    });

    it('on null title: shows info toast, field unchanged', async () => {
      vi.mocked(fetchBookmarkTitle).mockResolvedValueOnce(null);
      renderAdd();
      const url = screen.getAllByPlaceholderText('https://…')[0];
      fireEvent.change(url, { target: { value: 'https://example.com' } });
      const title = screen.getByPlaceholderText('Enter bookmark title…') as HTMLInputElement;
      fireEvent.change(title, { target: { value: 'kept' } });
      fireEvent.click(screen.getByRole('button', { name: /auto-fill title/i }));
      await waitFor(() => expect(toast.info).toHaveBeenCalled());
      expect(title.value).toBe('kept');
    });

    it('on TitleFetchError(non-aborted): shows error toast, field unchanged', async () => {
      vi.mocked(fetchBookmarkTitle).mockRejectedValueOnce(new TitleFetchError('upstream'));
      renderAdd();
      const url = screen.getAllByPlaceholderText('https://…')[0];
      fireEvent.change(url, { target: { value: 'https://example.com' } });
      const title = screen.getByPlaceholderText('Enter bookmark title…') as HTMLInputElement;
      fireEvent.change(title, { target: { value: 'kept' } });
      fireEvent.click(screen.getByRole('button', { name: /auto-fill title/i }));
      await waitFor(() => expect(toast.error).toHaveBeenCalled());
      expect(title.value).toBe('kept');
    });

    it('on aborted: no toast (intentional cancel)', async () => {
      vi.mocked(fetchBookmarkTitle).mockRejectedValueOnce(new TitleFetchError('aborted'));
      renderAdd();
      const url = screen.getAllByPlaceholderText('https://…')[0];
      fireEvent.change(url, { target: { value: 'https://example.com' } });
      fireEvent.click(screen.getByRole('button', { name: /auto-fill title/i }));
      await new Promise(r => setTimeout(r, 20));
      expect(toast.error).not.toHaveBeenCalled();
      expect(toast.info).not.toHaveBeenCalled();
    });

    it('graceful degradation: modal still saves when fetchBookmarkTitle keeps failing', async () => {
      vi.mocked(fetchBookmarkTitle).mockRejectedValue(new TitleFetchError('service-down'));
      const onSave = vi.fn();
      const onClose = vi.fn();
      renderAdd({ onSave, onClose });
      fireEvent.change(screen.getByPlaceholderText('Enter bookmark title…'), {
        target: { value: 'Manual Title' },
      });
      const url = screen.getAllByPlaceholderText('https://…')[0];
      fireEvent.change(url, { target: { value: 'https://example.com' } });
      fireEvent.click(screen.getByRole('button', { name: /auto-fill title/i }));
      await waitFor(() => expect(toast.error).toHaveBeenCalled());
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(createBookmark).toHaveBeenCalled();
    });
  });
});
