import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { setupUser } from '../../test/userEvent';
import { TagMultiSelect } from './TagMultiSelect';
import { MAX_TAG_LENGTH, type Tag } from '../../lib/tags';
import { Popover } from './ui/popover';

// Spy on the local Popover wrapper so we can assert that TagMultiSelect
// opts into modal mode. modal={true} is what makes Radix wrap the popover
// content in react-remove-scroll, which is what unblocks touch scrolling
// inside the dropdown when this component is nested in a Dialog.
vi.mock('./ui/popover', async () => {
  const actual = await vi.importActual<typeof import('./ui/popover')>('./ui/popover');
  return { ...actual, Popover: vi.fn(actual.Popover) };
});

function makeTags(names: string[]): Tag[] {
  return names.map((name, i) => ({ id: `tag-${i + 1}`, name }));
}

describe('TagMultiSelect', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the Popover in modal mode so touch scrolling inside the dropdown is not blocked when nested in a Dialog', () => {
    render(
      <TagMultiSelect
        available={makeTags(['React', 'TypeScript'])}
        selected={[]}
        onChange={vi.fn()}
      />,
    );
    expect(vi.mocked(Popover)).toHaveBeenCalled();
    const props = vi.mocked(Popover).mock.calls[0][0];
    expect(props.modal).toBe(true);
  });

  it('shows "Select tags…" placeholder when nothing is selected', () => {
    render(
      <TagMultiSelect available={makeTags(['React', 'TypeScript'])} selected={[]} onChange={vi.fn()} />,
    );
    expect(screen.getByText('Select tags…')).toBeInTheDocument();
  });

  it('shows the count when tags are selected', () => {
    const tags = makeTags(['React', 'TypeScript']);
    render(
      <TagMultiSelect available={tags} selected={['tag-1', 'tag-2']} onChange={vi.fn()} />,
    );
    expect(screen.getByText('2 tags selected')).toBeInTheDocument();
  });

  it('clicking the trigger opens the popover showing available tags', async () => {
    const user = setupUser();
    render(
      <TagMultiSelect available={makeTags(['React', 'TypeScript'])} selected={[]} onChange={vi.fn()} />,
    );
    await user.click(screen.getByRole('combobox'));
    await waitFor(() => {
      expect(screen.getByText('React')).toBeInTheDocument();
      expect(screen.getByText('TypeScript')).toBeInTheDocument();
    });
  });

  it('clicking a tag calls onChange with that tag id added to selection', async () => {
    const onChange = vi.fn();
    const user = setupUser();
    const tags = makeTags(['React', 'TypeScript']);
    render(<TagMultiSelect available={tags} selected={[]} onChange={onChange} />);

    await user.click(screen.getByRole('combobox'));
    await waitFor(() => expect(screen.getByText('React')).toBeInTheDocument());
    await user.click(screen.getByText('React'));

    expect(onChange).toHaveBeenCalledWith(['tag-1']);
  });

  it('clicking an already-selected tag removes it from the selection', async () => {
    const onChange = vi.fn();
    const user = setupUser();
    const tags = makeTags(['React', 'TypeScript']);
    render(<TagMultiSelect available={tags} selected={['tag-1']} onChange={onChange} />);

    await user.click(screen.getByRole('combobox'));
    // Use role='option' to target the list item specifically (the selected pill
    // also has "React" text, so getByText would find two matches).
    await waitFor(() => expect(screen.getByRole('option', { name: /react/i })).toBeInTheDocument());
    await user.click(screen.getByRole('option', { name: /react/i }));

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('typing in the search input filters the visible tags', async () => {
    const user = setupUser();
    render(
      <TagMultiSelect
        available={makeTags(['React', 'TypeScript', 'CSS'])}
        selected={[]}
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('combobox'));
    await waitFor(() => expect(screen.getByText('React')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('Search tags\u2026'), 'type');

    await waitFor(() => {
      expect(screen.queryByText('React')).not.toBeInTheDocument();
      expect(screen.getByText('TypeScript')).toBeInTheDocument();
    });
  });

  it('shows a "Create" option when the search term has no matching tag', async () => {
    const user = setupUser();
    render(
      <TagMultiSelect
        available={makeTags(['React'])}
        selected={[]}
        onChange={vi.fn()}
        onCreateTag={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('combobox'));
    await user.type(screen.getByPlaceholderText('Search tags\u2026'), 'Vue');

    await waitFor(() =>
      expect(screen.getByText(/create "vue"/i)).toBeInTheDocument(),
    );
  });

  it('clicking "Create …" calls onCreateTag and adds the tag to selection', async () => {
    const newTag: Tag = { id: 'tag-new', name: 'Vue' };
    const onCreateTag = vi.fn().mockResolvedValue(newTag);
    const onChange = vi.fn();
    const user = setupUser();
    render(
      <TagMultiSelect
        available={makeTags(['React'])}
        selected={[]}
        onChange={onChange}
        onCreateTag={onCreateTag}
      />,
    );

    await user.click(screen.getByRole('combobox'));
    await user.type(screen.getByPlaceholderText('Search tags\u2026'), 'Vue');
    await waitFor(() => expect(screen.getByText(/create "vue"/i)).toBeInTheDocument());
    await user.click(screen.getByText(/create "vue"/i));

    await waitFor(() => {
      expect(onCreateTag).toHaveBeenCalledWith('Vue');
      expect(onChange).toHaveBeenCalledWith(['tag-new']);
    });
  });

  it('hides the Create option and shows an inline error when the search exceeds MAX_TAG_LENGTH', async () => {
    const user = setupUser();
    const onCreateTag = vi.fn();
    render(
      <TagMultiSelect
        available={[]}
        selected={[]}
        onChange={vi.fn()}
        onCreateTag={onCreateTag}
      />,
    );

    await user.click(screen.getByRole('combobox'));

    // The CommandInput has HTML maxLength = MAX_TAG_LENGTH + 1 = 101, so
    // typing past that point is clamped by the browser. Set the value
    // directly via fireEvent.change to simulate a paste / autofill that
    // bypasses the HTML attribute (the test's job is to verify the JS
    // length guard, not the HTML clamp).
    const input = screen.getByPlaceholderText('Search tags…') as HTMLInputElement;
    // Confirm the HTML maxLength attribute actually reaches the underlying input
    // (cmdk's CommandInput is a wrapper; this guards against a future change to
    // its prop forwarding silently turning the HTML clamp into dead code).
    expect(input).toHaveAttribute('maxlength', String(MAX_TAG_LENGTH + 1));
    fireEvent.change(input, { target: { value: 'a'.repeat(MAX_TAG_LENGTH + 1) } });

    expect(screen.getByText(/100 characters or fewer/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Create "/i)).not.toBeInTheDocument();
    expect(onCreateTag).not.toHaveBeenCalled();
  });

  it('selected tags are shown as pills below the trigger', () => {
    const tags = makeTags(['React', 'TypeScript']);
    render(
      <TagMultiSelect available={tags} selected={['tag-1']} onChange={vi.fn()} />,
    );
    // The pill's remove button has aria-label "Remove React"
    expect(screen.getByRole('button', { name: /remove react/i })).toBeInTheDocument();
  });

  it('clicking the X pill button removes that tag from selection', async () => {
    const onChange = vi.fn();
    const user = setupUser();
    const tags = makeTags(['React', 'TypeScript']);
    render(
      <TagMultiSelect available={tags} selected={['tag-1']} onChange={onChange} />,
    );

    await user.click(screen.getByRole('button', { name: /remove react/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('shows "1 tag selected" (singular) when exactly one tag is selected', () => {
    const tags = makeTags(['React']);
    render(
      <TagMultiSelect available={tags} selected={['tag-1']} onChange={vi.fn()} />,
    );
    expect(screen.getByText('1 tag selected')).toBeInTheDocument();
  });
});
