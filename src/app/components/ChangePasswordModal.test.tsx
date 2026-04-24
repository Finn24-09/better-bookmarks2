import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangePasswordModal } from './ChangePasswordModal';
import type { Bookmark } from '../../lib/bookmarks';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const mockUpdateKey = vi.hoisted(() => vi.fn());
const mockCryptoKey = vi.hoisted(() => ({} as CryptoKey));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    email: 'user@example.com',
    cryptoKey: mockCryptoKey,
    updateKey: mockUpdateKey,
  }),
}));

vi.mock('../../lib/auth', () => ({
  changePassword: vi.fn(),
  signIn: vi.fn(),
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
  reencryptThumbnail: vi.fn(),
}));

// Suppress toast calls in tests (no Toaster rendered)
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { changePassword, signIn } from '../../lib/auth';
import { deriveKey } from '../../lib/crypto';
import { getBookmarks, reencryptBookmark } from '../../lib/bookmarks';
import { getTags, reencryptTag } from '../../lib/tags';
import { reencryptThumbnail } from '../../lib/thumbnails';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'bm-1', title: 'Test', url: 'https://a.com',
    thumbnailUrl: null, thumbnailFileId: null, thumbnailOriginalName: null,
    tagIds: [], createdAt: '', updatedAt: '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('ChangePasswordModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: pre-flight signIn succeeds, user has no bookmarks or tags
    vi.mocked(signIn).mockResolvedValue({ token: 't', user_id: 'u' } as never);
    vi.mocked(getBookmarks).mockResolvedValue([]);
    vi.mocked(getTags).mockResolvedValue([]);
    vi.mocked(reencryptBookmark).mockResolvedValue(undefined);
    vi.mocked(reencryptTag).mockResolvedValue(undefined);
    vi.mocked(reencryptThumbnail).mockResolvedValue(undefined);
  });

  function renderModal(open = true, onClose = vi.fn()) {
    return { onClose, ...render(<ChangePasswordModal open={open} onClose={onClose} />) };
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
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: /save password/i }));
    await waitFor(() => {
      expect(screen.getAllByText('Required')).toHaveLength(3);
    });
  });

  it('shows "At least 12 characters" error for a short new password', async () => {
    const user = userEvent.setup();
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
    const user = userEvent.setup();
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
  it('successful submit calls changePassword, deriveKey, updateKey, and onClose', async () => {
    const mockKey = {} as CryptoKey;
    vi.mocked(changePassword).mockResolvedValue(undefined as never);
    vi.mocked(deriveKey).mockResolvedValue(mockKey);
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ChangePasswordModal open={true} onClose={onClose} />);

    await user.type(screen.getByPlaceholderText('Enter current password…'), 'OldPass123!');
    await user.type(screen.getByPlaceholderText('Enter new password…'), 'StrongPass12!');
    await user.type(screen.getByPlaceholderText('Retype new password…'), 'StrongPass12!');
    await user.click(screen.getByRole('button', { name: /save password/i }));

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith('OldPass123!', 'StrongPass12!');
      expect(deriveKey).toHaveBeenCalledWith('StrongPass12!', 'user@example.com');
      expect(mockUpdateKey).toHaveBeenCalledWith(mockKey);
      expect(onClose).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Key rotation — re-encrypt all data before changing the password
  // -------------------------------------------------------------------------
  it('fetches all bookmarks and tags using the current key before re-encrypting', async () => {
    const newKey = {} as CryptoKey;
    vi.mocked(deriveKey).mockResolvedValue(newKey);
    vi.mocked(changePassword).mockResolvedValue(undefined as never);
    const user = userEvent.setup();
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
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByPlaceholderText('Enter current password…'), 'OldPass123!');
    await user.type(screen.getByPlaceholderText('Enter new password…'), 'StrongPass12!');
    await user.type(screen.getByPlaceholderText('Retype new password…'), 'StrongPass12!');
    await user.click(screen.getByRole('button', { name: /save password/i }));

    await waitFor(() => {
      expect(reencryptBookmark).toHaveBeenCalledWith(bm, newKey);
    });
  });

  it('re-encrypts each tag name with the new key', async () => {
    const newKey = {} as CryptoKey;
    const tag = { id: 'tag-1', name: 'Work' };
    vi.mocked(deriveKey).mockResolvedValue(newKey);
    vi.mocked(changePassword).mockResolvedValue(undefined as never);
    vi.mocked(getTags).mockResolvedValue([tag]);
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByPlaceholderText('Enter current password…'), 'OldPass123!');
    await user.type(screen.getByPlaceholderText('Enter new password…'), 'StrongPass12!');
    await user.type(screen.getByPlaceholderText('Retype new password…'), 'StrongPass12!');
    await user.click(screen.getByRole('button', { name: /save password/i }));

    await waitFor(() => {
      expect(reencryptTag).toHaveBeenCalledWith('tag-1', 'Work', newKey);
    });
  });

  it('re-encrypts thumbnail binary files with old and new keys', async () => {
    const newKey = {} as CryptoKey;
    const bm = makeBookmark({ thumbnailFileId: 'img-1', thumbnailOriginalName: 'photo.jpg' });
    vi.mocked(deriveKey).mockResolvedValue(newKey);
    vi.mocked(changePassword).mockResolvedValue(undefined as never);
    vi.mocked(getBookmarks).mockResolvedValue([bm]);
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByPlaceholderText('Enter current password…'), 'OldPass123!');
    await user.type(screen.getByPlaceholderText('Enter new password…'), 'StrongPass12!');
    await user.type(screen.getByPlaceholderText('Retype new password…'), 'StrongPass12!');
    await user.click(screen.getByRole('button', { name: /save password/i }));

    await waitFor(() => {
      expect(reencryptThumbnail).toHaveBeenCalledWith('img-1', mockCryptoKey, newKey);
    });
  });

  it('calls changePassword only after all re-encryption completes', async () => {
    const calls: string[] = [];
    const newKey = {} as CryptoKey;
    const bm = makeBookmark();
    vi.mocked(deriveKey).mockResolvedValue(newKey);
    vi.mocked(getBookmarks).mockResolvedValue([bm]);
    vi.mocked(reencryptBookmark).mockImplementation(async () => { calls.push('reencrypt'); });
    vi.mocked(changePassword).mockImplementation(async () => { calls.push('changePassword'); return undefined as never; });
    const user = userEvent.setup();
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
  // Loading and error states
  // -------------------------------------------------------------------------
  it('shows "Saving…" while the submit promise is pending', async () => {
    let resolveFn!: () => void;
    vi.mocked(changePassword).mockImplementation(
      () => new Promise<never>((res) => { resolveFn = () => res(undefined as never); }),
    );
    const user = userEvent.setup();
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

  it('shows the API error message when changePassword rejects', async () => {
    vi.mocked(changePassword).mockRejectedValue(new Error('Wrong password'));
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByPlaceholderText('Enter current password…'), 'OldPass123!');
    await user.type(screen.getByPlaceholderText('Enter new password…'), 'StrongPass99!');
    await user.type(screen.getByPlaceholderText('Retype new password…'), 'StrongPass99!');
    await user.click(screen.getByRole('button', { name: /save password/i }));

    await waitFor(() =>
      expect(screen.getByText('Wrong password')).toBeInTheDocument(),
    );
  });
});
