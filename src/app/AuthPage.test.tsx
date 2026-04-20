import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { AuthPage } from './AuthPage';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const mockLogin = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock('./contexts/AuthContext', () => ({
  useAuth: () => ({ login: mockLogin }),
}));

vi.mock('react-router', async (importOriginal) => {
  const mod = await importOriginal<typeof import('react-router')>();
  return { ...mod, useNavigate: () => mockNavigate };
});

vi.mock('../lib/auth', () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock('../lib/crypto', () => ({
  deriveKey: vi.fn(),
}));

import { signIn, signUp } from '../lib/auth';
import { deriveKey } from '../lib/crypto';

// ---------------------------------------------------------------------------

describe('AuthPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderPage() {
    return render(
      <MemoryRouter>
        <AuthPage />
      </MemoryRouter>,
    );
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  it('renders email and password inputs on initial load', () => {
    renderPage();
    expect(screen.getAllByPlaceholderText('Email address').length).toBeGreaterThan(0);
    expect(screen.getAllByPlaceholderText('Password').length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Login form – validation
  // -------------------------------------------------------------------------

  it('submitting an empty login form shows required-field errors', async () => {
    const user = userEvent.setup();
    renderPage();
    // Click the first "Sign In" submit button (desktop login form)
    await user.click(screen.getAllByRole('button', { name: /^sign in$/i })[0]);
    await waitFor(() =>
      expect(screen.getAllByText('Email is required').length).toBeGreaterThan(0),
    );
  });

  // -------------------------------------------------------------------------
  // Login form – eye toggle
  // -------------------------------------------------------------------------

  it('eye toggle changes password input type from "password" to "text"', async () => {
    const user = userEvent.setup();
    renderPage();
    const passwordInputs = screen.getAllByPlaceholderText('Password');
    const firstPasswordInput = passwordInputs[0];
    expect(firstPasswordInput).toHaveAttribute('type', 'password');

    // The eye toggle is a button inside the same `.relative` wrapper as the input
    const eyeToggle = firstPasswordInput.closest('.relative')!.querySelector('button');
    await user.click(eyeToggle!);
    expect(firstPasswordInput).toHaveAttribute('type', 'text');
  });

  // -------------------------------------------------------------------------
  // Login form – successful sign-in
  // -------------------------------------------------------------------------

  it('successful sign-in calls signIn, deriveKey, login, and navigates to /', async () => {
    const mockKey = {} as CryptoKey;
    vi.mocked(signIn).mockResolvedValue({ token: 'tok', user_id: 'u1' } as never);
    vi.mocked(deriveKey).mockResolvedValue(mockKey);
    const user = userEvent.setup();
    renderPage();

    const emailInputs = screen.getAllByPlaceholderText('Email address');
    const passwordInputs = screen.getAllByPlaceholderText('Password');
    // Target the first form instance (desktop login)
    await user.type(emailInputs[0], 'test@example.com');
    await user.type(passwordInputs[0], 'password123');
    await user.click(screen.getAllByRole('button', { name: /^sign in$/i })[0]);

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith('test@example.com', 'password123');
      expect(deriveKey).toHaveBeenCalledWith('password123', 'test@example.com');
      expect(mockLogin).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  // -------------------------------------------------------------------------
  // Login form – API error
  // -------------------------------------------------------------------------

  it('shows the API error message when sign-in fails', async () => {
    vi.mocked(signIn).mockRejectedValue(new Error('Invalid credentials'));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getAllByPlaceholderText('Email address')[0], 'bad@example.com');
    await user.type(screen.getAllByPlaceholderText('Password')[0], 'wrongpass');
    await user.click(screen.getAllByRole('button', { name: /^sign in$/i })[0]);

    await waitFor(() =>
      expect(screen.getAllByText('Invalid credentials').length).toBeGreaterThan(0),
    );
  });

  // -------------------------------------------------------------------------
  // Mobile tab – switch to register
  // -------------------------------------------------------------------------

  it('clicking the mobile "Sign Up" tab reveals the confirm-password field', async () => {
    const user = userEvent.setup();
    renderPage();

    // Before switching: only the desktop register form has "Confirm password"
    const confirmBefore = screen.getAllByPlaceholderText('Confirm password').length;

    // The mobile tab button has exact text "Sign Up" (desktop overlay is "Sign Up →")
    await user.click(screen.getByRole('button', { name: 'Sign Up' }));

    await waitFor(() =>
      expect(screen.getAllByPlaceholderText('Confirm password').length).toBeGreaterThan(
        confirmBefore,
      ),
    );
  });

  // -------------------------------------------------------------------------
  // Register form – validation
  // -------------------------------------------------------------------------

  it('register form shows "At least 8 characters" for a short password', async () => {
    const user = userEvent.setup();
    renderPage();

    // Desktop register form is always in the DOM — no need to switch tabs
    const registerEmails = screen.getAllByPlaceholderText('Email address');
    const registerPasswords = screen.getAllByPlaceholderText('Password');
    const confirmInputs = screen.getAllByPlaceholderText('Confirm password');

    // Desktop register is the second email/password; confirm is only in register form
    await user.type(registerEmails[1], 'new@example.com');
    await user.type(registerPasswords[1], 'short');
    await user.type(confirmInputs[0], 'short');
    await user.click(screen.getAllByRole('button', { name: /create account/i })[0]);

    await waitFor(() =>
      expect(screen.getAllByText('At least 8 characters').length).toBeGreaterThan(0),
    );
  });

  it('register form shows "Passwords do not match" when confirm differs', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getAllByPlaceholderText('Email address')[1], 'new@example.com');
    await user.type(screen.getAllByPlaceholderText('Password')[1], 'password123');
    await user.type(screen.getAllByPlaceholderText('Confirm password')[0], 'different!');
    await user.click(screen.getAllByRole('button', { name: /create account/i })[0]);

    await waitFor(() =>
      expect(screen.getAllByText('Passwords do not match').length).toBeGreaterThan(0),
    );
  });

  // -------------------------------------------------------------------------
  // Register form – successful sign-up
  // -------------------------------------------------------------------------

  it('successful sign-up calls signUp, deriveKey, login, and navigates to /', async () => {
    const mockKey = {} as CryptoKey;
    vi.mocked(signUp).mockResolvedValue({ token: 'tok', user_id: 'u1' } as never);
    vi.mocked(deriveKey).mockResolvedValue(mockKey);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getAllByPlaceholderText('Email address')[1], 'new@example.com');
    await user.type(screen.getAllByPlaceholderText('Password')[1], 'password123');
    await user.type(screen.getAllByPlaceholderText('Confirm password')[0], 'password123');
    await user.click(screen.getAllByRole('button', { name: /create account/i })[0]);

    await waitFor(() => {
      expect(signUp).toHaveBeenCalledWith('new@example.com', 'password123');
      expect(deriveKey).toHaveBeenCalledWith('password123', 'new@example.com');
      expect(mockLogin).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  // -------------------------------------------------------------------------
  // Register form – API error
  // -------------------------------------------------------------------------

  it('shows the API error message when sign-up fails', async () => {
    vi.mocked(signUp).mockRejectedValue(new Error('Email already in use'));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getAllByPlaceholderText('Email address')[1], 'dup@example.com');
    await user.type(screen.getAllByPlaceholderText('Password')[1], 'password123');
    await user.type(screen.getAllByPlaceholderText('Confirm password')[0], 'password123');
    await user.click(screen.getAllByRole('button', { name: /create account/i })[0]);

    await waitFor(() =>
      expect(screen.getAllByText('Email already in use').length).toBeGreaterThan(0),
    );
  });
});
