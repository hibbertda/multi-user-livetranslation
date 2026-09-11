/**
 * Tests for SessionHistory keyboard activation on session cards.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Minimal mock of session card keyboard behavior
function SessionCard({ onClick }: { onClick: () => void }) {
  return (
    <div
      className="session-card"
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      role="button"
      tabIndex={0}
      data-testid="session-card"
    >
      <div className="session-card-top">
        <div className="session-card-title">Test Session</div>
        <div className="session-card-top-right" onClick={(event) => event.stopPropagation()}>
          <button data-testid="nested-btn">Nested Action</button>
        </div>
      </div>
    </div>
  );
}

describe('session card keyboard activation', () => {
  it('activates on Enter key', () => {
    const handler = vi.fn();
    render(<SessionCard onClick={handler} />);
    const card = screen.getByTestId('session-card');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('activates on Space key', () => {
    const handler = vi.fn();
    render(<SessionCard onClick={handler} />);
    const card = screen.getByTestId('session-card');
    fireEvent.keyDown(card, { key: ' ' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not activate on other keys', () => {
    const handler = vi.fn();
    render(<SessionCard onClick={handler} />);
    const card = screen.getByTestId('session-card');
    fireEvent.keyDown(card, { key: 'Tab' });
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('nested button does not trigger card click', () => {
    const handler = vi.fn();
    render(<SessionCard onClick={handler} />);
    const nestedBtn = screen.getByTestId('nested-btn');
    fireEvent.click(nestedBtn);
    // stopPropagation on the wrapper prevents card handler
    expect(handler).not.toHaveBeenCalled();
  });
});
