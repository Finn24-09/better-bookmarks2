import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { DeleteAccountModal } from './DeleteAccountModal';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const mockLogout = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ logout: mockLogout }),
}));

vi.mock('react-router', async (importOriginal) => {
  const mod = await importOriginal<typeof import('react-router')>();
  return { ...mod, useNavigate: () => mockNavigate };
});

vi.mock('../../lib/email', () => ({
  requestAccountDeletion: vi.fn().mockResolvedValue(undefined),
  confirmAccountDeletion: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { requestAccountDeletion, confirmAccountDeletion } from '../../lib/email';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------

function renderModal(props: { open?: boolean; onClose?: () => void; initialToken?: string } = {}) {
  const onClose = props.onClose ?? vi.fn();
  return {
    onClose,
    ...render(
      <MemoryRouter>
        <DeleteAccountModal open={props.open ?? true} onClose={onClose} initialToken={props.initialToken} />
      </MemoryRouter>,
    ),
  };
}

/**
 * Simulate a full 3-second hold on the delete button.
 * Uses faked setInterval/Date but keeps setTimeout real so waitFor still works.
 */
async function holdDeleteButton() {
  const btn = screen.getByRole('button', { name: /hold to delete/i });
  fireEvent.mouseDown(btn);
  await act(async () => {
    vi.advanceTimersByTime(3100);
  });
  fireEvent.mouseUp(btn);
}

describe('DeleteAccountModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders step 1: heading, warning, and send email button', () => {
    renderModal();
    expect(screen.getByText('Delete Account')).toBeInTheDocument();
    expect(screen.getByText(/are you absolutely sure/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send confirmation email/i })).toBeInTheDocument();
  });

  it('clicking Cancel calls onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderModal({ onClose });
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('sends email and advances to step 2', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: /send confirmation email/i }));
    await waitFor(() => {
      expect(requestAccountDeletion).toHaveBeenCalledTimes(1);
      // Step 2 is visible: the hold button appears
      expect(screen.getByRole('button', { name: /hold to delete/i })).toBeInTheDocument();
    });
  });

  it('shows step 2 immediately when initialToken is provided', () => {
    renderModal({ initialToken: 'preloaded-token' });
    // Label for the token input is present
    expect(screen.getByLabelText(/confirmation token/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('preloaded-token')).toBeInTheDocument();
  });

  describe('hold-to-confirm delete button', () => {
    beforeEach(() => {
      // Only fake setInterval and Date so waitFor (which uses setTimeout) still works.
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('calls confirmAccountDeletion with token and password after 3-second hold', async () => {
      renderModal({ initialToken: 'tok123' });

      fireEvent.change(screen.getByPlaceholderText(/paste token/i), { target: { value: 'tok123' } });
      fireEvent.change(screen.getByPlaceholderText(/enter your password/i), { target: { value: 'MyPass!' } });

      await holdDeleteButton();

      await waitFor(() => {
        expect(confirmAccountDeletion).toHaveBeenCalledWith('tok123', 'MyPass!');
      });
    });

    it('calls logout and navigates to /login on successful deletion', async () => {
      renderModal({ initialToken: 'tok' });
      fireEvent.change(screen.getByPlaceholderText(/enter your password/i), { target: { value: 'pw' } });

      await holdDeleteButton();

      await waitFor(() => {
        expect(mockLogout).toHaveBeenCalled();
        expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
      });
    });

    it('shows error toast when confirmAccountDeletion fails', async () => {
      vi.mocked(confirmAccountDeletion).mockResolvedValueOnce({ ok: false, error: 'Invalid password' });
      renderModal({ initialToken: 'tok' });
      fireEvent.change(screen.getByPlaceholderText(/enter your password/i), { target: { value: 'wrong' } });

      await holdDeleteButton();

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Invalid password');
      });
    });

    it('does not delete if hold is released early', async () => {
      renderModal({ initialToken: 'tok' });
      fireEvent.change(screen.getByPlaceholderText(/enter your password/i), { target: { value: 'pw' } });

      const btn = screen.getByRole('button', { name: /hold to delete/i });
      fireEvent.mouseDown(btn);
      await act(async () => { vi.advanceTimersByTime(1000); });
      fireEvent.mouseUp(btn);

      await act(async () => { vi.advanceTimersByTime(3000); });

      expect(confirmAccountDeletion).not.toHaveBeenCalled();
    });
  });
});
