import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { setupUser } from '../test/userEvent';
import { MemoryRouter } from 'react-router';
import App from './App';
import type { Bookmark } from '../lib/bookmarks';
import type { Tag } from '../lib/tags';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('./hooks/useBookmarks', () => ({
  useBookmarks: vi.fn(),
}));

vi.mock('./contexts/AuthContext', () => ({
  useAuth: () => ({
    cryptoKey: {} as CryptoKey,
    userId: 'user-1',
    email: 'user@example.com',
    partialRotation: null,
    logout: vi.fn(),
  }),
}));

// Partial mock (vi.importActual) keeps MAX_*_LENGTH exports intact; flat mock would silently disable BookmarkFormModal's maxLength validators (NaN attribute, "undefined characters or fewer" error string).
vi.mock('../lib/bookmarks', async () => {
  const actual = await vi.importActual<typeof import('../lib/bookmarks')>('../lib/bookmarks');
  return {
    ...actual,
    createBookmark: vi.fn(),
    updateBookmark: vi.fn(),
    deleteBookmark: vi.fn(),
    getBookmarks: vi.fn(),
  };
});

// Partial mock (vi.importActual) keeps real MAX_TAG_LENGTH export intact; flat mock would break TagMultiSelect's render-time length check (App transitively renders BookmarkFormModal → TagMultiSelect).
vi.mock('../lib/tags', async () => {
  const actual = await vi.importActual<typeof import('../lib/tags')>('../lib/tags');
  return {
    ...actual,
    createTag: vi.fn(),
    setBookmarkTags: vi.fn(),
    getTags: vi.fn(),
  };
});

// Header uses useNavigate for Log Out
vi.mock('react-router', async (importOriginal) => {
  const mod = await importOriginal<typeof import('react-router')>();
  return { ...mod, useNavigate: () => vi.fn() };
});

import { useBookmarks } from './hooks/useBookmarks';

// ---------------------------------------------------------------------------

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'bm-1',
    title: 'Test Bookmark',
    url: 'https://example.com',
    thumbnailUrl: null,
    thumbnailFileId: null,
    thumbnailOriginalName: null,
    tagIds: [],
    createdAt: '',
    updatedAt: '',
    keyVersion: 1,
    thumbnailKeyVersion: null,
    ...overrides,
  };
}

const BASE_TAGS: Tag[] = [{ id: 'tag-1', name: 'React' }];

const DEFAULT_HOOK: ReturnType<typeof useBookmarks> = {
  bookmarks: [],
  tags: [],
  isLoading: false,
  hasMore: false,
  isFiltered: false,
  error: null,
  loadMore: vi.fn(),
  refresh: vi.fn(),
};

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useBookmarks).mockReturnValue({ ...DEFAULT_HOOK });
  });

  function renderApp() {
    return render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
  }

  it('renders the "Better Bookmarks 2" heading via Header', () => {
    renderApp();
    expect(screen.getByText('Better Bookmarks 2')).toBeInTheDocument();
  });

  it('renders the SearchBar input', () => {
    renderApp();
    expect(screen.getByPlaceholderText('Search bookmarks...')).toBeInTheDocument();
  });

  it('shows a loading spinner while bookmarks are fetching', () => {
    vi.mocked(useBookmarks).mockReturnValue({ ...DEFAULT_HOOK, isLoading: true });
    renderApp();
    // The spinner is an animated div — check by its unique class
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('renders a card for each bookmark returned by useBookmarks', () => {
    vi.mocked(useBookmarks).mockReturnValue({
      ...DEFAULT_HOOK,
      bookmarks: [
        makeBookmark({ id: 'bm-1', title: 'First Bookmark' }),
        makeBookmark({ id: 'bm-2', title: 'Second Bookmark' }),
      ],
    });
    renderApp();
    expect(screen.getByText('First Bookmark')).toBeInTheDocument();
    expect(screen.getByText('Second Bookmark')).toBeInTheDocument();
  });

  it('shows a welcome banner when the list is empty and not filtered', () => {
    vi.mocked(useBookmarks).mockReturnValue({
      ...DEFAULT_HOOK,
      bookmarks: [],
      isFiltered: false,
    });
    renderApp();
    expect(screen.getByText('Welcome to Better Bookmarks')).toBeInTheDocument();
  });

  it('shows "No bookmarks match your search." when filtered with no results', () => {
    vi.mocked(useBookmarks).mockReturnValue({
      ...DEFAULT_HOOK,
      bookmarks: [],
      isFiltered: true,
    });
    renderApp();
    expect(screen.getByText('No bookmarks match your search.')).toBeInTheDocument();
  });

  it('clicking the Add Bookmark FAB opens the BookmarkFormModal', async () => {
    const user = setupUser();
    // Use a non-empty bookmark list so the welcome banner (which also has a
    // purple gradient button) is hidden, keeping the FAB selector unambiguous.
    vi.mocked(useBookmarks).mockReturnValue({
      ...DEFAULT_HOOK,
      bookmarks: [makeBookmark()],
      tags: BASE_TAGS,
    });
    renderApp();

    // FAB is the "+" button; BookmarkFormModal is not yet open
    expect(screen.queryByText('Add Bookmark')).not.toBeInTheDocument();

    const fabButton = screen.getByRole('button', { name: /add bookmark/i });
    await user.click(fabButton);

    await waitFor(() =>
      expect(screen.getByText('Add Bookmark')).toBeInTheDocument(),
    );
  });

  it('renders the scroll-to-top button (wired into the layout)', () => {
    renderApp();
    // Present in the DOM even though it is inert until the user scrolls.
    expect(screen.getByRole('button', { name: /scroll to top/i })).toBeInTheDocument();
  });

  it('clicking the edit pencil on a card opens BookmarkFormModal in edit mode', async () => {
    const user = setupUser();
    vi.mocked(useBookmarks).mockReturnValue({
      ...DEFAULT_HOOK,
      bookmarks: [makeBookmark({ id: 'bm-1', title: 'My Bookmark' })],
      tags: [],
    });
    renderApp();

    expect(screen.queryByText('Edit Bookmark')).not.toBeInTheDocument();

    const card = screen.getByText('My Bookmark').closest('.group') as HTMLElement;
    const editButton = card.querySelector('button[aria-label="Edit bookmark"]') as HTMLButtonElement;
    await user.click(editButton);

    await waitFor(() =>
      expect(screen.getByText('Edit Bookmark')).toBeInTheDocument(),
    );
  });
});
