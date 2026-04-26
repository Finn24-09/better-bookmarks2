import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EmailVerificationBanner } from './EmailVerificationBanner';

vi.mock('../../lib/email', () => ({
  resendVerificationEmail: vi.fn().mockResolvedValue(undefined),
}));

import { resendVerificationEmail } from '../../lib/email';

beforeEach(() => {
  vi.clearAllMocks();
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
});
