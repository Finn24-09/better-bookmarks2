import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Header } from './Header';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before vi.mock() factories run
// ---------------------------------------------------------------------------
const mockLogout = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    email: 'user@example.com',
    logout: mockLogout,
  }),
}));

// Override only useNavigate; keep everything else (MemoryRouter, etc.) real.
vi.mock('react-router', async (importOriginal) => {
  const mod = await importOriginal<typeof import('react-router')>();
  return { ...mod, useNavigate: () => mockNavigate };
});

// ---------------------------------------------------------------------------

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderHeader(props: Partial<React.ComponentProps<typeof Header>> = {}) {
    return render(
      <Header
        onChangePassword={vi.fn()}
        onDeleteAccount={vi.fn()}
        {...props}
      />,
    );
  }

  it('renders the "Better Bookmarks 2" heading', () => {
    renderHeader();
    expect(screen.getByText('Better Bookmarks 2')).toBeInTheDocument();
  });

  it('renders a user-icon button', () => {
    renderHeader();
    // The DropdownMenuTrigger renders a single <button>
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('opening the dropdown shows the user email', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(screen.getByRole('button'));
    await waitFor(() =>
      expect(screen.getByText('user@example.com')).toBeInTheDocument(),
    );
  });

  it('clicking "Change Password" calls the onChangePassword prop', async () => {
    const onChangePassword = vi.fn();
    const user = userEvent.setup();
    renderHeader({ onChangePassword });
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByText('Change Password')).toBeInTheDocument());
    await user.click(screen.getByText('Change Password'));
    expect(onChangePassword).toHaveBeenCalled();
  });

  it('clicking "Log Out" calls logout() and navigates to /login', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByText('Log Out')).toBeInTheDocument());
    await user.click(screen.getByText('Log Out'));
    expect(mockLogout).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
  });

  it('clicking "Delete Account" calls the onDeleteAccount prop', async () => {
    const onDeleteAccount = vi.fn();
    const user = userEvent.setup();
    renderHeader({ onDeleteAccount });
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByText('Delete Account')).toBeInTheDocument());
    await user.click(screen.getByText('Delete Account'));
    expect(onDeleteAccount).toHaveBeenCalled();
  });

  it('clicking "Manage Tags" calls the onManageTags prop', async () => {
    const onManageTags = vi.fn();
    const user = userEvent.setup();
    renderHeader({ onManageTags });
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByText('Manage Tags')).toBeInTheDocument());
    await user.click(screen.getByText('Manage Tags'));
    expect(onManageTags).toHaveBeenCalled();
  });
});
