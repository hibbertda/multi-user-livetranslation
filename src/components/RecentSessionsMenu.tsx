import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { fetchRecentSessions } from '../services/sessionStoreService';
import type { SessionRecord } from '../types';

interface Props {
  onViewAll: () => void;
  onResume?: (record: SessionRecord) => void;
}

export function RecentSessionsMenu({ onViewAll, onResume }: Props) {
  const { getApiToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || loaded) return;
    void getApiToken().then((accessToken) => fetchRecentSessions(accessToken, 5)).then((data) => {
      setRecords(data);
      setLoaded(true);
    }).catch(() => {
      setLoaded(true);
    });
  }, [getApiToken, loaded, open]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function formatDate(ts: number) {
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function formatDuration(ms?: number | null) {
    if (!ms) return '';
    const min = Math.round(ms / 60000);
    return min < 1 ? '<1m' : `${min}m`;
  }

  return (
    <div className="recent-sessions-menu" ref={menuRef}>
      <button
        className="recent-sessions-trigger"
        onClick={() => setOpen(!open)}
        title="Recent sessions"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      </button>

      {open && (
        <div className="recent-sessions-dropdown">
          <div className="recent-sessions-header">
            <span>Recent Sessions</span>
            <button
              className="recent-sessions-refresh"
              onClick={() => { setLoaded(false); }}
              title="Refresh"
            >
              ↻
            </button>
          </div>
          {!loaded ? (
            <div className="recent-sessions-loading">Loading…</div>
          ) : records.length === 0 ? (
            <div className="recent-sessions-empty">No sessions yet</div>
          ) : (
            <ul className="recent-sessions-list">
              {records.map((record) => (
                <li key={record.id} className="recent-session-item">
                  <div className="recent-session-top">
                    <div className="recent-session-title">{record.title ?? record.hostName ?? 'Untitled'}</div>
                    {onResume && (
                      <button
                        className="recent-session-resume"
                        onClick={() => { setOpen(false); onResume(record); }}
                        title="Resume session"
                      >
                        Resume
                      </button>
                    )}
                  </div>
                  <div className="recent-session-meta">
                    <span>{formatDate(record.startedAt)}</span>
                    {record.durationMs != null && <span>{formatDuration(record.durationMs)}</span>}
                    <span className={`recent-session-status recent-session-status--${record.status}`}>
                      {record.status === 'active' ? '● Live' : '● Ended'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button className="recent-sessions-view-all" onClick={() => { setOpen(false); onViewAll(); }}>
            View All Sessions
          </button>
        </div>
      )}
    </div>
  );
}
