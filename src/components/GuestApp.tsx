import { useState, useCallback, useEffect } from 'react';
import { useGuestSession } from '../hooks/useGuestSession';
import { fetchSession } from '../services/sessionStoreService';
import { GuestJoin } from './GuestJoin';
import { GuestView } from './GuestView';

interface Props {
  sessionId: string;
  token: string;
}

export function GuestApp({ sessionId, token }: Props) {
  const [joined, setJoined] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestLanguage, setGuestLanguage] = useState<string | null>(null);
  const [sessionLanguageB, setSessionLanguageB] = useState<string | null>(null);

  const {
    session,
    utterances,
    speakers,
    connectionStatus,
    join,
    sendGuestAudio,
    sessionEnded,
  } = useGuestSession({ sessionId, token });

  // Fetch session metadata on mount so we know languageB before the guest joins
  useEffect(() => {
    void fetchSession(sessionId).then((record) => {
      if (record?.languageB) {
        setSessionLanguageB(record.languageB);
      }
    });
  }, [sessionId]);

  const handleJoin = useCallback(
    (name: string, email: string | undefined, language: string) => {
      setGuestName(name);
      setGuestLanguage(language);
      join(name, email, language);
      setJoined(true);
    },
    [join],
  );

  const handleLanguageChange = useCallback((language: string) => {
    setGuestLanguage(language);
  }, []);

  // Default guest language: pre-fetched from API, or from welcome message, or fallback
  const effectiveLanguage = guestLanguage ?? session?.languageB ?? sessionLanguageB ?? 'en-US';
  const defaultJoinLanguage = sessionLanguageB ?? session?.languageB;

  if (connectionStatus === 'rejected') {
    return (
      <div className="guest-join-screen">
        <div className="guest-join-card">
          <h1>Session Unavailable</h1>
          <p>This session link is no longer valid. The session may have ended or the link has expired.</p>
          <p>Please ask the host for a new invite link.</p>
        </div>
      </div>
    );
  }

  if (!joined) {
    return <GuestJoin sessionId={sessionId} token={token} onJoin={handleJoin} defaultLanguage={defaultJoinLanguage} />;
  }

  return (
    <GuestView
      utterances={utterances}
      speakers={speakers}
      displayLanguage={effectiveLanguage}
      sessionEnded={sessionEnded}
      connectionStatus={connectionStatus}
      hostName={session?.hostName ?? 'Host'}
      guestName={guestName}
      onSendAudio={sendGuestAudio}
      onLanguageChange={handleLanguageChange}
    />
  );
}
