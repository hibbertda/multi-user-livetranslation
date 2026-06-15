export const SPEAKER_COLORS = [
  '#4A90D9', // blue
  '#E67E22', // orange
  '#2ECC71', // green
  '#9B59B6', // purple
  '#E74C3C', // red
  '#1ABC9C', // teal
  '#F39C12', // yellow
  '#3498DB', // light blue
];

export type DetectionMode = 'auto' | 'specify';
export type TranslationMode = 'standard' | 'realtime';

export interface Speaker {
  id: string;
  label: string;
  language: string;
  color: string;
}

export interface Utterance {
  id: string;
  speakerId: string;
  speakerLabel: string;
  originalText: string;
  translatedTexts: Record<string, string>; // key = language code
  detectedLanguage: string;
  timestamp: number;
}

// ---------- Session Sharing ----------

export interface Session {
  id: string;
  token: string;
  hostName: string;
  createdAt: number;
  languageA: string;
  languageB: string;
  title?: string;
}

export interface SessionGuest {
  id: string;
  name: string;
  email?: string;
  language: string;
  joinedAt: number;
}

/** Lightweight utterance stored in a session record */
export interface SessionUtterance {
  id: string;
  speakerLabel: string;
  originalText: string;
  translatedTexts: Record<string, string>;
  detectedLanguage: string;
  timestamp: number;
}

/** Persisted session record stored in Cosmos DB */
export interface SessionRecord {
  id: string;
  token: string;
  title: string;
  hostName: string;
  hostEmail?: string;
  languageA: string;
  languageB: string;
  guests: SessionGuest[];
  utteranceCount: number;
  utterances?: SessionUtterance[];
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  audioUrl?: string;
  status: 'active' | 'ended';
}

export type SessionMessage =
  | { type: 'join'; guest: SessionGuest }
  | { type: 'welcome'; session: Session; speakers: [string, Speaker][]; utterances: Utterance[] }
  | { type: 'utterance'; utterance: Utterance }
  | { type: 'utterance-update'; utteranceId: string; translatedTexts: Record<string, string> }
  | { type: 'speaker-update'; speaker: Speaker }
  | { type: 'guest-audio'; guestId: string; text: string; detectedLanguage: string }
  | { type: 'session-end' }
  | { type: 'error'; message: string };
