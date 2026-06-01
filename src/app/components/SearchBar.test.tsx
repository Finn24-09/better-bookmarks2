import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { setupUser } from '../../test/userEvent';
import { SearchBar } from './SearchBar';

describe('SearchBar', () => {
  it('renders input with placeholder "Search bookmarks..."', () => {
    render(<SearchBar value="" onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText('Search bookmarks...')).toBeInTheDocument();
  });

  it('calls onChange when the user types', async () => {
    const onChange = vi.fn();
    const user = setupUser();
    render(<SearchBar value="" onChange={onChange} />);
    await user.type(screen.getByPlaceholderText('Search bookmarks...'), 'react');
    expect(onChange).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('r'));
  });

  it('does not render the clear button when value is empty', () => {
    render(<SearchBar value="" onChange={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders the clear button when value is non-empty', () => {
    render(<SearchBar value="hello" onChange={vi.fn()} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('clicking the clear button calls onChange with an empty string', async () => {
    const onChange = vi.fn();
    const user = setupUser();
    render(<SearchBar value="react" onChange={onChange} />);
    await user.click(screen.getByRole('button'));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('clear button disappears when value is reset to empty', () => {
    const { rerender } = render(<SearchBar value="react" onChange={vi.fn()} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
    rerender(<SearchBar value="" onChange={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
