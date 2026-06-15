import { QRCodeSVG } from 'qrcode.react';

interface Props {
  inviteUrl: string;
  onClose: () => void;
}

export function InviteModal({ inviteUrl, onClose }: Props) {
  const handleCopy = () => {
    void navigator.clipboard.writeText(inviteUrl);
  };

  return (
    <div className="invite-overlay" onClick={onClose}>
      <div className="invite-modal" onClick={(e) => e.stopPropagation()}>
        <div className="invite-modal-header">
          <h2>Invite to Session</h2>
          <button className="invite-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="invite-modal-body">
          <p className="invite-instructions">
            Scan this QR code with a phone camera to join the live translation session.
          </p>

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
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button className="invite-copy-btn" onClick={handleCopy}>
              Copy
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
