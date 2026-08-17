import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { setupUser } from '../../test/userEvent';
import { RecoveryModal } from './RecoveryModal';
import type { BookmarkRow } from '../../lib/bookmarks';
import type { TagRow } from '../../lib/tags';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const mockUpdateKey = vi.hoisted(() => vi.fn());
const mockClearPartialRotation = vi.hoisted(() => vi.fn());
const mockCryptoKey = vi.hoisted(() => ({} as CryptoKey));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    email: 'user@example.com',
    cryptoKey: mockCryptoKey,
    updateKey: mockUpdateKey,
    clearPartialRotation: mockClearPartialRotation,
  }),
}));

vi.mock('../../lib/auth', () => ({
  signIn: vi.fn(),
  changePassword: vi.fn(),
  rotationStatus: vi.fn(),
}));

vi.mock('../../lib/crypto', () => ({
  deriveKey: vi.fn(),
  decrypt: vi.fn().mockResolvedValue('decrypted-name'),
}));

vi.mock('../../lib/bookmarks', () => ({
  getBookmarkRows: vi.fn(),
  reencryptBookmark: vi.fn(),
  decryptBookmark: vi.fn(),
}));

vi.mock('../../lib/tags', () => ({
  getTagRows: vi.fn(),
  reencryptTag: vi.fn(),
}));

vi.mock('../../lib/thumbnails', () => ({
  reencryptThumbnailBatchToBodies: vi.fn(),
  writeReencryptedThumbnail: vi.fn(),
}));

// Keep the real ApiError: utils.ts classifies retryable failures with
// `err instanceof ApiError`, and a wholesale mock strips it — turning that
// check into a vitest "no export defined" throw that can make a test pass for
// entirely the wrong reason.
vi.mock('../../lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/api')>();
  return { ...mod, apiFetch: vi.fn().mockResolvedValue(undefined) };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { signIn, changePassword, rotationStatus } from '../../lib/auth';
import { deriveKey } from '../../lib/crypto';
import { getBookmarkRows, reencryptBookmark, decryptBookmark } from '../../lib/bookmarks';
import { getTagRows, reencryptTag } from '../../lib/tags';
import { reencryptThumbnailBatchToBodies, writeReencryptedThumbnail } from '../../lib/thumbnails';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBookmarkRow(overrides: Partial<BookmarkRow> = {}): BookmarkRow {
  return {
    id: 'bm-1', user_id: 'u', title_enc: 'te', url_enc: 'ue',
    thumbnail_url_enc: null, thumbnail_file_id: null, thumbnail_original_name_enc: null,
    created_at: '', updated_at: '', tag_ids: [],
    key_version: 1, thumbnail_key_version: null,
    ...overrides,
  };
}

function makeTagRow(overrides: Partial<TagRow> = {}): TagRow {
  return {
    id: 'tag-1', user_id: 'u', name_enc: 'ne', name_hmac: 'nh',
    created_at: '', key_version: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('RecoveryModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(signIn).mockResolvedValue({ token: 't', user_id: 'u' } as never);
    vi.mocked(changePassword).mockResolvedValue(undefined as never);
    vi.mocked(rotationStatus).mockResolvedValue({ keyVersion: 1, hasStaleRecords: true });
    vi.mocked(deriveKey).mockResolvedValue({} as CryptoKey);
    vi.mocked(getBookmarkRows).mockResolvedValue([]);
    vi.mocked(getTagRows).mockResolvedValue([]);
    vi.mocked(reencryptBookmark).mockResolvedValue(undefined);
    vi.mocked(reencryptTag).mockResolvedValue(undefined);
    vi.mocked(decryptBookmark).mockResolvedValue({
      id: 'bm-1', title: 'Test', url: 'https://a.com',
      thumbnailUrl: null, thumbnailFileId: null, thumbnailOriginalName: null,
      tagIds: [], createdAt: '', updatedAt: '', keyVersion: 1, thumbnailKeyVersion: null,
    });
    vi.mocked(reencryptThumbnailBatchToBodies).mockImplementation(async (ids) =>
      ids.map((imageId) => ({ imageId, data_enc: 'enc', original_name_enc: 'encn' })),
    );
    vi.mocked(writeReencryptedThumbnail).mockResolvedValue(undefined);
  });

  function renderModal(keyVersion = 2) {
    return render(<RecoveryModal keyVersion={keyVersion} />);
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  it('renders a heading that explains a partial rotation occurred', () => {
    renderModal();
    expect(screen.getByRole('heading')).toBeInTheDocument();
  });

  it('renders current password and new password fields', () => {
    renderModal();
    expect(screen.getByPlaceholderText(/current password/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/new password/i)).toBeInTheDocument();
  });

  it('renders a "Recover" submit button', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /recover/i })).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------
  it('submitting empty form shows "Required" errors on both fields', async () => {
    const user = setupUser();
    renderModal();
    await user.click(screen.getByRole('button', { name: /recover/i }));
    await waitFor(() => {
      expect(screen.getAllByText('Required')).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Pre-flight signIn
  // -------------------------------------------------------------------------
  it('calls signIn pre-flight with the current password', async () => {
    const user = setupUser();
    renderModal();
    await user.type(screen.getByPlaceholderText(/current password/i), 'OldPass123!');
    await user.type(screen.getByPlaceholderText(/new password/i), 'NewPass456@');
    await user.click(screen.getByRole('button', { name: /recover/i }));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('user@example.com', 'OldPass123!'));
  });

  it('shows toast error when signIn rejects', async () => {
    vi.mocked(signIn).mockRejectedValue(new Error('Wrong password'));
    const user = setupUser();
    renderModal();
    await user.type(screen.getByPlaceholderText(/current password/i), 'wrong');
    await user.type(screen.getByPlaceholderText(/new password/i), 'NewPass456@');
    await user.click(screen.getByRole('button', { name: /recover/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Wrong password'));
  });

  // -------------------------------------------------------------------------
  // Already complete (no stale records)
  // -------------------------------------------------------------------------
  it('skips re-encryption when rotationStatus returns hasStaleRecords: false', async () => {
    vi.mocked(rotationStatus).mockResolvedValue({ keyVersion: 2, hasStaleRecords: false });
    const user = setupUser();
    renderModal();
    await user.type(screen.getByPlaceholderText(/current password/i), 'OldPass123!');
    await user.type(screen.getByPlaceholderText(/new password/i), 'NewPass456@');
    await user.click(screen.getByRole('button', { name: /recover/i }));
    await waitFor(() => expect(changePassword).toHaveBeenCalled());
    expect(reencryptBookmark).not.toHaveBeenCalled();
    expect(reencryptTag).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Stale row re-encryption
  // -------------------------------------------------------------------------
  it('re-encrypts only rows where key_version < targetVersion', async () => {
    const newKey = {} as CryptoKey;
    vi.mocked(deriveKey).mockResolvedValue(newKey);
    vi.mocked(rotationStatus).mockResolvedValue({ keyVersion: 1, hasStaleRecords: true });
    // One stale, one already done
    const staleRow = makeBookmarkRow({ id: 'bm-1', key_version: 1 });
    const doneRow  = makeBookmarkRow({ id: 'bm-2', key_version: 2 });
    vi.mocked(getBookmarkRows).mockResolvedValue([staleRow, doneRow]);

    const user = setupUser();
    renderModal(2);
    await user.type(screen.getByPlaceholderText(/current password/i), 'OldPass123!');
    await user.type(screen.getByPlaceholderText(/new password/i), 'NewPass456@');
    await user.click(screen.getByRole('button', { name: /recover/i }));

    await waitFor(() => {
      // Only bm-1 should be re-encrypted
      expect(reencryptBookmark).toHaveBeenCalledTimes(1);
      const [firstArg] = vi.mocked(reencryptBookmark).mock.calls[0];
      expect((firstArg as { id: string }).id).toBe('bm-1');
    });
  });

  it('skips rows where key_version === targetVersion', async () => {
    vi.mocked(rotationStatus).mockResolvedValue({ keyVersion: 1, hasStaleRecords: true });
    const doneRow = makeBookmarkRow({ id: 'bm-1', key_version: 2 });
    vi.mocked(getBookmarkRows).mockResolvedValue([doneRow]);

    const user = setupUser();
    renderModal(2);
    await user.type(screen.getByPlaceholderText(/current password/i), 'OldPass123!');
    await user.type(screen.getByPlaceholderText(/new password/i), 'NewPass456@');
    await user.click(screen.getByRole('button', { name: /recover/i }));

    await waitFor(() => expect(changePassword).toHaveBeenCalled());
    expect(reencryptBookmark).not.toHaveBeenCalled();
  });

  it('re-encrypts only stale tags', async () => {
    const newKey = {} as CryptoKey;
    vi.mocked(deriveKey).mockResolvedValue(newKey);
    vi.mocked(rotationStatus).mockResolvedValue({ keyVersion: 1, hasStaleRecords: true });
    const staleTag = makeTagRow({ id: 'tag-1', key_version: 1 });
    const doneTag  = makeTagRow({ id: 'tag-2', key_version: 2 });
    vi.mocked(getTagRows).mockResolvedValue([staleTag, doneTag]);

    const user = setupUser();
    renderModal(2);
    await user.type(screen.getByPlaceholderText(/current password/i), 'OldPass123!');
    await user.type(screen.getByPlaceholderText(/new password/i), 'NewPass456@');
    await user.click(screen.getByRole('button', { name: /recover/i }));

    await waitFor(() => {
      expect(reencryptTag).toHaveBeenCalledTimes(1);
      expect(vi.mocked(reencryptTag).mock.calls[0][0]).toBe('tag-1');
    });
  });

  // -------------------------------------------------------------------------
  // Thumbnail re-encryption
  // -------------------------------------------------------------------------
  it('reads only stale thumbnails, in a single batched request', async () => {
    const newKey = {} as CryptoKey;
    vi.mocked(deriveKey).mockResolvedValue(newKey);
    vi.mocked(rotationStatus).mockResolvedValue({ keyVersion: 1, hasStaleRecords: true });
    const staleBm = makeBookmarkRow({ id: 'bm-1', key_version: 1, thumbnail_file_id: 'img-1', thumbnail_key_version: 1 });
    const doneBm  = makeBookmarkRow({ id: 'bm-2', key_version: 2, thumbnail_file_id: 'img-2', thumbnail_key_version: 2 });
    vi.mocked(getBookmarkRows).mockResolvedValue([staleBm, doneBm]);

    const user = setupUser();
    renderModal(2);
    await user.type(screen.getByPlaceholderText(/current password/i), 'OldPass123!');
    await user.type(screen.getByPlaceholderText(/new password/i), 'NewPass456@');
    await user.click(screen.getByRole('button', { name: /recover/i }));

    await waitFor(() => {
      expect(reencryptThumbnailBatchToBodies).toHaveBeenCalledTimes(1);
      // img-2 is already at the target version — re-encrypting it with a
      // freshly derived key would strand it.
      expect(reencryptThumbnailBatchToBodies).toHaveBeenCalledWith(
        ['img-1'],
        mockCryptoKey,
        newKey,
        undefined,
      );
    });
  });

  it('stamps targetVersion on the thumbnail write', async () => {
    vi.mocked(rotationStatus).mockResolvedValue({ keyVersion: 1, hasStaleRecords: true });
    const staleBm = makeBookmarkRow({ id: 'bm-1', key_version: 1, thumbnail_file_id: 'img-1', thumbnail_key_version: 1 });
    vi.mocked(getBookmarkRows).mockResolvedValue([staleBm]);

    const user = setupUser();
    renderModal(2);
    await user.type(screen.getByPlaceholderText(/current password/i), 'OldPass123!');
    await user.type(screen.getByPlaceholderText(/new password/i), 'NewPass456@');
    await user.click(screen.getByRole('button', { name: /recover/i }));

    await waitFor(() => {
      expect(writeReencryptedThumbnail).toHaveBeenCalledWith(
        expect.objectContaining({ imageId: 'img-1' }),
        2,
      );
    });
  });

  it('writes nothing when the stale thumbnail read fails', async () => {
    vi.mocked(rotationStatus).mockResolvedValue({ keyVersion: 1, hasStaleRecords: true });
    const staleBm = makeBookmarkRow({ id: 'bm-1', key_version: 1, thumbnail_file_id: 'img-1', thumbnail_key_version: 1 });
    vi.mocked(getBookmarkRows).mockResolvedValue([staleBm]);
    vi.mocked(reencryptThumbnailBatchToBodies).mockRejectedValue(new Error('read failed'));

    const user = setupUser();
    renderModal(2);
    await user.type(screen.getByPlaceholderText(/current password/i), 'OldPass123!');
    await user.type(screen.getByPlaceholderText(/new password/i), 'NewPass456@');
    await user.click(screen.getByRole('button', { name: /recover/i }));

    // Recovery must not half-apply: the modal exists to repair exactly this
    // state, so it cannot be allowed to deepen it.
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    expect(reencryptBookmark).not.toHaveBeenCalled();
    expect(writeReencryptedThumbnail).not.toHaveBeenCalled();
    expect(changePassword).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Completion
  // -------------------------------------------------------------------------
  it('calls changePassword after all re-encryption', async () => {
    const user = setupUser();
    renderModal();
    await user.type(screen.getByPlaceholderText(/current password/i), 'OldPass123!');
    await user.type(screen.getByPlaceholderText(/new password/i), 'NewPass456@');
    await user.click(screen.getByRole('button', { name: /recover/i }));
    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith('OldPass123!', 'NewPass456@'),
    );
  });

  it('calls updateKey and clearPartialRotation on success', async () => {
    const newKey = {} as CryptoKey;
    vi.mocked(deriveKey).mockResolvedValue(newKey);
    const user = setupUser();
    renderModal();
    await user.type(screen.getByPlaceholderText(/current password/i), 'OldPass123!');
    await user.type(screen.getByPlaceholderText(/new password/i), 'NewPass456@');
    await user.click(screen.getByRole('button', { name: /recover/i }));
    await waitFor(() => {
      expect(mockUpdateKey).toHaveBeenCalledWith(newKey);
      expect(mockClearPartialRotation).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------
  it('shows "Recovering…" while in-flight', async () => {
    let resolveFn!: () => void;
    vi.mocked(changePassword).mockImplementation(
      () => new Promise<never>((res) => { resolveFn = () => res(undefined as never); }),
    );
    const user = setupUser();
    renderModal();
    await user.type(screen.getByPlaceholderText(/current password/i), 'OldPass123!');
    await user.type(screen.getByPlaceholderText(/new password/i), 'NewPass456@');
    await user.click(screen.getByRole('button', { name: /recover/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /recovering/i })).toBeInTheDocument(),
    );
    resolveFn();
  });
});
