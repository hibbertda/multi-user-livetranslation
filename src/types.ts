export const SPEAKER_COLORS = [
  '#4A90D9',
  '#E67E22',
  '#2ECC71',
  '#9B59B6',
  '#E74C3C',
  '#1ABC9C',
  '#F39C12',
  '#3498DB',
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
  translatedTexts: Record<string, string>;
  detectedLanguage: string;
  timestamp: number;
}

export interface SessionInvite {
  hash: string;
  expiresAt: number;
  revoked: boolean;
  maxUses: number;
  useCount: number;
}

export interface Session {
  id: string;
  ownerId: string;
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

export interface SessionUtterance {
  id: string;
  speakerLabel: string;
  originalText: string;
  translatedTexts: Record<string, string>;
  detectedLanguage: string;
  timestamp: number;
}

export interface SessionRecord {
  id: string;
  ownerId: string;
  title: string;
  hostName: string;
  hostEmail?: string;
  languageA: string;
  languageB: string;
  invites: SessionInvite[];
  guests: SessionGuest[];
  utteranceCount: number;
  utterances?: SessionUtterance[];
  startedAt: number;
  endedAt?: number | null;
  durationMs?: number | null;
  audioUrl?: string;
  status: 'active' | 'ended';
}

export interface GuestRequest {
  requestId: string;
  name: string;
  language: string;
  createdAt: number;
}

export interface GuestAdmission {
  guestId: string;
  admissionId: string;
  sessionId: string;
  guestName: string;
  language: string;
  admittedAt: number;
  revoked: boolean;
}

export type SessionMessage =
  | { type: 'join'; guest: SessionGuest }
  | { type: 'welcome'; session: Session; speakers: [string, Speaker][]; utterances: Utterance[]; targetGuestId?: string }
  | { type: 'utterance'; utterance: Utterance }
  | { type: 'utterance-update'; utteranceId: string; translatedTexts: Record<string, string> }
  | { type: 'speaker-update'; speaker: Speaker }
  | { type: 'guest-audio'; guestId: string; text: string; detectedLanguage: string }
  | { type: 'session-end' }
  | { type: 'revoked'; guestId: string; message?: string }
  | { type: 'error'; message: string };
