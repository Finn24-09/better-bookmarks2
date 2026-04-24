import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
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

vi.mock('../../lib/auth', () => ({
  deleteAccount: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { deleteAccount } from '../../lib/auth';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------

const HOLD_MS = 3000;

describe('DeleteAccountModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Ensure real timers are restored even if a test throws.
    vi.useRealTimers();
  });

  function renderModal(open = true, onClose = vi.fn()) {
    return {
      onClose,
      ...render(
        <MemoryRouter>
          <DeleteAccountModal open={open} onClose={onClose} />
        </MemoryRouter>,
      ),
    };
  }

  it('renders heading, warning text, password field, and hold button', () => {
    renderModal();
    expect(screen.getByText('Delete Account')).toBeInTheDocument();
    expect(screen.getByText(/are you absolutely sure/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/enter your password/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /hold to permanently delete/i }),
    ).toBeInTheDocument();
  });

  it('clicking Cancel calls onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <DeleteAccountModal open={true} onClose={onClose} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('holding without a password shows error after 3 s; deleteAccount not called', async () => {
    vi.useFakeTimers();
    renderModal();

    const holdButton = screen.getByRole('button', { name: /hold to permanently delete/i });
    fireEvent.mouseDown(holdButton);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(toast.error).toHaveBeenCalledWith('Please enter your password to confirm deletion');
    expect(deleteAccount).not.toHaveBeenCalled();

    fireEvent.mouseUp(holdButton);
  });

  it('holding with a password calls deleteAccount with that password', async () => {
    vi.useFakeTimers();
    vi.mocked(deleteAccount).mockImplementation(() => Promise.resolve());
    renderModal();

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/enter your password/i), {
        target: { value: 'mypassword' },
      });
    });

    const holdButton = screen.getByRole('button', { name: /hold to permanently delete/i });
    fireEvent.mouseDown(holdButton);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(deleteAccount).toHaveBeenCalledWith('mypassword');
  });

  it('successful deletion calls logout and navigates to /login', async () => {
    vi.useFakeTimers();
    vi.mocked(deleteAccount).mockImplementation(() => Promise.resolve());
    renderModal();

    fireEvent.change(screen.getByPlaceholderText(/enter your password/i), {
      target: { value: 'mypassword' },
    });

    const holdButton = screen.getByRole('button', { name: /hold to permanently delete/i });
    fireEvent.mouseDown(holdButton);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mockLogout).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
  });

  it('shows a toast error when deleteAccount rejects', async () => {
    vi.useFakeTimers();
    vi.mocked(deleteAccount).mockRejectedValue(new Error('Invalid credentials'));
    renderModal();

    fireEvent.change(screen.getByPlaceholderText(/enter your password/i), {
      target: { value: 'wrongpass' },
    });

    const holdButton = screen.getByRole('button', { name: /hold to permanently delete/i });
    fireEvent.mouseDown(holdButton);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(toast.error).toHaveBeenCalledWith('Invalid credentials');
  });

  it('button shows "Deleting\u2026" while the deletion is in progress', async () => {
    vi.useFakeTimers();
    let resolveFn!: () => void;
    vi.mocked(deleteAccount).mockImplementation(
      () => new Promise<void>((res) => { resolveFn = res; }),
    );
    renderModal();

    fireEvent.change(screen.getByPlaceholderText(/enter your password/i), {
      target: { value: 'mypassword' },
    });

    const holdButton = screen.getByRole('button', { name: /hold to permanently delete/i });
    fireEvent.mouseDown(holdButton);

    await act(async () => {
      vi.advanceTimersByTime(HOLD_MS);
      // Flush the microtasks that run up to (but not past) the pending promise.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: /deleting/i })).toBeInTheDocument();

    resolveFn();
  });
});
