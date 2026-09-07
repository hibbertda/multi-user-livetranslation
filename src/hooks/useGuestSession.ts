import { useState, useCallback, useRef, useEffect } from 'react';
import { SignalingChannel, type ConnectionStatus } from '../services/signalingService';
import {
  ApiResponseError,
  exchangeGuestTicket,
  getGuestRequestStatus,
  isWelcomeMessageForGuest,
  pollGuestWelcome,
  requestGuestAccess,
  sendGuestAudio as postGuestAudio,
  sendGuestJoin,
  type WelcomePayload,
} from '../services/guestAdmission';
import type { Session, SessionMessage, Utterance, Speaker } from '../types';
import { trackEvent } from '../utils/telemetry';

export type GuestSessionStatus =
  | 'idle'
  | 'requesting'
  | 'waiting'
  | 'approved'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'ended'
  | 'revoked'
  | 'denied'
  | 'expired'
  | 'host-offline'
  | 'error';

interface UseGuestSessionOptions {
  sessionId: string;
  inviteSecret: string | null;
}

interface UseGuestSessionReturn {
  session: Session | null;
  utterances: Utterance[];
  speakers: Map<string, Speaker>;
  connectionStatus: GuestSessionStatus;
  join: (name: string, language: string) => Promise<void>;
  sendGuestAudio: (text: string, detectedLanguage: string) => Promise<void>;
  guestId: string;
  sessionEnded: boolean;
  errorMessage: string | null;
}

export function useGuestSession({ sessionId, inviteSecret }: UseGuestSessionOptions): UseGuestSessionReturn {
  const [session, setSession] = useState<Session | null>(null);
  const [utterances, setUtterances] = useState<Utterance[]>([]);
  const [speakers, setSpeakers] = useState<Map<string, Speaker>>(new Map());
  const [connectionStatus, setConnectionStatus] = useState<GuestSessionStatus>('idle');
  const [sessionEnded, setSessionEnded] = useState(false);
  const [guestId, setGuestId] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const channelRef = useRef<SignalingChannel | null>(null);
  const requestRef = useRef<{ requestId: string; requestSecret: string } | null>(null);
  const admissionRef = useRef<{ guestId: string; admissionId: string } | null>(null);
  const guestProfileRef = useRef<{ name: string; language: string } | null>(null);
  const statusPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const welcomePollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const welcomePollAttemptsRef = useRef(0);
  const welcomeResolvedRef = useRef(false);
  const pollForWelcomeRef = useRef<() => Promise<void>>(async () => undefined);
  const pollRequestStatusRef = useRef<() => Promise<void>>(async () => undefined);

  const clearTimers = useCallback(() => {
    if (statusPollTimerRef.current) clearTimeout(statusPollTimerRef.current);
    if (welcomePollTimerRef.current) clearTimeout(welcomePollTimerRef.current);
    statusPollTimerRef.current = null;
    welcomePollTimerRef.current = null;
  }, []);

  const applyWelcome = useCallback((welcome: WelcomePayload) => {
    welcomeResolvedRef.current = true;
    clearTimers();
    setSession(welcome.session);
    setUtterances(welcome.utterances);
    setSpeakers(new Map(welcome.speakers));
    setConnectionStatus('connected');
    trackEvent('guest.welcome_received', { utteranceCount: welcome.utterances.length });
  }, [clearTimers]);

  const handleMessage = useCallback((message: SessionMessage) => {
    switch (message.type) {
      case 'welcome':
        if (admissionRef.current && isWelcomeMessageForGuest(message, admissionRef.current.guestId)) {
          applyWelcome(message);
        }
        break;
      case 'utterance':
        setUtterances((previous) => [...previous, message.utterance]);
        break;
      case 'utterance-update':
        setUtterances((previous) => previous.map((utterance) => (
          utterance.id === message.utteranceId
            ? { ...utterance, translatedTexts: message.translatedTexts }
            : utterance
        )));
        break;
      case 'speaker-update':
        setSpeakers((previous) => {
          const next = new Map(previous);
          next.set(message.speaker.id, message.speaker);
          return next;
        });
        break;
      case 'session-end':
        setSessionEnded(true);
        setConnectionStatus('ended');
        channelRef.current?.close();
        clearTimers();
        trackEvent('guest.session_ended');
        break;
      case 'revoked':
        if (!admissionRef.current || message.guestId !== admissionRef.current.guestId) break;
        setConnectionStatus('revoked');
        setErrorMessage(message.message ?? 'Your access to this session has been revoked.');
        channelRef.current?.close();
        clearTimers();
        break;
      case 'error':
        setErrorMessage(message.message);
        trackEvent('guest.error', { message: message.message });
        break;
      default:
        break;
    }
  }, [applyWelcome, clearTimers]);

  const connectWithAdmission = useCallback((url: string, guestIdValue: string, admissionId: string) => {
    welcomeResolvedRef.current = false;
    welcomePollAttemptsRef.current = 0;
    admissionRef.current = { guestId: guestIdValue, admissionId };
    setGuestId(guestIdValue);

    channelRef.current?.close();
    const channel = new SignalingChannel({
      sessionId,
      role: 'guest',
      directUrl: url,
      onMessage: handleMessage,
      onStatus: (status: ConnectionStatus) => {
        if (status === 'connecting') {
          setConnectionStatus('connecting');
          return;
        }
        if (status === 'connected') {
          setConnectionStatus('connected');
          if (guestProfileRef.current) {
            void sendGuestJoin({
              sessionId,
              guestId: guestIdValue,
              admissionId,
              name: guestProfileRef.current.name,
              language: guestProfileRef.current.language,
            }).then(() => pollForWelcomeRef.current()).catch((error: unknown) => {
              const message = error instanceof Error ? error.message : 'Unable to join session.';
              setConnectionStatus('error');
              setErrorMessage(message);
            });
          }
          return;
        }
        if (status === 'disconnected') {
          setConnectionStatus(sessionEnded ? 'ended' : 'disconnected');
          return;
        }
        if (status === 'rejected') {
          setConnectionStatus('expired');
          return;
        }
        setConnectionStatus('error');
      },
    });

    channelRef.current = channel;
    channel.connect();
  }, [handleMessage, sessionEnded, sessionId]);

  const pollForWelcome = useCallback(async () => {
    if (!admissionRef.current || welcomeResolvedRef.current) return;

    try {
      const result = await pollGuestWelcome(
        sessionId,
        admissionRef.current.guestId,
        admissionRef.current.admissionId,
      );
      if (result.status === 'ready') {
        applyWelcome(result.welcome);
        return;
      }
    } catch (error) {
      if (error instanceof ApiResponseError && (error.status === 403 || error.status === 410)) {
        setConnectionStatus('revoked');
        setErrorMessage(error.message);
        return;
      }
    }

    welcomePollAttemptsRef.current += 1;
    if (welcomePollAttemptsRef.current >= 20) {
      setConnectionStatus('host-offline');
      setErrorMessage('Waiting for the host timed out. Please ask them to re-open the session.');
      return;
    }

    welcomePollTimerRef.current = setTimeout(() => {
      void pollForWelcomeRef.current();
    }, 3000);
  }, [applyWelcome, sessionId]);

  const pollRequestStatus = useCallback(async () => {
    if (!requestRef.current) return;

    try {
      const result = await getGuestRequestStatus(requestRef.current.requestId, requestRef.current.requestSecret);
      if (result.status === 'pending') {
        setConnectionStatus('waiting');
        statusPollTimerRef.current = setTimeout(() => {
          void pollRequestStatusRef.current();
        }, 3000);
        return;
      }

      if (result.status === 'denied' || result.status === 'expired') {
        setConnectionStatus(result.status);
        return;
      }

      if (result.status === 'approved' && result.admissionTicket) {
        setConnectionStatus('approved');
        const exchange = await exchangeGuestTicket(result.admissionTicket, sessionId);
        connectWithAdmission(exchange.url, exchange.guestId, exchange.admissionId);
        return;
      }

      setConnectionStatus('approved');
      statusPollTimerRef.current = setTimeout(() => {
        void pollRequestStatusRef.current();
      }, 3000);
    } catch (error) {
      if (error instanceof ApiResponseError && (error.status === 404 || error.status === 410)) {
        setConnectionStatus('host-offline');
        setErrorMessage(error.message);
        return;
      }

      setConnectionStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Unable to check request status.');
    }
  }, [connectWithAdmission, sessionId]);

  useEffect(() => {
    pollForWelcomeRef.current = pollForWelcome;
  }, [pollForWelcome]);

  useEffect(() => {
    pollRequestStatusRef.current = pollRequestStatus;
  }, [pollRequestStatus]);

  const join = useCallback(async (name: string, language: string) => {
    if (!inviteSecret) {
      setConnectionStatus('expired');
      setErrorMessage('This invite link is missing its secret.');
      return;
    }

    clearTimers();
    setErrorMessage(null);
    setSessionEnded(false);
    setConnectionStatus('requesting');
    guestProfileRef.current = { name, language };

    try {
      const request = await requestGuestAccess({
        inviteSecret,
        sessionId,
        name,
        language,
      });
      requestRef.current = request;
      setConnectionStatus('waiting');
      void pollRequestStatusRef.current();
      trackEvent('guest.joining', { sessionId, guestName: name });
    } catch (error) {
      if (error instanceof ApiResponseError && (error.status === 403 || error.status === 410 || error.status === 404)) {
        setConnectionStatus('host-offline');
        setErrorMessage(error.message);
        return;
      }

      setConnectionStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Unable to request session access.');
    }
  }, [clearTimers, inviteSecret, sessionId]);

  const sendGuestAudio = useCallback(async (text: string, detectedLanguage: string) => {
    if (!admissionRef.current) return;

    try {
      await postGuestAudio({
        sessionId,
        guestId: admissionRef.current.guestId,
        admissionId: admissionRef.current.admissionId,
        text,
        detectedLanguage,
      });
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 403) {
        setConnectionStatus('revoked');
        setErrorMessage(error.message);
      }
    }
  }, [sessionId]);

  useEffect(() => {
    return () => {
      clearTimers();
      channelRef.current?.close();
    };
  }, [clearTimers]);

  return {
    session,
    utterances,
    speakers,
    connectionStatus,
    join,
    sendGuestAudio,
    guestId,
    sessionEnded,
    errorMessage,
  };
}
