import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangePasswordModal } from './ChangePasswordModal';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const mockUpdateKey = vi.hoisted(() => vi.fn());

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    email: 'user@example.com',
    updateKey: mockUpdateKey,
  }),
}));

vi.mock('../../lib/auth', () => ({
  changePassword: vi.fn(),
}));

vi.mock('../../lib/crypto', () => ({
  deriveKey: vi.fn(),
}));

// Suppress toast calls in tests (no Toaster rendered)
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { changePassword } from '../../lib/auth';
import { deriveKey } from '../../lib/crypto';

// ---------------------------------------------------------------------------

describe('ChangePasswordModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderModal(open = true, onClose = vi.fn()) {
    return { onClose, ...render(<ChangePasswordModal open={open} onClose={onClose} />) };
  }

  it('renders the "Change Password" heading when open', () => {
    renderModal();
    expect(screen.getByText('Change Password')).toBeInTheDocument();
  });

  it('renders current, new, and confirm password fields', () => {
    renderModal();
    expect(screen.getByPlaceholderText('Enter current password\u2026')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter new password\u2026')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Retype new password\u2026')).toBeInTheDocument();
  });

  it('submitting with empty fields shows "Required" errors on all three', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: /save password/i }));
    await waitFor(() => {
      expect(screen.getAllByText('Required')).toHaveLength(3);
    });
  });

  it('shows "At least 8 characters" error for a short new password', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByPlaceholderText('Enter current password\u2026'), 'old');
    await user.type(screen.getByPlaceholderText('Enter new password\u2026'), 'short');
    await user.type(screen.getByPlaceholderText('Retype new password\u2026'), 'short');
    await user.click(screen.getByRole('button', { name: /save password/i }));
    await waitFor(() =>
      expect(screen.getByText('At least 8 characters')).toBeInTheDocument(),
    );
  });

  it('shows "Passwords do not match" when confirm differs from new', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByPlaceholderText('Enter current password\u2026'), 'oldpass123');
    await user.type(screen.getByPlaceholderText('Enter new password\u2026'), 'newpass123');
    await user.type(screen.getByPlaceholderText('Retype new password\u2026'), 'different1');
    await user.click(screen.getByRole('button', { name: /save password/i }));
    await waitFor(() =>
      expect(screen.getByText('Passwords do not match')).toBeInTheDocument(),
    );
  });

  it('successful submit calls changePassword, deriveKey, updateKey, and onClose', async () => {
    const mockKey = {} as CryptoKey;
    vi.mocked(changePassword).mockResolvedValue(undefined as never);
    vi.mocked(deriveKey).mockResolvedValue(mockKey);
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ChangePasswordModal open={true} onClose={onClose} />);

    await user.type(screen.getByPlaceholderText('Enter current password\u2026'), 'oldpass123');
    await user.type(screen.getByPlaceholderText('Enter new password\u2026'), 'newpass456');
    await user.type(screen.getByPlaceholderText('Retype new password\u2026'), 'newpass456');
    await user.click(screen.getByRole('button', { name: /save password/i }));

    await waitFor(() => {
      expect(changePassword).toHaveBeenCalledWith('oldpass123', 'newpass456');
      expect(deriveKey).toHaveBeenCalledWith('newpass456', 'user@example.com');
      expect(mockUpdateKey).toHaveBeenCalledWith(mockKey);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows "Saving\u2026" while the submit promise is pending', async () => {
    let resolveFn!: () => void;
    vi.mocked(changePassword).mockImplementation(
      () => new Promise<never>((res) => { resolveFn = () => res(undefined as never); }),
    );
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByPlaceholderText('Enter current password\u2026'), 'old123456');
    await user.type(screen.getByPlaceholderText('Enter new password\u2026'), 'new123456');
    await user.type(screen.getByPlaceholderText('Retype new password\u2026'), 'new123456');
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

    await user.type(screen.getByPlaceholderText('Enter current password\u2026'), 'wrong');
    await user.type(screen.getByPlaceholderText('Enter new password\u2026'), 'newpass456');
    await user.type(screen.getByPlaceholderText('Retype new password\u2026'), 'newpass456');
    await user.click(screen.getByRole('button', { name: /save password/i }));

    await waitFor(() =>
      expect(screen.getByText('Wrong password')).toBeInTheDocument(),
    );
  });
});
