import { useState } from 'react';
import { useGuestSession } from '../hooks/useGuestSession';
import { scrubInviteFromLocation } from '../services/guestAdmission';
import { GuestJoin } from './GuestJoin';
import { GuestView } from './GuestView';

interface Props {
  sessionId: string;
}

function WaitingState({ title, description }: { title: string; description: string }) {
  return (
    <div className="guest-join-screen">
      <div className="guest-join-card">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  );
}

export function GuestApp({ sessionId }: Props) {
  const [inviteSecret] = useState(() => scrubInviteFromLocation());
  const [guestName, setGuestName] = useState('');
  const [guestLanguage, setGuestLanguage] = useState<string>('en-US');

  const {
    session,
    utterances,
    speakers,
    connectionStatus,
    join,
    sendGuestAudio,
    sessionEnded,
    errorMessage,
  } = useGuestSession({ sessionId, inviteSecret });

  if (!inviteSecret) {
    return <WaitingState title="Invite Unavailable" description="This invite link is missing its secret. Ask the host for a fresh invite." />;
  }

  if (!session && connectionStatus === 'idle') {
    return (
      <GuestJoin
        defaultLanguage={guestLanguage}
        onJoin={async (name, language) => {
          setGuestName(name);
          setGuestLanguage(language);
          await join(name, language);
        }}
      />
    );
  }

  if (!session) {
    const messages: Record<string, { title: string; description: string }> = {
      requesting: {
        title: 'Requesting Access',
        description: 'Submitting your guest request…',
      },
      waiting: {
        title: 'Waiting for Host Approval',
        description: 'Your request has been sent. Keep this page open while the host reviews it.',
      },
      approved: {
        title: 'Approved',
        description: 'Connecting you to the session…',
      },
      connecting: {
        title: 'Connecting',
        description: 'Joining the session and waiting for the host welcome message…',
      },
      denied: {
        title: 'Request Denied',
        description: 'The host denied your request. Ask them for a new invite if needed.',
      },
      expired: {
        title: 'Invite Expired',
        description: 'This request or invite has expired. Ask the host for a fresh invite.',
      },
      'host-offline': {
        title: 'Host Unavailable',
        description: errorMessage ?? 'The host appears to be offline or the session is unavailable.',
      },
      revoked: {
        title: 'Access Revoked',
        description: errorMessage ?? 'The host revoked your access to this session.',
      },
      error: {
        title: 'Unable to Join',
        description: errorMessage ?? 'Something went wrong while joining the session.',
      },
      disconnected: {
        title: 'Connection Lost',
        description: 'Trying to reconnect to the session…',
      },
      connected: {
        title: 'Connected',
        description: 'Waiting for the host welcome message…',
      },
      ended: {
        title: 'Session Ended',
        description: 'The host ended the session before you finished joining.',
      },
      idle: {
        title: 'Ready',
        description: 'Enter your details to continue.',
      },
    };

    const copy = messages[connectionStatus] ?? messages.error;
    return <WaitingState title={copy.title} description={copy.description} />;
  }

  return (
    <GuestView
      utterances={utterances}
      speakers={speakers}
      displayLanguage={guestLanguage}
      sessionEnded={sessionEnded}
      connectionStatus={connectionStatus}
      hostName={session.hostName}
      guestName={guestName}
      onSendAudio={sendGuestAudio}
      onLanguageChange={setGuestLanguage}
    />
  );
}
