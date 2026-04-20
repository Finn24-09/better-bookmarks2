import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportBookmarksModal } from './ImportBookmarksModal';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    cryptoKey: {} as CryptoKey,
    userId: 'user-1',
  }),
}));

vi.mock('../../lib/tags', () => ({
  getTags: vi.fn(),
  createTag: vi.fn(),
  setBookmarkTags: vi.fn(),
}));

vi.mock('../../lib/bookmarks', () => ({
  createBookmark: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks are declared
// ---------------------------------------------------------------------------

import { getTags, createTag, setBookmarkTags } from '../../lib/tags';
import { createBookmark } from '../../lib/bookmarks';

// ---------------------------------------------------------------------------
// CSV fixtures
// ---------------------------------------------------------------------------

const VALID_HEADER = '"ID","Title","URL","Description","Tags","Favicon URL","Thumbnail URL","Created At","Updated At"';

function makeCsv(...dataRows: string[]): File {
  const content = [VALID_HEADER, ...dataRows].join('\n');
  return new File([content], 'bookmarks.csv', { type: 'text/csv' });
}

const ROW_A = '"1","Bookmark A","https://example.com/a","","tag1|tag2","","","",""';
const ROW_B = '"2","Bookmark B","https://example.com/b","","tag2|tag3","","","",""';

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onImport: vi.fn(),
};

function renderModal(props = defaultProps) {
  return render(<ImportBookmarksModal {...props} />);
}

function pickFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTags).mockResolvedValue([]);
  vi.mocked(createTag).mockImplementation(async (name) => ({ id: `tag-${name}`, name }));
  vi.mocked(setBookmarkTags).mockResolvedValue(undefined);
  vi.mocked(createBookmark).mockResolvedValue({ id: 'bm-new' });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImportBookmarksModal', () => {
  it('renders file input and a "Choose CSV file" button in idle state', () => {
    renderModal();
    expect(screen.getByText(/choose csv file/i)).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeInTheDocument();
  });

  it('shows a format help toggle that reveals the required column list', async () => {
    renderModal();
    const toggle = screen.getByRole('button', { name: /what format/i });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByText(/required columns/i)).toBeInTheDocument();
    });
  });

  it('shows an error immediately when a non-.csv file is picked', async () => {
    renderModal();
    const txtFile = new File(['content'], 'bookmarks.txt', { type: 'text/plain' });
    pickFile(txtFile);
    await waitFor(() => {
      expect(screen.getByText(/must be a .csv file/i)).toBeInTheDocument();
    });
  });

  it('shows an error when the CSV is missing required columns', async () => {
    renderModal();
    const bad = new File(['"ID","Tags"\n"1","tag1"'], 'bookmarks.csv', { type: 'text/csv' });
    pickFile(bad);
    await waitFor(() => {
      expect(screen.getByText(/missing required columns/i)).toBeInTheDocument();
    });
  });

  it('shows a preview with the importable row count after a valid CSV is picked', async () => {
    renderModal();
    pickFile(makeCsv(ROW_A, ROW_B));
    await waitFor(() => {
      expect(screen.getByText(/ready to import/i)).toBeInTheDocument();
    });
  });

  it('lists skip reasons in the preview when some rows are invalid', async () => {
    renderModal();
    const badUrl = '"3","Title","ftp://bad","","","","","",""';
    pickFile(makeCsv(ROW_A, badUrl));
    await waitFor(() => {
      expect(screen.getByText(/ready to import/i)).toBeInTheDocument();
      expect(screen.getByText(/URL is invalid/i)).toBeInTheDocument();
    });
  });

  it('calls createBookmark once per valid row when Import is clicked', async () => {
    renderModal();
    pickFile(makeCsv(ROW_A, ROW_B));
    await waitFor(() => screen.getByRole('button', { name: /^import/i }));

    fireEvent.click(screen.getByRole('button', { name: /^import/i }));

    await waitFor(() => {
      expect(createBookmark).toHaveBeenCalledTimes(2);
    });
  });

  it('creates each unique tag name exactly once, even if shared across rows', async () => {
    renderModal();
    // ROW_A has tag1, tag2 — ROW_B has tag2, tag3 → 3 unique tags
    pickFile(makeCsv(ROW_A, ROW_B));
    await waitFor(() => screen.getByRole('button', { name: /^import/i }));

    fireEvent.click(screen.getByRole('button', { name: /^import/i }));

    await waitFor(() => {
      expect(createTag).toHaveBeenCalledTimes(3);
      const names = vi.mocked(createTag).mock.calls.map((c) => c[0]).sort();
      expect(names).toEqual(['tag1', 'tag2', 'tag3']);
    });
  });

  it('shows a progress indicator during import', async () => {
    // Make createBookmark slow so we can observe the in-progress state
    let resolveFirst!: (v: { id: string }) => void;
    vi.mocked(createBookmark)
      .mockImplementationOnce(() => new Promise((res) => { resolveFirst = res; }))
      .mockResolvedValue({ id: 'bm-2' });

    renderModal();
    pickFile(makeCsv(ROW_A, ROW_B));
    await waitFor(() => screen.getByRole('button', { name: /^import/i }));
    fireEvent.click(screen.getByRole('button', { name: /^import/i }));

    await waitFor(() => {
      expect(screen.getByText(/importing/i)).toBeInTheDocument();
    });

    resolveFirst({ id: 'bm-1' });
  });

  it('calls onImport after a successful import', async () => {
    const onImport = vi.fn();
    render(<ImportBookmarksModal open={true} onClose={vi.fn()} onImport={onImport} />);

    pickFile(makeCsv(ROW_A));
    await waitFor(() => screen.getByRole('button', { name: /^import/i }));
    fireEvent.click(screen.getByRole('button', { name: /^import/i }));

    await waitFor(() => {
      expect(onImport).toHaveBeenCalledTimes(1);
    });
  });

  it('resets to idle state when Cancel is clicked from the preview screen', async () => {
    renderModal();
    pickFile(makeCsv(ROW_A));
    await waitFor(() => screen.getByRole('button', { name: /cancel/i }));

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.getByText(/choose csv file/i)).toBeInTheDocument();
      expect(createBookmark).not.toHaveBeenCalled();
    });
  });
});
