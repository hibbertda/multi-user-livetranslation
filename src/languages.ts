export interface SupportedLanguage {
  code: string;
  label: string;
  voiceName: string;
  flag: string;
}

export const LANGUAGE_POOL: SupportedLanguage[] = [
  { code: 'en-US', label: 'English', voiceName: 'en-US-AvaNeural', flag: 'US' },
  { code: 'ar-SA', label: 'Arabic', voiceName: 'ar-SA-ZariyahNeural', flag: 'SA' },
  { code: 'es-ES', label: 'Spanish', voiceName: 'es-ES-ElviraNeural', flag: 'ES' },
  { code: 'fr-FR', label: 'French', voiceName: 'fr-FR-DeniseNeural', flag: 'FR' },
  { code: 'de-DE', label: 'German', voiceName: 'de-DE-KatjaNeural', flag: 'DE' },
  { code: 'zh-CN', label: 'Chinese', voiceName: 'zh-CN-XiaoxiaoNeural', flag: 'CN' },
  { code: 'ja-JP', label: 'Japanese', voiceName: 'ja-JP-NanamiNeural', flag: 'JP' },
  { code: 'pt-BR', label: 'Portuguese', voiceName: 'pt-BR-FranciscaNeural', flag: 'BR' },
  { code: 'hi-IN', label: 'Hindi', voiceName: 'hi-IN-SwaraNeural', flag: 'IN' },
  { code: 'ko-KR', label: 'Korean', voiceName: 'ko-KR-SunHiNeural', flag: 'KR' },
];

export const ALL_LID_LANGUAGES: { name: string; locale: string }[] = [
  { name: 'Afrikaans', locale: 'af-ZA' },
  { name: 'Albanian', locale: 'sq-AL' },
  { name: 'Amharic', locale: 'am-ET' },
  { name: 'Arabic', locale: 'ar-SA' },
  { name: 'Armenian', locale: 'hy-AM' },
  { name: 'Assamese', locale: 'as-IN' },
  { name: 'Azerbaijani', locale: 'az-AZ' },
  { name: 'Basque', locale: 'eu-ES' },
  { name: 'Bengali', locale: 'bn-IN' },
  { name: 'Bosnian', locale: 'bs-BA' },
  { name: 'Bulgarian', locale: 'bg-BG' },
  { name: 'Burmese', locale: 'my-MM' },
  { name: 'Catalan', locale: 'ca-ES' },
  { name: 'Chinese', locale: 'zh-CN' },
  { name: 'Croatian', locale: 'hr-HR' },
  { name: 'Czech', locale: 'cs-CZ' },
  { name: 'Danish', locale: 'da-DK' },
  { name: 'Dutch', locale: 'nl-NL' },
  { name: 'English', locale: 'en-US' },
  { name: 'Estonian', locale: 'et-EE' },
  { name: 'Filipino', locale: 'fil-PH' },
  { name: 'Finnish', locale: 'fi-FI' },
  { name: 'French', locale: 'fr-FR' },
  { name: 'Galician', locale: 'gl-ES' },
  { name: 'Georgian', locale: 'ka-GE' },
  { name: 'German', locale: 'de-DE' },
  { name: 'Greek', locale: 'el-GR' },
  { name: 'Gujarati', locale: 'gu-IN' },
  { name: 'Hebrew', locale: 'he-IL' },
  { name: 'Hindi', locale: 'hi-IN' },
  { name: 'Hungarian', locale: 'hu-HU' },
  { name: 'Icelandic', locale: 'is-IS' },
  { name: 'Indonesian', locale: 'id-ID' },
  { name: 'Irish', locale: 'ga-IE' },
  { name: 'isiZulu', locale: 'zu-ZA' },
  { name: 'Italian', locale: 'it-IT' },
  { name: 'Japanese', locale: 'ja-JP' },
  { name: 'Javanese', locale: 'jv-ID' },
  { name: 'Kannada', locale: 'kn-IN' },
  { name: 'Kazakh', locale: 'kk-KZ' },
  { name: 'Khmer', locale: 'km-KH' },
  { name: 'Kiswahili', locale: 'sw-KE' },
  { name: 'Korean', locale: 'ko-KR' },
  { name: 'Lao', locale: 'lo-LA' },
  { name: 'Latvian', locale: 'lv-LV' },
  { name: 'Lithuanian', locale: 'lt-LT' },
  { name: 'Macedonian', locale: 'mk-MK' },
  { name: 'Malay', locale: 'ms-MY' },
  { name: 'Malayalam', locale: 'ml-IN' },
  { name: 'Maltese', locale: 'mt-MT' },
  { name: 'Marathi', locale: 'mr-IN' },
  { name: 'Mongolian', locale: 'mn-MN' },
  { name: 'Nepali', locale: 'ne-NP' },
  { name: 'Norwegian Bokmal', locale: 'nb-NO' },
  { name: 'Odia', locale: 'or-IN' },
  { name: 'Pashto', locale: 'ps-AF' },
  { name: 'Persian', locale: 'fa-IR' },
  { name: 'Polish', locale: 'pl-PL' },
  { name: 'Portuguese', locale: 'pt-BR' },
  { name: 'Punjabi', locale: 'pa-IN' },
  { name: 'Romanian', locale: 'ro-RO' },
  { name: 'Russian', locale: 'ru-RU' },
  { name: 'Serbian', locale: 'sr-RS' },
  { name: 'Sinhala', locale: 'si-LK' },
  { name: 'Slovak', locale: 'sk-SK' },
  { name: 'Slovenian', locale: 'sl-SI' },
  { name: 'Somali', locale: 'so-SO' },
  { name: 'Spanish', locale: 'es-ES' },
  { name: 'Swedish', locale: 'sv-SE' },
  { name: 'Tamil', locale: 'ta-IN' },
  { name: 'Telugu', locale: 'te-IN' },
  { name: 'Thai', locale: 'th-TH' },
  { name: 'Turkish', locale: 'tr-TR' },
  { name: 'Ukrainian', locale: 'uk-UA' },
  { name: 'Urdu', locale: 'ur-IN' },
  { name: 'Uzbek', locale: 'uz-UZ' },
  { name: 'Vietnamese', locale: 'vi-VN' },
  { name: 'Welsh', locale: 'cy-GB' },
];

const FLAG_BY_BASE_LANGUAGE: Record<string, string> = {
  ar: 'SA',
  de: 'DE',
  en: 'US',
  es: 'ES',
  fr: 'FR',
  he: 'IL',
  hi: 'IN',
  id: 'ID',
  it: 'IT',
  ja: 'JP',
  ko: 'KR',
  ms: 'MY',
  nb: 'NO',
  nl: 'NL',
  pl: 'PL',
  pt: 'BR',
  ru: 'RU',
  sv: 'SE',
  th: 'TH',
  tr: 'TR',
  uk: 'UA',
  vi: 'VN',
  zh: 'CN',
};

const REGIONAL_INDICATOR_OFFSET = 0x1f1e6;
const ASCII_A = 65;

function toFlagEmoji(regionCode: string): string {
  const upper = regionCode.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return '🏳️';
  const chars = upper
    .split('')
    .map((char) => String.fromCodePoint(REGIONAL_INDICATOR_OFFSET + char.charCodeAt(0) - ASCII_A));
  return chars.join('');
}

export function toLanguageBase(languageCode: string): string {
  return languageCode.split('-')[0].toLowerCase();
}

export function getLanguageLabel(languageCode: string): string {
  const exact = LANGUAGE_POOL.find((language) => language.code === languageCode);
  if (exact) return exact.label;

  const languageBase = toLanguageBase(languageCode);
  const byPoolBase = LANGUAGE_POOL.find((language) => toLanguageBase(language.code) === languageBase);
  if (byPoolBase) return byPoolBase.label;

  const byLid = ALL_LID_LANGUAGES.find((language) => language.locale === languageCode);
  if (byLid) return byLid.name;

  return languageCode;
}

export function lookupLanguageDisplay(languageCode: string): { flag: string; name: string; code: string } {
  const exact = LANGUAGE_POOL.find((language) => language.code === languageCode);
  if (exact) {
    return {
      flag: toFlagEmoji(exact.flag),
      name: exact.label,
      code: languageCode,
    };
  }

  const languageBase = toLanguageBase(languageCode);
  const byPoolBase = LANGUAGE_POOL.find((language) => toLanguageBase(language.code) === languageBase);
  if (byPoolBase) {
    return {
      flag: toFlagEmoji(byPoolBase.flag),
      name: byPoolBase.label,
      code: languageCode,
    };
  }

  const byLid = ALL_LID_LANGUAGES.find((language) => language.locale === languageCode);
  const regionFromCode = languageCode.split('-')[1] ?? FLAG_BY_BASE_LANGUAGE[languageBase] ?? 'UN';

  return {
    flag: toFlagEmoji(regionFromCode),
    name: byLid?.name ?? languageCode,
    code: languageCode,
  };
}

export const DEFAULT_LID_CODES = new Set(LANGUAGE_POOL.map((language) => language.code));
