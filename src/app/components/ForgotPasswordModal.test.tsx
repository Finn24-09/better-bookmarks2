import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { setupUser } from '../../test/userEvent';
import { ForgotPasswordModal } from './ForgotPasswordModal';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('../../lib/email', () => ({
  requestPasswordReset: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { requestPasswordReset } from '../../lib/email';
import { toast } from 'sonner';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Portal mount — the modal must escape ancestor stacking contexts
// (e.g. AuthPage's backdrop-blur card + animated overlay) by rendering
// directly into document.body. Otherwise sibling animated layers can paint
// on top despite the modal's z-50.
// ---------------------------------------------------------------------------
describe('ForgotPasswordModal · portal mount', () => {
  it('renders the modal as a child of document.body, not the local container', () => {
    const { container } = render(<ForgotPasswordModal onClose={vi.fn()} />);
    const modal = screen
      .getByRole('heading', { name: /reset password/i })
      .closest('.fixed');
    expect(modal).toBeTruthy();
    expect(container.contains(modal)).toBe(false);
    expect(document.body.contains(modal!)).toBe(true);
  });
});

describe('ForgotPasswordModal', () => {
  it('renders the email input and submit button', () => {
    render(<ForgotPasswordModal onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText('Email address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
  });

  it('shows the "done" view after a successful submit', async () => {
    vi.mocked(requestPasswordReset).mockResolvedValue(undefined);
    const user = setupUser();
    render(<ForgotPasswordModal onClose={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('Email address'), 'a@b.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() =>
      expect(screen.getByText(/the link expires in 1 hour/i)).toBeInTheDocument(),
    );
  });

  // -------------------------------------------------------------------------
  // N-1: Network errors must not strand the modal in 'submitting'.
  // The submit handler must catch, return to 'idle', and surface a generic
  // toast (no raw error message — match the error sanitization pattern).
  // -------------------------------------------------------------------------
  it('returns to idle and shows a toast when requestPasswordReset rejects', async () => {
    vi.mocked(requestPasswordReset).mockRejectedValue(new Error('NetworkError'));
    const user = setupUser();
    render(<ForgotPasswordModal onClose={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('Email address'), 'a@b.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    // Modal must NOT enter 'done' state — the form is still showing
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /send reset link/i });
      expect(btn).not.toBeDisabled();
    });

    expect(screen.queryByText(/the link expires in 1 hour/i)).not.toBeInTheDocument();
    // Toast must have fired with a generic message (no raw "NetworkError" leak)
    expect(toast.error).toHaveBeenCalledTimes(1);
    const [msg] = vi.mocked(toast.error).mock.calls[0];
    expect(typeof msg).toBe('string');
    expect(msg as string).not.toContain('NetworkError');
  });
});
