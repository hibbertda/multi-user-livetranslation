import { useEffect, useRef } from 'react';
import type { Utterance, Speaker } from '../types';
import { UtteranceCard } from './UtteranceCard';

interface Props {
  utterances: Utterance[];
  speakers: Map<string, Speaker>;
  displayLanguage: string;
  title: string;
  onSpeak: (text: string, lang: string) => void;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  onScroll?: () => void;
}

export function ConversationPanel({
  utterances,
  speakers,
  displayLanguage,
  title,
  onSpeak,
  scrollRef,
  onScroll,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const internalRef = useRef<HTMLDivElement>(null);
  const listRef = scrollRef ?? internalRef;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [utterances]);

  // Track speaker order for alternating alignment
  const speakerOrder: string[] = [];
  utterances.forEach((u) => {
    if (!speakerOrder.includes(u.speakerId)) speakerOrder.push(u.speakerId);
  });

  return (
    <div className="conversation-panel">
      <h2 className="panel-title">{title}</h2>
      <div className="utterance-list" ref={listRef} onScroll={onScroll}>
        {utterances.map((u) => {
          const speakerIdx = speakerOrder.indexOf(u.speakerId);
          return (
            <UtteranceCard
              key={u.id}
              utterance={u}
              speaker={speakers.get(u.speakerId)}
              displayLanguage={displayLanguage}
              onSpeak={onSpeak}
              align={speakerIdx % 2 === 0 ? 'left' : 'right'}
            />
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
