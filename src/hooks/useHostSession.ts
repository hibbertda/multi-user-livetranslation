import { useState, useCallback, useRef, useEffect } from 'react';
import { SignalingChannel } from '../services/signalingService';
import type { Session, SessionGuest, SessionMessage, Utterance, Speaker } from '../types';
import { createId } from '../utils/id';
import { trackEvent } from '../utils/telemetry';

interface UseHostSessionReturn {
  session: Session | null;
  guests: SessionGuest[];
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
  createSession: (hostName: string, languageA: string, languageB: string) => void;
  resumeSession: (session: Session) => void;
  endSession: () => void;
  inviteUrl: string | null;
  broadcastUtterance: (utterance: Utterance) => void;
  broadcastUtteranceUpdate: (utteranceId: string, translatedTexts: Record<string, string>) => void;
  broadcastSpeakerUpdate: (speaker: Speaker) => void;
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function useHostSession(): UseHostSessionReturn {
  const [session, setSession] = useState<Session | null>(null);
  const [guests, setGuests] = useState<SessionGuest[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<
    'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
  >('idle');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const channelRef = useRef<SignalingChannel | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const utterancesSnapshotRef = useRef<Utterance[]>([]);
  const speakersSnapshotRef = useRef<Map<string, Speaker>>(new Map());

  const handleMessage = useCallback((msg: SessionMessage) => {
    if (msg.type === 'join') {
      setGuests((prev) => {
        if (prev.some((g) => g.id === msg.guest.id)) return prev;
        trackEvent('session.guest_joined', { guestId: msg.guest.id, guestName: msg.guest.name });
        return [...prev, msg.guest];
      });
      // Send welcome with current state (read from ref, not stale closure)
      channelRef.current?.send({
        type: 'welcome',
        session: sessionRef.current!,
        speakers: Array.from(speakersSnapshotRef.current.entries()),
        utterances: utterancesSnapshotRef.current,
      });
    }
  }, []);

  /** Shared helper: connect signaling channel for a given session */
  const connectChannel = useCallback((id: string, token: string) => {
    // Close any existing channel first
    channelRef.current?.close();

    const baseUrl = import.meta.env.VITE_INVITE_BASE_URL || window.location.origin;
    const url = `${baseUrl}/join?session=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`;
    setInviteUrl(url);

    const channel = new SignalingChannel({
      sessionId: id,
      token,
      role: 'host',
      onMessage: handleMessage,
      onStatus: (status) => {
        if (status === 'connecting') setConnectionStatus('connecting');
        else if (status === 'connected') setConnectionStatus('connected');
        else if (status === 'disconnected') setConnectionStatus('disconnected');
        else setConnectionStatus('error');
      },
    });

    channelRef.current = channel;
    channel.connect();
  }, [handleMessage]);

  const createSession = useCallback((hostName: string, languageA: string, languageB: string) => {
    const id = createId();
    const token = generateToken();
    const newSession: Session = {
      id,
      token,
      hostName,
      createdAt: Date.now(),
      languageA,
      languageB,
    };

    sessionRef.current = newSession;
    setSession(newSession);
    setGuests([]);
    utterancesSnapshotRef.current = [];
    speakersSnapshotRef.current = new Map();

    connectChannel(id, token);
    trackEvent('session.created', { sessionId: id });
  }, [connectChannel]);

  const resumeSession = useCallback((prev: Session) => {
    sessionRef.current = prev;
    setSession(prev);
    setGuests([]);
    utterancesSnapshotRef.current = [];
    speakersSnapshotRef.current = new Map();

    connectChannel(prev.id, prev.token);
    trackEvent('session.resumed', { sessionId: prev.id });
  }, [connectChannel]);

  const endSession = useCallback(() => {
    channelRef.current?.send({ type: 'session-end' });
    channelRef.current?.close();
    channelRef.current = null;
    setSession(null);
    setGuests([]);
    setInviteUrl(null);
    setConnectionStatus('idle');
    trackEvent('session.ended');
  }, []);

  const broadcastUtterance = useCallback((utterance: Utterance) => {
    utterancesSnapshotRef.current = [...utterancesSnapshotRef.current, utterance];
    channelRef.current?.send({ type: 'utterance', utterance });
  }, []);

  const broadcastUtteranceUpdate = useCallback((utteranceId: string, translatedTexts: Record<string, string>) => {
    utterancesSnapshotRef.current = utterancesSnapshotRef.current.map((u) =>
      u.id === utteranceId ? { ...u, translatedTexts } : u,
    );
    channelRef.current?.send({ type: 'utterance-update', utteranceId, translatedTexts });
  }, []);

  const broadcastSpeakerUpdate = useCallback((speaker: Speaker) => {
    speakersSnapshotRef.current.set(speaker.id, speaker);
    channelRef.current?.send({ type: 'speaker-update', speaker });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      channelRef.current?.close();
    };
  }, []);

  return {
    session,
    guests,
    connectionStatus,
    createSession,
    resumeSession,
    endSession,
    inviteUrl,
    broadcastUtterance,
    broadcastUtteranceUpdate,
    broadcastSpeakerUpdate,
  };
}
