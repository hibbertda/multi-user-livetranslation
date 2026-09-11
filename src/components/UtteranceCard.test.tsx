import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UtteranceCard } from './UtteranceCard';
import type { Speaker, Utterance } from '../types';

const BASE_UTTERANCE: Utterance = {
  id: 'u1',
  speakerId: 's1',
  speakerLabel: 'Speaker 2',
  originalText: 'Good morning',
  translatedTexts: { es: 'Buenos días' },
  detectedLanguage: 'en-US',
  timestamp: Date.UTC(2024, 0, 1, 12, 0, 0),
} as Utterance;

function renderCard(overrides: Partial<Parameters<typeof UtteranceCard>[0]> = {}) {
  const onSpeak = vi.fn();
  const utils = render(
    <UtteranceCard
      utterance={BASE_UTTERANCE}
      speaker={undefined}
      displayLanguage="en-US"
      onSpeak={onSpeak}
      {...overrides}
    />,
  );
  return { ...utils, onSpeak };
}

describe('UtteranceCard', () => {
  it('shows the original text when the display language matches the detected language', () => {
    renderCard();

    expect(screen.getByText('Good morning')).toBeInTheDocument();
    // The translation is shown as a subtitle.
    expect(screen.getByText('Buenos días')).toBeInTheDocument();
  });

  it('shows the translation when the display language differs', () => {
    renderCard({ displayLanguage: 'es-ES' });

    const text = screen.getByText('Buenos días');
    expect(text).toHaveClass('chat-bubble-text');
    expect(screen.getByText('Good morning')).toHaveClass('chat-bubble-subtitle');
  });

  it('falls back to the original text when no translation exists for the language', () => {
    renderCard({ displayLanguage: 'fr-FR' });

    expect(screen.getByText('Good morning')).toHaveClass('chat-bubble-text');
    expect(document.querySelector('.chat-bubble-subtitle')).toBeNull();
  });

  it('uses the speaker number as avatar initials for default labels', () => {
    renderCard();
    expect(screen.getByTitle('Speaker 2')).toHaveTextContent('2');
  });

  it('uses up to two initials for custom speaker names', () => {
    const speaker = { id: 's1', label: 'Ada Lovelace King', color: '#123456' } as Speaker;
    renderCard({ speaker });

    const avatar = screen.getByTitle('Ada Lovelace King');
    expect(avatar).toHaveTextContent('AL');
    expect(avatar).toHaveStyle({ backgroundColor: '#123456' });
  });

  it('prefers the speaker label over the utterance label', () => {
    renderCard({ speaker: { id: 's1', label: 'Alice', color: '#000' } as Speaker });

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Speaker 2')).not.toBeInTheDocument();
  });

  it('speaks the displayed text in the display language', () => {
    const { onSpeak } = renderCard({ displayLanguage: 'es-ES' });

    fireEvent.click(screen.getByTitle('Listen'));

    expect(onSpeak).toHaveBeenCalledWith('Buenos días', 'es-ES');
  });

  it('applies the alignment modifier class', () => {
    const { container } = renderCard({ align: 'right' });

    expect(container.querySelector('.chat-bubble-row--right')).not.toBeNull();
    expect(container.querySelector('.chat-bubble--right')).not.toBeNull();
  });

  it('defaults to left alignment', () => {
    const { container } = renderCard();

    expect(container.querySelector('.chat-bubble-row--left')).not.toBeNull();
  });
});
