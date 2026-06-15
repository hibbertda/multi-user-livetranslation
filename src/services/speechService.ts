import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';
import { config } from '../config';

/**
 * Exchange an Entra ID access token for a short-lived Speech SDK token.
 */
export async function fetchSpeechToken(entraToken: string): Promise<string> {
  const url = `https://${config.speechResourceName}.cognitiveservices.azure.com/sts/v1.0/issueToken`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${entraToken}`,
      'Content-Length': '0',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Speech token exchange failed (${res.status}): ${body}`);
  }
  return res.text();
}

export function createTranscriber(
  speechToken: string,
  languageCodes: string[],
  deviceId?: string,
): SpeechSDK.ConversationTranscriber {
  const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(
    speechToken,
    config.speechRegion,
  );

  speechConfig.setProperty(
    'SpeechServiceConnection_LanguageIdMode',
    'Continuous',
  );

  const autoDetectConfig =
    SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(languageCodes);

  const audioConfig = deviceId
    ? SpeechSDK.AudioConfig.fromMicrophoneInput(deviceId)
    : SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();

  const transcriber = SpeechSDK.ConversationTranscriber.FromConfig(
    speechConfig,
    autoDetectConfig,
    audioConfig,
  );

  return transcriber;
}

/**
 * Create a TranslationRecognizer for real-time inline translation.
 * The recognizer fires `recognizing` (partial) and `recognized` (final) events
 * that include translations directly — no separate Translator API call needed.
 */
export function createTranslationRecognizer(
  speechToken: string,
  sourceLanguages: string[],
  targetLanguages: string[],
  deviceId?: string,
): SpeechSDK.TranslationRecognizer {
  const translationConfig = SpeechSDK.SpeechTranslationConfig.fromAuthorizationToken(
    speechToken,
    config.speechRegion,
  );

  // Add target languages (base language codes like 'en', 'es', 'ar')
  for (const lang of targetLanguages) {
    translationConfig.addTargetLanguage(lang);
  }

  translationConfig.setProperty(
    'SpeechServiceConnection_LanguageIdMode',
    'Continuous',
  );

  const autoDetectConfig =
    SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(sourceLanguages);

  const audioConfig = deviceId
    ? SpeechSDK.AudioConfig.fromMicrophoneInput(deviceId)
    : SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();

  return SpeechSDK.TranslationRecognizer.FromConfig(
    translationConfig,
    autoDetectConfig,
    audioConfig,
  );
}
