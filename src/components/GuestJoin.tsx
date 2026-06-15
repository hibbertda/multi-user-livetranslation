import { useState } from 'react';
import { LANGUAGE_POOL } from '../languages';

interface Props {
  sessionId: string;
  token: string;
  onJoin: (name: string, email: string | undefined, language: string) => void;
  defaultLanguage?: string;
}

export function GuestJoin({ sessionId: _sessionId, token: _token, onJoin, defaultLanguage }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [language, setLanguage] = useState(defaultLanguage ?? 'en-US');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onJoin(name.trim(), email.trim() || undefined, language);
  };

  return (
    <div className="guest-join-screen">
      <div className="guest-join-card">
        <h1>Join Translation Session</h1>
        <p>You&apos;ve been invited to a live translation session. Enter your details to join.</p>

        <form onSubmit={handleSubmit} className="guest-join-form">
          <label className="guest-field">
            <span className="guest-field-label">Your Name *</span>
            <input
              type="text"
              className="guest-field-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              required
              autoFocus
              maxLength={100}
            />
          </label>

          <label className="guest-field">
            <span className="guest-field-label">Email (optional)</span>
            <input
              type="email"
              className="guest-field-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              maxLength={254}
            />
          </label>

          <label className="guest-field">
            <span className="guest-field-label">Display Language</span>
            <select
              className="guest-field-input"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              {LANGUAGE_POOL.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </label>

          <button type="submit" className="guest-join-btn" disabled={!name.trim()}>
            Join Session
          </button>
        </form>
      </div>
    </div>
  );
}
