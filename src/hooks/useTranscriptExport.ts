import { useCallback } from 'react';
import type { Utterance, Speaker } from '../types';

export function useTranscriptExport() {
  const exportAsJson = useCallback(
    (utterances: Utterance[], speakers: Map<string, Speaker>) => {
      const data = {
        exportedAt: new Date().toISOString(),
        speakers: Object.fromEntries(speakers),
        utterances,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      downloadBlob(blob, `transcript-${dateStamp()}.json`);
    },
    [],
  );

  const exportAsText = useCallback(
    (utterances: Utterance[], speakers: Map<string, Speaker>) => {
      const lines = utterances.map((u) => {
        const speaker = speakers.get(u.speakerId);
        const label = speaker?.label ?? u.speakerLabel;
        const time = new Date(u.timestamp).toLocaleTimeString();
        const translations = Object.entries(u.translatedTexts)
          .map(([lang, text]) => `  [${lang}] ${text}`)
          .join('\n');
        return `[${time}] ${label} (${u.detectedLanguage}):\n  ${u.originalText}\n${translations}`;
      });
      const blob = new Blob([lines.join('\n\n')], { type: 'text/plain' });
      downloadBlob(blob, `transcript-${dateStamp()}.txt`);
    },
    [],
  );

  return { exportAsJson, exportAsText };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 19).replace(/:/g, '-');
}
