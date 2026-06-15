import { useCallback, useRef } from 'react';
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import { config } from '../config';
import { LANGUAGE_POOL } from '../languages';
import { fetchSpeechToken } from '../services/speechService';
import { measureAsync } from '../utils/telemetry';

export function useSpeechSynthesis(getToken: () => Promise<string>) {
  const synthesizerRef = useRef<SpeechSDK.SpeechSynthesizer | null>(null);

  const speak = useCallback(
    async (text: string, languageCode: string) => {
      return measureAsync('speech.synthesis', async () => {
        const token = await getToken();
        const speechToken = await fetchSpeechToken(token);

        const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(
          speechToken,
          config.speechRegion,
        );

        const lang = LANGUAGE_POOL.find(
          (l) => l.code === languageCode || l.code.startsWith(languageCode),
        );
        if (lang) {
          speechConfig.speechSynthesisVoiceName = lang.voiceName;
        }

        const audioConfig = SpeechSDK.AudioConfig.fromDefaultSpeakerOutput();

        if (synthesizerRef.current) {
          synthesizerRef.current.close();
        }

        const synthesizer = new SpeechSDK.SpeechSynthesizer(
          speechConfig,
          audioConfig,
        );
        synthesizerRef.current = synthesizer;

        await new Promise<void>((resolve, reject) => {
          synthesizer.speakTextAsync(
            text,
            () => {
              synthesizer.close();
              synthesizerRef.current = null;
              resolve();
            },
            (error) => {
              synthesizer.close();
              synthesizerRef.current = null;
              reject(error);
            },
          );
        });
      }, { languageCode });
    },
    [getToken],
  );

  return { speak };
}
