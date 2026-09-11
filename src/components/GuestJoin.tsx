import { useState } from 'react';
import { LANGUAGE_POOL } from '../languages';

interface Props {
  onJoin: (name: string, language: string) => Promise<void>;
  defaultLanguage?: string;
}

export function GuestJoin({ onJoin, defaultLanguage }: Props) {
  const [name, setName] = useState('');
  const [language, setLanguage] = useState(defaultLanguage ?? 'en-US');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    try {
      await onJoin(name.trim(), language);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="guest-join-screen">
      <div className="guest-join-card">
        <h1>Join Translation Session</h1>
        <p>You&apos;ve been invited to a live translation session. Enter your details to request admission.</p>

        <form onSubmit={(event) => { void handleSubmit(event); }} className="guest-join-form">
          <label className="guest-field">
            <span className="guest-field-label">Your Name *</span>
            <input
              type="text"
              className="guest-field-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Enter your name"
              required
              autoFocus
              maxLength={100}
            />
          </label>

          <label className="guest-field">
            <span className="guest-field-label">Display Language</span>
            <select
              className="guest-field-input"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              {LANGUAGE_POOL.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </label>

          <p className="settings-hint">Your name and language are self-asserted and not verified.</p>

          <button type="submit" className="guest-join-btn" disabled={!name.trim() || submitting}>
            {submitting ? 'Requesting…' : 'Request Access'}
          </button>
        </form>
      </div>
    </div>
  );
}
