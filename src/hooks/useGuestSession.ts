import { useState, useCallback, useRef, useEffect } from 'react';
import { SignalingChannel } from '../services/signalingService';
import type { Session, SessionGuest, SessionMessage, Utterance, Speaker } from '../types';
import { createId } from '../utils/id';
import { trackEvent } from '../utils/telemetry';

interface UseGuestSessionOptions {
  sessionId: string;
  token: string;
}

interface UseGuestSessionReturn {
  session: Session | null;
  utterances: Utterance[];
  speakers: Map<string, Speaker>;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'ended' | 'error' | 'rejected';
  join: (name: string, email: string | undefined, language: string) => void;
  sendGuestAudio: (text: string, detectedLanguage: string) => void;
  guestId: string;
  sessionEnded: boolean;
}

export function useGuestSession({ sessionId, token }: UseGuestSessionOptions): UseGuestSessionReturn {
  const [session, setSession] = useState<Session | null>(null);
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [speakers, setSpeakers] = useState<Map<string, Speaker>>(new Map());
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'disconnected' | 'ended' | 'error' | 'rejected'
  >('connecting');
  const [sessionEnded, setSessionEnded] = useState(false);

  const channelRef = useRef<SignalingChannel | null>(null);
  const guestIdRef = useRef(createId());

  const handleMessage = useCallback((msg: SessionMessage) => {
    switch (msg.type) {
      case 'welcome':
        setSession(msg.session);
        setUtterances(msg.utterances);
        setSpeakers(new Map(msg.speakers));
        trackEvent('guest.welcome_received', { utteranceCount: msg.utterances.length });
        break;

      case 'utterance':
        setUtterances((prev) => [...prev, msg.utterance]);
        break;

      case 'utterance-update':
        setUtterances((prev) =>
          prev.map((u) =>
            u.id === msg.utteranceId ? { ...u, translatedTexts: msg.translatedTexts } : u,
          ),
        );
        break;

      case 'speaker-update':
        setSpeakers((prev) => {
          const next = new Map(prev);
          next.set(msg.speaker.id, msg.speaker);
          return next;
        });
        break;

      case 'session-end':
        setSessionEnded(true);
        setConnectionStatus('ended');
        channelRef.current?.close();
        trackEvent('guest.session_ended');
        break;

      case 'error':
        trackEvent('guest.error', { message: msg.message });
        break;
    }
  }, []);

  const join = useCallback((name: string, email: string | undefined, language: string) => {
    const guest: SessionGuest = {
      id: guestIdRef.current,
      name,
      email,
      language,
      joinedAt: Date.now(),
    };

    const channel = new SignalingChannel({
      sessionId,
      token,
      role: 'guest',
      onMessage: handleMessage,
      onStatus: (status) => {
        if (status === 'connected') {
          setConnectionStatus('connected');
          channel.send({ type: 'join', guest });
        } else if (status === 'connecting') {
          setConnectionStatus('connecting');
        } else if (status === 'disconnected') {
          setConnectionStatus('disconnected');
        } else if (status === 'rejected') {
          setConnectionStatus('rejected');
        } else {
          setConnectionStatus('error');
        }
      },
    });

    channelRef.current = channel;
    channel.connect();

    trackEvent('guest.joining', { sessionId, guestName: name });
  }, [sessionId, token, handleMessage]);

  const sendGuestAudio = useCallback((text: string, detectedLanguage: string) => {
    channelRef.current?.send({
      type: 'guest-audio',
      guestId: guestIdRef.current,
      text,
      detectedLanguage,
    });
  }, []);

  useEffect(() => {
    return () => {
      channelRef.current?.close();
    };
  }, []);

  return {
    session,
    utterances,
    speakers,
    connectionStatus,
    join,
    sendGuestAudio,
    guestId: guestIdRef.current,
    sessionEnded,
  };
}
