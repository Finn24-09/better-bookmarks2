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

// Partial mock (vi.importActual) keeps real MAX_TAG_LENGTH export intact; flat mock with a hardcoded value would silently lie if the constant ever changed.
vi.mock('../../lib/tags', async () => {
  const actual = await vi.importActual<typeof import('../../lib/tags')>('../../lib/tags');
  return {
    ...actual,
    getTags: vi.fn(),
    createTag: vi.fn(),
    setBookmarkTags: vi.fn(),
  };
});

// Partial mock (vi.importActual) keeps MAX_*_LENGTH exports intact; flat mock would set them undefined, breaking the slice(0, MAX_…) calls in importJson.ts (which this component imports transitively).
vi.mock('../../lib/bookmarks', async () => {
  const actual = await vi.importActual<typeof import('../../lib/bookmarks')>('../../lib/bookmarks');
  return {
    ...actual,
    createBookmark: vi.fn(),
  };
});

vi.mock('../../lib/thumbnails', () => ({
  uploadThumbnailFromBytes: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks are declared
// ---------------------------------------------------------------------------

import { getTags, createTag, setBookmarkTags } from '../../lib/tags';
import { createBookmark } from '../../lib/bookmarks';
import { uploadThumbnailFromBytes } from '../../lib/thumbnails';

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
// JSON fixtures
// ---------------------------------------------------------------------------

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const validJpegBase64 = btoa(String.fromCharCode(...JPEG_BYTES));
const validDataUri = `data:image/jpeg;base64,${validJpegBase64}`;

function makeJsonExport(bookmarks: unknown[] = [
  { title: 'JSON Bookmark', url: 'https://json.example.com', tags: ['a', 'b'], thumbnail: null },
]): File {
  const content = JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    totalBookmarks: bookmarks.length,
    bookmarks,
  });
  return new File([content], 'export.json', { type: 'application/json' });
}

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
  vi.mocked(uploadThumbnailFromBytes).mockResolvedValue('thumb-id-1');
});

// ---------------------------------------------------------------------------
// CSV tests (regression)
// ---------------------------------------------------------------------------

describe('ImportBookmarksModal — CSV', () => {
  it('renders file input and a "Choose a CSV or JSON file" button in idle state', () => {
    renderModal();
    expect(screen.getByText(/choose a csv or json file/i)).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeInTheDocument();
  });

  it('shows a format help toggle that reveals CSV and JSON format details', async () => {
    renderModal();
    const toggle = screen.getByRole('button', { name: /what file formats/i });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByText(/json \(recommended\)/i)).toBeInTheDocument();
      // "Required: Title, URL" text is unique to the CSV section
      expect(screen.getByText(/required:/i)).toBeInTheDocument();
    });
  });

  it('shows an error immediately when a non-csv/json file is picked', async () => {
    renderModal();
    const txtFile = new File(['content'], 'bookmarks.txt', { type: 'text/plain' });
    pickFile(txtFile);
    await waitFor(() => {
      expect(screen.getByText(/must be a .csv or .json file/i)).toBeInTheDocument();
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

  it('calls onImport after a successful CSV import', async () => {
    const onImport = vi.fn();
    render(<ImportBookmarksModal open={true} onClose={vi.fn()} onImport={onImport} />);

    pickFile(makeCsv(ROW_A));
    await waitFor(() => screen.getByRole('button', { name: /^import/i }));
    fireEvent.click(screen.getByRole('button', { name: /^import/i }));

    await waitFor(() => {
      expect(onImport).toHaveBeenCalledTimes(1);
    });
  });

  it('does not call uploadThumbnailFromBytes for CSV imports', async () => {
    renderModal();
    pickFile(makeCsv(ROW_A));
    await waitFor(() => screen.getByRole('button', { name: /^import/i }));
    fireEvent.click(screen.getByRole('button', { name: /^import/i }));

    await waitFor(() => {
      expect(createBookmark).toHaveBeenCalledTimes(1);
    });
    expect(uploadThumbnailFromBytes).not.toHaveBeenCalled();
  });

  it('resets to idle state when Cancel is clicked from the preview screen', async () => {
    renderModal();
    pickFile(makeCsv(ROW_A));
    await waitFor(() => screen.getByRole('button', { name: /cancel/i }));

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.getByText(/choose a csv or json file/i)).toBeInTheDocument();
      expect(createBookmark).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// JSON tests
// ---------------------------------------------------------------------------

describe('ImportBookmarksModal — JSON', () => {
  it('shows an error when an invalid JSON file is picked', async () => {
    renderModal();
    const bad = new File(['not json {{{'], 'export.json', { type: 'application/json' });
    pickFile(bad);
    await waitFor(() => {
      expect(screen.getByText(/not valid json/i)).toBeInTheDocument();
    });
  });

  it('shows an error when the JSON file has the wrong version', async () => {
    renderModal();
    const bad = new File(
      [JSON.stringify({ version: 2, bookmarks: [] })],
      'export.json',
    );
    pickFile(bad);
    await waitFor(() => {
      expect(screen.getByText(/version/i)).toBeInTheDocument();
    });
  });

  it('shows a preview with the importable bookmark count after a valid JSON is picked', async () => {
    renderModal();
    pickFile(makeJsonExport());
    await waitFor(() => {
      expect(screen.getByText(/ready to import/i)).toBeInTheDocument();
      // The import button also shows the count — unique and unambiguous
      expect(screen.getByRole('button', { name: /import 1 bookmark/i })).toBeInTheDocument();
    });
  });

  it('shows thumbnail note in preview when JSON bookmarks have embedded thumbnail data', async () => {
    renderModal();
    pickFile(makeJsonExport([
      { title: 'T', url: 'https://example.com', tags: [], thumbnail: { type: 'data', value: validDataUri, originalName: 'thumb.jpg' } },
    ]));
    await waitFor(() => {
      expect(screen.getByText(/thumbnail images will be encrypted/i)).toBeInTheDocument();
    });
  });

  it('calls createBookmark once per valid JSON bookmark', async () => {
    renderModal();
    pickFile(makeJsonExport([
      { title: 'A', url: 'https://a.com', tags: [], thumbnail: null },
      { title: 'B', url: 'https://b.com', tags: [], thumbnail: null },
    ]));
    await waitFor(() => screen.getByRole('button', { name: /^import/i }));
    fireEvent.click(screen.getByRole('button', { name: /^import/i }));

    await waitFor(() => {
      expect(createBookmark).toHaveBeenCalledTimes(2);
    });
  });

  it('calls uploadThumbnailFromBytes for each bookmark with embedded JPEG data', async () => {
    renderModal();
    pickFile(makeJsonExport([
      { title: 'T', url: 'https://example.com', tags: [], thumbnail: { type: 'data', value: validDataUri, originalName: 'pic.jpg' } },
    ]));
    await waitFor(() => screen.getByRole('button', { name: /^import/i }));
    fireEvent.click(screen.getByRole('button', { name: /^import/i }));

    await waitFor(() => {
      expect(uploadThumbnailFromBytes).toHaveBeenCalledTimes(1);
      expect(uploadThumbnailFromBytes).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        'pic.jpg',
        expect.anything(),
        'user-1',
      );
    });
  });

  it('passes the uploaded thumbnail file ID to createBookmark', async () => {
    vi.mocked(uploadThumbnailFromBytes).mockResolvedValue('uploaded-thumb-id');
    renderModal();
    pickFile(makeJsonExport([
      { title: 'T', url: 'https://example.com', tags: [], thumbnail: { type: 'data', value: validDataUri, originalName: 'pic.jpg' } },
    ]));
    await waitFor(() => screen.getByRole('button', { name: /^import/i }));
    fireEvent.click(screen.getByRole('button', { name: /^import/i }));

    await waitFor(() => {
      expect(createBookmark).toHaveBeenCalledWith(
        expect.objectContaining({ thumbnailFileId: 'uploaded-thumb-id', thumbnailUrl: null }),
        expect.anything(),
        'user-1',
      );
    });
  });

  it('still creates the bookmark if thumbnail upload fails', async () => {
    vi.mocked(uploadThumbnailFromBytes).mockRejectedValue(new Error('Upload failed'));
    renderModal();
    pickFile(makeJsonExport([
      { title: 'T', url: 'https://example.com', tags: [], thumbnail: { type: 'data', value: validDataUri, originalName: 'pic.jpg' } },
    ]));
    await waitFor(() => screen.getByRole('button', { name: /^import/i }));
    fireEvent.click(screen.getByRole('button', { name: /^import/i }));

    await waitFor(() => {
      expect(createBookmark).toHaveBeenCalledTimes(1);
      expect(createBookmark).toHaveBeenCalledWith(
        expect.objectContaining({ thumbnailFileId: null }),
        expect.anything(),
        'user-1',
      );
    });
  });

  it('does not call uploadThumbnailFromBytes for URL-type thumbnails', async () => {
    renderModal();
    pickFile(makeJsonExport([
      { title: 'T', url: 'https://example.com', tags: [], thumbnail: { type: 'url', value: 'https://img.example.com/pic.jpg' } },
    ]));
    await waitFor(() => screen.getByRole('button', { name: /^import/i }));
    fireEvent.click(screen.getByRole('button', { name: /^import/i }));

    await waitFor(() => {
      expect(createBookmark).toHaveBeenCalledTimes(1);
    });
    expect(uploadThumbnailFromBytes).not.toHaveBeenCalled();
  });

  it('calls onImport after a successful JSON import', async () => {
    const onImport = vi.fn();
    render(<ImportBookmarksModal open={true} onClose={vi.fn()} onImport={onImport} />);

    pickFile(makeJsonExport());
    await waitFor(() => screen.getByRole('button', { name: /^import/i }));
    fireEvent.click(screen.getByRole('button', { name: /^import/i }));

    await waitFor(() => {
      expect(onImport).toHaveBeenCalledTimes(1);
    });
  });
});
