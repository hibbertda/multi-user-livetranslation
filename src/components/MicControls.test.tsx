import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MicControls } from './MicControls';

describe('MicControls', () => {
  it('offers to start listening when idle', () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    const { container } = render(<MicControls isListening={false} onStart={onStart} onStop={onStop} />);

    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('Start Listening');
    expect(button).not.toHaveClass('mic-btn--active');
    expect(container.querySelector('.mic-pulse')).toBeNull();

    fireEvent.click(button);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
  });

  it('offers to stop listening and shows the pulse while active', () => {
    const onStart = vi.fn();
    const onStop = vi.fn();
    const { container } = render(<MicControls isListening onStart={onStart} onStop={onStop} />);

    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('Stop Listening');
    expect(button).toHaveClass('mic-btn--active');
    expect(container.querySelector('.mic-pulse')).not.toBeNull();

    fireEvent.click(button);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });
});
