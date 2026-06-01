import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { setupUser } from '../../test/userEvent';
import { ResetPasswordModal } from './ResetPasswordModal';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }),
  );
});

// ---------------------------------------------------------------------------
// Password length policy — must match registration / change-password (12+).
// Reset must NOT produce a password that fails the sign-up policy.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Portal mount — the modal must escape ancestor stacking contexts
// (e.g. AuthPage's backdrop-blur card + animated overlay) by rendering
// directly into document.body. Otherwise the sliding overlay paints on top.
// ---------------------------------------------------------------------------
describe('ResetPasswordModal · portal mount', () => {
  it('renders the modal as a child of document.body, not the local container', () => {
    const { container } = render(<ResetPasswordModal onClose={vi.fn()} />);
    const modal = screen
      .getByRole('heading', { name: /set new password/i })
      .closest('.fixed');
    expect(modal).toBeTruthy();
    // Proves the modal portaled out of the rendering container...
    expect(container.contains(modal)).toBe(false);
    // ...and into document.body
    expect(document.body.contains(modal!)).toBe(true);
  });
});

describe('ResetPasswordModal · password length policy', () => {
  it('rejects an 11-character password with "At least 12 characters"', async () => {
    const user = setupUser();
    render(<ResetPasswordModal onClose={vi.fn()} />);

    // 11 chars — one short of policy
    const eleven = 'Abcdefg1234';
    expect(eleven).toHaveLength(11);

    await user.type(screen.getByPlaceholderText('New password'), eleven);
    await user.type(screen.getByPlaceholderText('Confirm new password'), eleven);
    await user.click(
      screen.getByRole('button', { name: /reset password and delete all data/i }),
    );

    await waitFor(() =>
      expect(screen.getByText('At least 12 characters')).toBeInTheDocument(),
    );
    // fetch must NOT have been called — validation must short-circuit submit
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts a 12-character password (no length error, fetch fired)', async () => {
    const user = setupUser();
    render(<ResetPasswordModal onClose={vi.fn()} />);

    const twelve = 'Abcdefg12345';
    expect(twelve).toHaveLength(12);

    await user.type(screen.getByPlaceholderText('New password'), twelve);
    await user.type(screen.getByPlaceholderText('Confirm new password'), twelve);
    await user.click(
      screen.getByRole('button', { name: /reset password and delete all data/i }),
    );

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    // No length error visible
    expect(screen.queryByText('At least 12 characters')).not.toBeInTheDocument();
    expect(screen.queryByText('At least 8 characters')).not.toBeInTheDocument();
  });
});
