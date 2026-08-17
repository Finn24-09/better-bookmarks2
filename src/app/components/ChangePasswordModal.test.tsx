import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { setupUser } from '../../test/userEvent';
import { MemoryRouter } from 'react-router';
import { ChangePasswordModal } from './ChangePasswordModal';
import type { Bookmark } from '../../lib/bookmarks';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const mockLogout = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());
const mockCryptoKey = vi.hoisted(() => ({} as CryptoKey));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    email: 'user@example.com',
    cryptoKey: mockCryptoKey,
    logout: mockLogout,
  }),
}));

vi.mock('react-router', async (importOriginal) => {
  const mod = await importOriginal<typeof import('react-router')>();
  return { ...mod, useNavigate: () => mockNavigate };
});

vi.mock('../../lib/auth', () => ({
  changePassword: vi.fn(),
  signIn: vi.fn(),
  rotationStatus: vi.fn(),
}));

vi.mock('../../lib/crypto', () => ({
  deriveKey: vi.fn(),
}));

vi.mock('../../lib/bookmarks', () => ({
  getBookmarks: vi.fn(),
  reencryptBookmark: vi.fn(),
}));

vi.mock('../../lib/tags', () => ({
  getTags: vi.fn(),
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

vi.mock('../../lib/email', () => ({
  notifyPasswordChanged: vi.fn().mockResolvedValue(undefined),
}));

import { notifyPasswordChanged } from '../../lib/email';

// Suppress toast calls in tests (no Toaster rendered)
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { changePassword, signIn, rotationStatus } from '../../lib/auth';
import { deriveKey } from '../../lib/crypto';
import { getBookmarks, reencryptBookmark } from '../../lib/bookmarks';
import { getTags, reencryptTag } from '../../lib/tags';
import { reencryptThumbnailBatchToBodies, writeReencryptedThumbnail } from '../../lib/thumbnails';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'bm-1', title: 'Test', url: 'https://a.com',
    thumbnailUrl: null, thumbnailFileId: null, thumbnailOriginalName: null,
    tagIds: [], createdAt: '', updatedAt: '',
    keyVersion: 1, thumbnailKeyVersion: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('ChangePasswordModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: pre-flight signIn succeeds, user has no bookmarks or tags
    vi.mocked(signIn).mockResolvedValue({ token: 't', user_id: 'u' } as never);
    vi.mocked(rotationStatus).mockResolvedValue({ keyVersion: 1, hasStaleRecords: false });
    vi.mocked(getBookmarks).mockResolvedValue([]);
    vi.mocked(getTags).mockResolvedValue([]);
    vi.mocked(reencryptBookmark).mockResolvedValue(undefined);
    vi.mocked(reencryptTag).mockResolvedValue(undefined);
    vi.mocked(reencryptThumbnailBatchToBodies).mockImplementation(async (ids) =>
      ids.map((imageId) => ({ imageId, data_enc: 'enc-data', original_name_enc: 'enc-name' })),
    );
    vi.mocked(writeReencryptedThumbnail).mockResolvedValue(undefined);
  });

  function renderModal(open = true, onClose = vi.fn()) {
    return {
      onClose,
      ...render(
        <MemoryRouter>
          <ChangePasswordModal open={open} onClose={onClose} />
        </MemoryRouter>,
      ),
    };
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  it('renders the "Change Password" heading when open', () => {
    renderModal();
    expect(screen.getByText('Change Password')).toBeInTheDocument();
  });

  it('renders current, new, and confirm password fields', () => {
    renderModal();
    expect(screen.getByPlaceholderText('Enter current password…')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter new password…')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Retype new password…')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------
  it('submitting with empty fields shows "Required" errors on all three', async () => {
    const user = setupUser();
    renderModal();
    await user.click(screen.getByRole('button', { name: /save password/i }));
    await waitFor(() => {
      expect(screen.getAllByText('Required')).toHaveLength(3);
    });
  });

  it('shows "At least 12 characters" error for a short new password', async () => {
    const user = setupUser();
    renderModal();
    await user.type(screen.getByPlaceholderText('Enter current password…'), 'old');
    await user.type(screen.getByPlaceholderText('Enter new password…'), 'short');
    await user.type(screen.getByPlaceholderText('Retype new password…'), 'short');
    await user.click(screen.getByRole('button', { name: /save password/i }));
    await waitFor(() =>
      expect(screen.getByText('At least 12 characters')).toBeInTheDocument(),
    );
  });

  it('shows "Passwords do not match" when confirm differs from new', async () => {
    const user = setupUser();
    renderModal();
    await user.type(screen.getByPlaceholderText('Enter current password…'), 'oldpass123');
    await user.type(screen.getByPlaceholderText('Enter new password…'), 'StrongPass12!');
    await user.type(screen.getByPlaceholderText('Retype new password…'), 'StrongPass12?');
    await user.click(screen.getByRole('button', { name: /save password/i }));
    await waitFor(() =>
      expect(screen.getByText('Passwords do not match')).toBeInTheDocument(),
    );
  });

  // -------------------------------------------------------------------------
  // Successful submit
  // -------------------------------------------------------------------------
  it('successful submit calls changePassword, deriveKey, then logs out and navigates to /login', async () => {
    const mockKey = {} as CryptoKey;
    vi.mocked(changePassword).mockResolvedValue(undefined as never);
    vi.mocked(deriveKey).mockResolvedValue(mockKey);
    const user = setupUser();
    renderModal();

    await user.type(screen.getByPlaceholderText('Enter current password…'), 'OldPass123!');
    await user.type(screen.getByPlaceholderText('Enter new password…'), 'StrongPass12!');
    await user.type(screen.getByPlaceholderText('Retype new password…'), 'StrongPass12!');
    await user.click(screen.getByRole('button', { name: /save password/i }));

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith('OldPass123!', 'StrongPass12!');
      expect(deriveKey).toHaveBeenCalledWith('StrongPass12!', 'user@example.com');
      expect(mockLogout).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
    });
  });

  // -------------------------------------------------------------------------
  // Key rotation — re-encrypt all data before changing the password
  // -------------------------------------------------------------------------
  it('fetches all bookmarks and tags using the current key before re-encrypting', async () => {
    const newKey = {} as CryptoKey;
    vi.mocked(deriveKey).mockResolvedValue(newKey);
    vi.mocked(changePassword).mockResolvedValue(undefined as never);
    const user = setupUser();
    renderModal();

    await user.type(screen.getByPlaceholderText('Enter current password…'), 'OldPass123!');
    await user.type(screen.getByPlaceholderText('Enter new password…'), 'StrongPass12!');
    await user.type(screen.getByPlaceholderText('Retype new password…'), 'StrongPass12!');
    await user.click(screen.getByRole('button', { name: /save password/i }));

    await waitFor(() => {
      expect(getBookmarks).toHaveBeenCalledWith(mockCryptoKey);
      expect(getTags).toHaveBeenCalledWith(mockCryptoKey);
    });
  });

  it('re-encrypts each bookmark with the new key', async () => {
    const newKey = {} as CryptoKey;
    const bm = makeBookmark();
    vi.mocked(deriveKey).mockResolvedValue(newKey);
    vi.mocked(changePassword).mockResolvedValue(undefined as never);
    vi.mocked(getBookmarks).mockResolvedValue([bm]);
    const user = setupUser();
    renderModal();

    await user.type(screen.getByPlaceholderText('Enter current password…'), 'OldPass123!');
    await user.type(screen.getByPlaceholderText('Enter new password…'), 'StrongPass12!');
    await user.type(screen.getByPlaceholderText('Retype new password…'), 'StrongPass12!');
    await user.click(screen.getByRole('button', { name: /save password/i }));

    await waitFor(() => {
      expect(reencryptBookmark).toHaveBeenCalledWith(bm, newKey, 2);
    });
  });

  it('re-encrypts each tag name with the new key', async () => {
    const newKey = {} as CryptoKey;
    const tag = { id: 'tag-1', name: 'Work', keyVersion: 1 };
    vi.mocked(deriveKey).mockResolvedValue(newKey);
    vi.mocked(changePassword).mockResolvedValue(undefined as never);
    vi.mocked(getTags).mockResolvedValue([tag]);
    const user = setupUser();
    renderModal();

    await user.type(screen.getByPlaceholderText('Enter current password…'), 'OldPass123!');
    await user.type(screen.getByPlaceholderText('Enter new password…'), 'StrongPass12!');
    await user.type(screen.getByPlaceholderText('Retype new password…'), 'StrongPass12!');
    await user.click(screen.getByRole('button', { name: /save password/i }));

    await waitFor(() => {
      expect(reencryptTag).toHaveBeenCalledWith('tag-1', 'Work', newKey, 2);
    });
  });

  it('calls rotationStatus() to get the current key version before re-encrypting', async () => {
    vi.mocked(changePassword).mockResolvedValue(undefined as never);
    vi.mocked(deriveKey).mockResolvedValue({} as CryptoKey);
    const user = setupUser();
    renderModal();

    await user.type(screen.getByPlaceholderText('Enter current password…'), 'OldPass123!');
    await user.type(screen.getByPlaceholderText('Enter new password…'), 'StrongPass12!');
    await user.type(screen.getByPlaceholderText('Retype new password…'), 'StrongPass12!');
    await user.click(screen.getByRole('button', { name: /save password/i }));

    await waitFor(() => {
      expect(rotationStatus).toHaveBeenCalled();
    });
  });

  it('re-encrypts thumbnail binary files using a batched read before writing', async () => {
    const newKey = {} as CryptoKey;
    const bm = makeBookmark({ thumbnailFileId: 'img-1', thumbnailOriginalName: 'photo.jpg' });
    vi.mocked(deriveKey).mockResolvedValue(newKey);
    vi.mocked(changePassword).mockResolvedValue(undefined as never);
    vi.mocked(getBookmarks).mockResolvedValue([bm]);
    const user = setupUser();
    renderModal();

    await user.type(screen.getByPlaceholderText('Enter current password…'), 'OldPass123!');
    await user.type(screen.getByPlaceholderText('Enter new password…'), 'StrongPass12!');
    await user.type(screen.getByPlaceholderText('Retype new password…'), 'StrongPass12!');
    await user.click(screen.getByRole('button', { name: /save password/i }));

    await waitFor(() => {
      // Reads are batched by id list — one request per thumbnail is what
      // overran the nginx api_read budget and stranded partial rotations.
      expect(reencryptThumbnailBatchToBodies).toHaveBeenCalledWith(
        ['img-1'],
        mockCryptoKey,
        newKey,
        undefined,
      );
    });
  });

  it('writes no re-encrypted record when the thumbnail read fails', async () => {
    const newKey = {} as CryptoKey;
    const bm = makeBookmark({ thumbnailFileId: 'img-1', thumbnailOriginalName: 'photo.jpg' });
    vi.mocked(deriveKey).mockResolvedValue(newKey);
    vi.mocked(getBookmarks).mockResolvedValue([bm]);
    vi.mocked(getTags).mockResolvedValue([{ id: 'tag-1', name: 'Work' }]);
    vi.mocked(reencryptThumbnailBatchToBodies).mockRejectedValue(new Error('read failed'));
    const user = setupUser();
    renderModal();

    await user.type(screen.getByPlaceholderText('Enter current password…'), 'OldPass123!');
    await user.type(screen.getByPlaceholderText('Enter new password…'), 'StrongPass12!');
    await user.type(screen.getByPlaceholderText('Retype new password…'), 'StrongPass12!');
    await user.click(screen.getByRole('button', { name: /save password/i }));

    // The reported failure: bookmarks were PATCHed to the new key BEFORE the
    // thumbnails were read, so a failed read left them encrypted under a key
    // the unchanged password could not derive.
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    expect(reencryptBookmark).not.toHaveBeenCalled();
    expect(reencryptTag).not.toHaveBeenCalled();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('calls changePassword only after all re-encryption completes', async () => {
    const calls: string[] = [];
    const newKey = {} as CryptoKey;
    const bm = makeBookmark();
    vi.mocked(deriveKey).mockResolvedValue(newKey);
    vi.mocked(getBookmarks).mockResolvedValue([bm]);
    vi.mocked(reencryptBookmark).mockImplementation(async () => { calls.push('reencrypt'); });
    vi.mocked(changePassword).mockImplementation(async () => { calls.push('changePassword'); return undefined as never; });
    const user = setupUser();
    renderModal();

    await user.type(screen.getByPlaceholderText('Enter current password…'), 'OldPass123!');
    await user.type(screen.getByPlaceholderText('Enter new password…'), 'StrongPass99!');
    await user.type(screen.getByPlaceholderText('Retype new password…'), 'StrongPass99!');
    await user.click(screen.getByRole('button', { name: /save password/i }));

    await waitFor(() => {
      expect(calls).toEqual(['reencrypt', 'changePassword']);
    });
  });

  // -------------------------------------------------------------------------
  // N-3: notifyPasswordChanged() must run while the JWT is unambiguously
  // valid. Calling it AFTER changePassword() races logout() (which clears
  // the in-memory token) and risks a 401. Move it BEFORE changePassword.
  // -------------------------------------------------------------------------
  it('calls notifyPasswordChanged BEFORE changePassword (token is still valid pre-rotation)', async () => {
    const calls: string[] = [];
    vi.mocked(deriveKey).mockResolvedValue({} as CryptoKey);
    vi.mocked(notifyPasswordChanged).mockImplementation(async () => {
      calls.push('notify');
    });
    vi.mocked(changePassword).mockImplementation(async () => {
      calls.push('changePassword');
      return undefined as never;
    });
    const user = setupUser();
    renderModal();

    await user.type(screen.getByPlaceholderText('Enter current password…'), 'OldPass123!');
    await user.type(screen.getByPlaceholderText('Enter new password…'), 'StrongPass12!');
    await user.type(screen.getByPlaceholderText('Retype new password…'), 'StrongPass12!');
    await user.click(screen.getByRole('button', { name: /save password/i }));

    await waitFor(() => {
      expect(calls).toContain('notify');
      expect(calls).toContain('changePassword');
    });
    // Ordering: notify runs before changePassword — token is unambiguously valid.
    expect(calls.indexOf('notify')).toBeLessThan(calls.indexOf('changePassword'));
  });

  it('calls notifyPasswordChanged BEFORE logout (so getToken() still returns the JWT)', async () => {
    const calls: string[] = [];
    vi.mocked(deriveKey).mockResolvedValue({} as CryptoKey);
    vi.mocked(changePassword).mockResolvedValue(undefined as never);
    vi.mocked(notifyPasswordChanged).mockImplementation(async () => {
      calls.push('notify');
    });
    mockLogout.mockImplementation(() => {
      calls.push('logout');
    });
    const user = setupUser();
    renderModal();

    await user.type(screen.getByPlaceholderText('Enter current password…'), 'OldPass123!');
    await user.type(screen.getByPlaceholderText('Enter new password…'), 'StrongPass12!');
    await user.type(screen.getByPlaceholderText('Retype new password…'), 'StrongPass12!');
    await user.click(screen.getByRole('button', { name: /save password/i }));

    await waitFor(() => {
      expect(calls).toContain('notify');
      expect(calls).toContain('logout');
    });
    expect(calls.indexOf('notify')).toBeLessThan(calls.indexOf('logout'));
  });

  // -------------------------------------------------------------------------
  // Loading and error states
  // -------------------------------------------------------------------------
  it('shows "Saving…" while the submit promise is pending', async () => {
    let resolveFn!: () => void;
    vi.mocked(changePassword).mockImplementation(
      () => new Promise<never>((res) => { resolveFn = () => res(undefined as never); }),
    );
    const user = setupUser();
    renderModal();

    await user.type(screen.getByPlaceholderText('Enter current password…'), 'OldPass123!');
    await user.type(screen.getByPlaceholderText('Enter new password…'), 'StrongPass12!');
    await user.type(screen.getByPlaceholderText('Retype new password…'), 'StrongPass12!');
    await user.click(screen.getByRole('button', { name: /save password/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /saving/i })).toBeInTheDocument(),
    );

    resolveFn();
  });

  it('shows the API error message as a toast when changePassword rejects', async () => {
    vi.mocked(changePassword).mockRejectedValue(new Error('Wrong password'));
    const user = setupUser();
    renderModal();

    await user.type(screen.getByPlaceholderText('Enter current password…'), 'OldPass123!');
    await user.type(screen.getByPlaceholderText('Enter new password…'), 'StrongPass99!');
    await user.type(screen.getByPlaceholderText('Retype new password…'), 'StrongPass99!');
    await user.click(screen.getByRole('button', { name: /save password/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Wrong password'),
    );
  });

  // -------------------------------------------------------------------------
  // Show / hide password toggles
  // -------------------------------------------------------------------------
  it('eye toggle on "New Password" changes input type from "password" to "text"', async () => {
    const user = setupUser();
    renderModal();

    const newPasswordInput = screen.getByPlaceholderText('Enter new password…');
    expect(newPasswordInput).toHaveAttribute('type', 'password');

    const eyeToggle = newPasswordInput.closest('.relative')!.querySelector('button');
    await user.click(eyeToggle!);

    expect(newPasswordInput).toHaveAttribute('type', 'text');
  });

  it('eye toggle on "Current Password" changes input type from "password" to "text"', async () => {
    const user = setupUser();
    renderModal();

    const currentPasswordInput = screen.getByPlaceholderText('Enter current password…');
    expect(currentPasswordInput).toHaveAttribute('type', 'password');

    const eyeToggle = currentPasswordInput.closest('.relative')!.querySelector('button');
    await user.click(eyeToggle!);

    expect(currentPasswordInput).toHaveAttribute('type', 'text');
  });

  // -------------------------------------------------------------------------
  // Password strength hints
  // -------------------------------------------------------------------------
  it('shows password strength hints for the new password field after typing', async () => {
    const user = setupUser();
    renderModal();

    await user.type(screen.getByPlaceholderText('Enter new password…'), 'abc');

    expect(screen.getByText('12+ characters')).toBeInTheDocument();
    expect(screen.getByText('Uppercase letter (A–Z)')).toBeInTheDocument();
    expect(screen.getByText('Lowercase letter (a–z)')).toBeInTheDocument();
    expect(screen.getByText('Number or symbol')).toBeInTheDocument();
  });
});
