import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './resizable';

describe('Resizable', () => {
  it('renders a horizontal panel group', () => {
    const { container } = render(
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel defaultSize={50}>
          <div>Panel A</div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={50}>
          <div>Panel B</div>
        </ResizablePanel>
      </ResizablePanelGroup>,
    );
    expect(screen.getByText('Panel A')).toBeTruthy();
    expect(screen.getByText('Panel B')).toBeTruthy();
    expect(container.firstChild).not.toBeNull();
  });

  it('renders a vertical panel group', () => {
    const { container } = render(
      <ResizablePanelGroup direction="vertical">
        <ResizablePanel defaultSize={50}>
          <div>Top</div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={50}>
          <div>Bottom</div>
        </ResizablePanel>
      </ResizablePanelGroup>,
    );
    expect(screen.getByText('Top')).toBeTruthy();
    expect(screen.getByText('Bottom')).toBeTruthy();
    expect(container.firstChild).not.toBeNull();
  });

  it('renders ResizableHandle with withHandle prop', () => {
    const { container } = render(
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel defaultSize={50}>
          <div>Left</div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50}>
          <div>Right</div>
        </ResizablePanel>
      </ResizablePanelGroup>,
    );
    expect(container.querySelector('[data-slot="resizable-handle"]')).not.toBeNull();
  });
});
