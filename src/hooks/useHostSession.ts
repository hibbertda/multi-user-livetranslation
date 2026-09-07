import { useState, useCallback, useRef, useEffect } from 'react';
import { SignalingChannel, type ConnectionStatus } from '../services/signalingService';
import { sendWelcome } from '../services/guestAdmission';
import type { Session, SessionGuest, SessionMessage, Utterance, Speaker } from '../types';
import { trackEvent } from '../utils/telemetry';

interface UseHostSessionOptions {
  getApiToken: () => Promise<string>;
}

interface UseHostSessionReturn {
  session: Session | null;
  guests: SessionGuest[];
  connectionStatus: 'idle' | ConnectionStatus;
  createSession: (session: Session) => void;
  resumeSession: (session: Session) => void;
  endSession: () => void;
  removeGuest: (guestId: string) => void;
  broadcastUtterance: (utterance: Utterance) => void;
  broadcastUtteranceUpdate: (utteranceId: string, translatedTexts: Record<string, string>) => void;
  broadcastSpeakerUpdate: (speaker: Speaker) => void;
}

export function useHostSession({ getApiToken }: UseHostSessionOptions): UseHostSessionReturn {
  const [session, setSession] = useState<Session | null>(null);
  const [guests, setGuests] = useState<SessionGuest[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | ConnectionStatus>('idle');

  const channelRef = useRef<SignalingChannel | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const utterancesSnapshotRef = useRef<Utterance[]>([]);
  const speakersSnapshotRef = useRef<Map<string, Speaker>>(new Map());

  const sendGuestWelcome = useCallback(async (guest: SessionGuest) => {
    if (!sessionRef.current) return;

    const accessToken = await getApiToken();
    await sendWelcome(
      sessionRef.current.id,
      guest.id,
      guest.id,
      {
        session: sessionRef.current,
        speakers: Array.from(speakersSnapshotRef.current.entries()),
        utterances: utterancesSnapshotRef.current,
      },
      accessToken,
    );
  }, [getApiToken]);

  const handleMessage = useCallback((message: SessionMessage) => {
    if (message.type === 'join') {
      setGuests((previous) => {
        if (previous.some((guest) => guest.id === message.guest.id)) return previous;
        trackEvent('session.guest_joined', { guestId: message.guest.id, guestName: message.guest.name });
        return [...previous, message.guest];
      });
      void sendGuestWelcome(message.guest);
      return;
    }

    if (message.type === 'guest-audio') {
      trackEvent('session.guest_audio_received', { guestId: message.guestId });
    }
  }, [sendGuestWelcome]);

  const connectChannel = useCallback((sessionId: string) => {
    channelRef.current?.close();

    const channel = new SignalingChannel({
      sessionId,
      role: 'host',
      onMessage: handleMessage,
      onStatus: (status) => {
        if (status === 'connecting') setConnectionStatus('connecting');
        else if (status === 'connected') setConnectionStatus('connected');
        else if (status === 'disconnected') setConnectionStatus('disconnected');
        else if (status === 'rejected') setConnectionStatus('error');
        else setConnectionStatus(status);
      },
      getAccessToken: getApiToken,
    });

    channelRef.current = channel;
    channel.connect();
  }, [getApiToken, handleMessage]);

  const createSession = useCallback((nextSession: Session) => {
    sessionRef.current = nextSession;
    setSession(nextSession);
    setGuests([]);
    utterancesSnapshotRef.current = [];
    speakersSnapshotRef.current = new Map();
    connectChannel(nextSession.id);
    trackEvent('session.created', { sessionId: nextSession.id });
  }, [connectChannel]);

  const resumeSession = useCallback((nextSession: Session) => {
    sessionRef.current = nextSession;
    setSession(nextSession);
    setGuests([]);
    utterancesSnapshotRef.current = [];
    speakersSnapshotRef.current = new Map();
    connectChannel(nextSession.id);
    trackEvent('session.resumed', { sessionId: nextSession.id });
  }, [connectChannel]);

  const endSession = useCallback(() => {
    channelRef.current?.send({ type: 'session-end' });
    channelRef.current?.close();
    channelRef.current = null;
    sessionRef.current = null;
    setSession(null);
    setGuests([]);
    setConnectionStatus('idle');
    trackEvent('session.ended');
  }, []);

  const removeGuest = useCallback((guestId: string) => {
    setGuests((previous) => previous.filter((guest) => guest.id !== guestId));
  }, []);

  const broadcastUtterance = useCallback((utterance: Utterance) => {
    utterancesSnapshotRef.current = [...utterancesSnapshotRef.current, utterance];
    channelRef.current?.send({ type: 'utterance', utterance });
  }, []);

  const broadcastUtteranceUpdate = useCallback((utteranceId: string, translatedTexts: Record<string, string>) => {
    utterancesSnapshotRef.current = utterancesSnapshotRef.current.map((utterance) => (
      utterance.id === utteranceId ? { ...utterance, translatedTexts } : utterance
    ));
    channelRef.current?.send({ type: 'utterance-update', utteranceId, translatedTexts });
  }, []);

  const broadcastSpeakerUpdate = useCallback((speaker: Speaker) => {
    speakersSnapshotRef.current.set(speaker.id, speaker);
    channelRef.current?.send({ type: 'speaker-update', speaker });
  }, []);

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
    removeGuest,
    broadcastUtterance,
    broadcastUtteranceUpdate,
    broadcastSpeakerUpdate,
  };
}
