import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExportBookmarksModal } from './ExportBookmarksModal';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ cryptoKey: {} as CryptoKey, userId: 'user-1' }),
}));

vi.mock('../../lib/export', () => ({
  exportBookmarks: vi.fn(),
  exportToCsv: vi.fn(() => 'title,url\r\n'),
  triggerDownload: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocks are declared
// ---------------------------------------------------------------------------

import { exportBookmarks, type ExportData, type ExportProgress } from '../../lib/export';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeData(count: number): ExportData {
  return {
    version: 1,
    exportedAt: '2026-01-01T00:00:00Z',
    totalBookmarks: count,
    bookmarks: Array.from({ length: count }, () => ({
      title: 'Test',
      url: 'https://example.com',
      tags: [],
      thumbnail: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    })),
  };
}

/**
 * Drive the mocked export so it reports `skipped` permanently-omitted
 * thumbnails through the progress channel, then resolves.
 */
function mockExportReporting(skipped: number, total = 5) {
  vi.mocked(exportBookmarks).mockImplementation(async (_key, _opts, onProgress) => {
    onProgress?.({
      phase: 'thumbnails',
      current: total,
      total,
      message: `Fetching thumbnail ${total} of ${total}`,
      skipped,
    } satisfies ExportProgress);
    return makeData(total);
  });
}

async function runExport() {
  render(<ExportBookmarksModal open onClose={() => {}} />);
  fireEvent.click(screen.getByLabelText(/I understand this file is not encrypted/i));
  fireEvent.click(screen.getByRole('button', { name: /^\s*Export\s*$/i }));
  await waitFor(() => expect(screen.getByText(/bookmarks exported/i)).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Incomplete-backup reporting
//
// The export used to swallow every failed thumbnail into `thumbnail: null` and
// still report an unqualified success, so a backup missing most of its images
// looked identical to a complete one.
// ---------------------------------------------------------------------------

describe('ExportBookmarksModal — incomplete backup reporting', () => {
  it('warns that thumbnails were omitted when the export skipped some', async () => {
    mockExportReporting(3);

    await runExport();

    expect(screen.getByText(/3 thumbnails could not be included/i)).toBeInTheDocument();
  });

  it('uses singular wording for a single omitted thumbnail', async () => {
    mockExportReporting(1);

    await runExport();

    expect(screen.getByText(/1 thumbnail could not be included/i)).toBeInTheDocument();
  });

  it('reports no warning when every thumbnail was included', async () => {
    mockExportReporting(0);

    await runExport();

    expect(screen.queryByText(/could not be included/i)).not.toBeInTheDocument();
  });

  it('does not carry a stale skipped count into a later clean export', async () => {
    mockExportReporting(2);
    const { unmount } = render(<ExportBookmarksModal open onClose={() => {}} />);
    unmount();

    mockExportReporting(0);
    await runExport();

    expect(screen.queryByText(/could not be included/i)).not.toBeInTheDocument();
  });
});
