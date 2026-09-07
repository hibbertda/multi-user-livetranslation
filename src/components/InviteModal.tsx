import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  buildInviteUrl,
  computeSha256Hex,
  createInvite,
  generateInviteSecret,
  revokeInvite,
} from '../services/guestAdmission';

interface Props {
  sessionId: string;
  getApiToken: () => Promise<string>;
  onClose: () => void;
}

const DEFAULT_MAX_USES = 5;
const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000;

export function InviteModal({ sessionId, getApiToken, onClose }: Props) {
  const [inviteUrl, setInviteUrl] = useState('');
  const [inviteHash, setInviteHash] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const issueInvite = async (revokeCurrent = false) => {
    setLoading(true);
    setError(null);

    try {
      const accessToken = await getApiToken();
      if (revokeCurrent && inviteHash) {
        await revokeInvite(sessionId, accessToken, inviteHash);
      }

      const secret = generateInviteSecret();
      const hash = await computeSha256Hex(secret);
      await createInvite(sessionId, accessToken, {
        hash,
        expiresAt: Date.now() + DEFAULT_EXPIRY_MS,
        maxUses: DEFAULT_MAX_USES,
      });

      const baseUrl = import.meta.env.VITE_INVITE_BASE_URL || window.location.origin;
      setInviteHash(hash);
      setInviteUrl(buildInviteUrl(baseUrl, sessionId, secret));
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : 'Unable to create invite.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      void issueInvite();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const handleCopy = () => {
    if (inviteUrl) {
      void navigator.clipboard.writeText(inviteUrl);
    }
  };

  const handleRevoke = () => {
    void (async () => {
      if (!inviteHash) return;
      try {
        const accessToken = await getApiToken();
        await revokeInvite(sessionId, accessToken, inviteHash);
        setInviteHash('');
        setInviteUrl('');
      } catch (inviteError) {
        setError(inviteError instanceof Error ? inviteError.message : 'Unable to revoke invite.');
      }
    })();
  };

  return (
    <div className="invite-overlay" onClick={onClose}>
      <div className="invite-modal" onClick={(event) => event.stopPropagation()}>
        <div className="invite-modal-header">
          <h2>Invite to Session</h2>
          <button className="invite-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="invite-modal-body">
          <p className="invite-instructions">
            Scan this QR code with a phone camera to request access to the live translation session.
          </p>

          {error && <div className="app-alert" role="alert"><span>{error}</span></div>}

          {loading ? (
            <p>Creating invite…</p>
          ) : inviteUrl ? (
            <>
              <div className="invite-qr-container">
                <QRCodeSVG
                  value={inviteUrl}
                  size={220}
                  level="M"
                  includeMargin
                  bgColor="#ffffff"
                  fgColor="#1a1a2e"
                />
              </div>

              <div className="invite-link-row">
                <input
                  className="invite-link-input"
                  value={inviteUrl}
                  readOnly
                  onClick={(event) => (event.target as HTMLInputElement).select()}
                />
                <button className="invite-copy-btn" onClick={handleCopy}>
                  Copy
                </button>
              </div>
            </>
          ) : (
            <p>This invite has been revoked.</p>
          )}

          <div className="save-controls">
            <button className="session-invite-btn" onClick={() => { void issueInvite(true); }} disabled={loading}>
              Rotate Link
            </button>
            <button className="session-delete-btn" onClick={handleRevoke} disabled={loading || !inviteHash}>
              Revoke Current Link
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
