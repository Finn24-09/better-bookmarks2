import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    logout: vi.fn(),
  }),
}));

vi.mock('../lib/bookmarks', () => ({
  createBookmark: vi.fn(),
  updateBookmark: vi.fn(),
  deleteBookmark: vi.fn(),
  getBookmarks: vi.fn(),
}));

vi.mock('../lib/tags', () => ({
  createTag: vi.fn(),
  setBookmarkTags: vi.fn(),
  getTags: vi.fn(),
}));

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
    tagIds: [],
    createdAt: '',
    updatedAt: '',
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

  it('shows "No bookmarks yet." when the list is empty and not filtered', () => {
    vi.mocked(useBookmarks).mockReturnValue({
      ...DEFAULT_HOOK,
      bookmarks: [],
      isFiltered: false,
    });
    renderApp();
    expect(screen.getByText('No bookmarks yet.')).toBeInTheDocument();
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
    const user = userEvent.setup();
    vi.mocked(useBookmarks).mockReturnValue({ ...DEFAULT_HOOK, tags: BASE_TAGS });
    renderApp();

    // FAB is the "+" button; BookmarkFormModal is not yet open
    expect(screen.queryByText('Add Bookmark')).not.toBeInTheDocument();

    // Find the circular FAB with a Plus icon (it has no text, but it's the only
    // button with the purple gradient class)
    const fabButton = document.querySelector('button.bg-gradient-to-br') as HTMLButtonElement;
    await user.click(fabButton);

    await waitFor(() =>
      expect(screen.getByText('Add Bookmark')).toBeInTheDocument(),
    );
  });

  it('clicking the edit pencil on a card opens BookmarkFormModal in edit mode', async () => {
    const user = userEvent.setup();
    vi.mocked(useBookmarks).mockReturnValue({
      ...DEFAULT_HOOK,
      bookmarks: [makeBookmark({ id: 'bm-1', title: 'My Bookmark' })],
      tags: [],
    });
    renderApp();

    expect(screen.queryByText('Edit Bookmark')).not.toBeInTheDocument();

    // Navigate to the card via its title, then pick the first button (Pencil).
    // The "Open bookmark" play buttons come after it and have aria-label set.
    const card = screen.getByText('My Bookmark').closest('.group') as HTMLElement;
    const editButton = card.querySelector('button:not([aria-label])') as HTMLButtonElement;
    await user.click(editButton);

    await waitFor(() =>
      expect(screen.getByText('Edit Bookmark')).toBeInTheDocument(),
    );
  });
});
