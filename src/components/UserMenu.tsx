import { useState, useRef, useEffect } from 'react';
import type { AccountInfo } from '@azure/msal-browser';

interface Props {
  account: AccountInfo;
  onLogout: () => void;
  getGraphToken: () => Promise<string>;
}

export function UserMenu({ account, onLogout, getGraphToken }: Props) {
  const [open, setOpen] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const name = account.name || account.username || 'User';
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  useEffect(() => {
    let revoke: string | null = null;
    getGraphToken()
      .then((token) =>
        fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
          headers: { Authorization: `Bearer ${token}` },
        })
      )
      .then((res) => {
        if (!res.ok) throw new Error('No photo');
        return res.blob();
      })
      .then((blob) => {
        revoke = URL.createObjectURL(blob);
        setPhotoUrl(revoke);
      })
      .catch(() => setPhotoUrl(null));
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [getGraphToken]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const avatar = photoUrl ? (
    <img src={photoUrl} alt={name} className="user-avatar user-avatar--img" />
  ) : (
    <span className="user-avatar">{initials}</span>
  );

  const avatarLg = photoUrl ? (
    <img src={photoUrl} alt={name} className="user-avatar user-avatar--lg user-avatar--img" />
  ) : (
    <span className="user-avatar user-avatar--lg">{initials}</span>
  );

  return (
    <div className="user-menu" ref={menuRef}>
      <button className="user-menu-trigger" onClick={() => setOpen(!open)}>
        {avatar}
        <span className="user-name">{name}</span>
      </button>
      {open && (
        <div className="user-menu-dropdown">
          <div className="user-menu-info">
            {avatarLg}
            <div>
              <div className="user-menu-fullname">{name}</div>
              <div className="user-menu-email">{account.username}</div>
            </div>
          </div>
          <hr className="user-menu-divider" />
          <button className="user-menu-item" onClick={onLogout}>
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
