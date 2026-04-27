import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { EmailVerificationBanner } from './EmailVerificationBanner';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('../../lib/email', () => ({
  resendVerificationEmail: vi.fn().mockResolvedValue(undefined),
}));

import { resendVerificationEmail } from '../../lib/email';
import { toast } from 'sonner';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('EmailVerificationBanner', () => {
  it('renders the verification message', () => {
    render(<EmailVerificationBanner />);
    expect(screen.getByText(/verify your email address/i)).toBeInTheDocument();
  });

  it('shows the resend button', () => {
    render(<EmailVerificationBanner />);
    expect(screen.getByRole('button', { name: /resend email/i })).toBeInTheDocument();
  });

  it('calls resendVerificationEmail when resend button is clicked', async () => {
    render(<EmailVerificationBanner />);
    fireEvent.click(screen.getByRole('button', { name: /resend email/i }));
    await waitFor(() => {
      expect(resendVerificationEmail).toHaveBeenCalledTimes(1);
    });
  });

  it('disables the resend button while sending', async () => {
    let resolve!: () => void;
    vi.mocked(resendVerificationEmail).mockReturnValueOnce(
      new Promise(r => { resolve = r; }),
    );
    render(<EmailVerificationBanner />);
    fireEvent.click(screen.getByRole('button', { name: /resend email/i }));
    expect(screen.getByRole('button', { name: /sending/i })).toBeDisabled();
    resolve();
  });

  it('enters cooldown after a successful send', async () => {
    render(<EmailVerificationBanner />);
    fireEvent.click(screen.getByRole('button', { name: /resend email/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /resend in/i })).toBeDisabled();
    });
  });

  // -------------------------------------------------------------------------
  // Client cooldown must match the server cooldown so the resend never gets
  // a server 429 the user can't see. Server cooldown is 60 s; assert the
  // initial countdown is in that ballpark (allow ±5 s for scheduling jitter).
  // -------------------------------------------------------------------------
  it('cooldown countdown shows ~60 seconds immediately after a successful send', async () => {
    render(<EmailVerificationBanner />);
    fireEvent.click(screen.getByRole('button', { name: /resend email/i }));

    const cooldownBtn = await screen.findByRole('button', { name: /resend in/i });
    const label = cooldownBtn.textContent ?? '';
    const match = label.match(/(\d+)/);
    expect(match).not.toBeNull();
    const seconds = Number(match![1]);
    expect(seconds).toBeGreaterThanOrEqual(55);
    expect(seconds).toBeLessThanOrEqual(60);
  });

  // -------------------------------------------------------------------------
  // Regression pin: previously secondsLeft was computed from Date.now() at
  // render time only, with no timer to trigger re-renders, so the label
  // stayed frozen at ~60 until the cooldown lapsed entirely. Verify the
  // displayed second count actually decreases as time advances.
  // -------------------------------------------------------------------------
  it('cooldown countdown ticks down once per second', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<EmailVerificationBanner />);
    fireEvent.click(screen.getByRole('button', { name: /resend email/i }));

    const initial = await screen.findByRole('button', { name: /resend in/i });
    const initialSeconds = Number((initial.textContent ?? '').match(/(\d+)/)?.[1]);
    expect(Number.isFinite(initialSeconds)).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    const later = screen.getByRole('button', { name: /resend in/i });
    const laterSeconds = Number((later.textContent ?? '').match(/(\d+)/)?.[1]);
    expect(laterSeconds).toBeLessThan(initialSeconds);
  });

  // -------------------------------------------------------------------------
  // Regression pin: the previous catch block silently swallowed errors,
  // leaving the user with no feedback when the server rate-limited or the
  // request failed. Surface failures via toast.
  // -------------------------------------------------------------------------
  it('shows an error toast when the resend request fails', async () => {
    vi.mocked(resendVerificationEmail).mockRejectedValueOnce(new Error('boom'));
    render(<EmailVerificationBanner />);
    fireEvent.click(screen.getByRole('button', { name: /resend email/i }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });
});
