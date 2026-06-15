import { config } from '../config';

interface TranslationResult {
  translations: { to: string; text: string }[];
  detectedLanguage?: { language: string; score: number };
}

export async function translateText(
  token: string,
  text: string,
  from: string,
  to: string[],
): Promise<TranslationResult> {
  const toParams = to.map((t) => `to=${t}`).join('&');
  const fromParam = from ? `from=${from}&` : '';
  const url = `${config.translatorEndpoint}/translator/text/v3.0/translate?${fromParam}${toParams}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([{ Text: text }]),
  });

  if (!response.ok) {
    throw new Error(`Translation failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return {
    translations: data[0].translations,
    detectedLanguage: data[0].detectedLanguage,
  };
}
