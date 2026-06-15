import { useState, useEffect, useCallback } from 'react';
import { fetchSessionHistory, fetchSession, deleteSessionRecord } from '../services/sessionStoreService';
import { getLanguageLabel } from '../languages';
import type { SessionRecord, SessionUtterance } from '../types';

export function SessionHistory({ onResume }: { onResume?: (record: SessionRecord) => void }) {
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Transcript viewer state
  const [viewingSession, setViewingSession] = useState<SessionRecord | null>(null);
  const [transcript, setTranscript] = useState<SessionUtterance[]>([]);
  const [loadingTranscript, setLoadingTranscript] = useState(false);

  // Detail popup state
  const [detailRecord, setDetailRecord] = useState<SessionRecord | null>(null);

  // Delete confirmation state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    void fetchSessionHistory({ limit: 50 }).then((data) => {
      setRecords(data);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, [refreshKey]);

  const handleViewTranscript = useCallback(async (record: SessionRecord) => {
    setLoadingTranscript(true);
    setViewingSession(record);
    const full = await fetchSession(record.id);
    setTranscript(full?.utterances ?? []);
    setLoadingTranscript(false);
  }, []);

  const handleCloseTranscript = useCallback(() => {
    setViewingSession(null);
    setTranscript([]);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingId) return;
    setDeleteLoading(true);
    const ok = await deleteSessionRecord(deletingId);
    setDeleteLoading(false);
    if (ok) {
      setRecords((prev) => prev.filter((r) => r.id !== deletingId));
      // If transcript is open for this session, close it
      if (viewingSession?.id === deletingId) handleCloseTranscript();
    }
    setDeletingId(null);
  }, [deletingId, viewingSession, handleCloseTranscript]);

  function formatDate(ts: number) {
    return new Date(ts).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  function formatTime(ts: number) {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatTimestamp(ts: number) {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function formatDuration(ms?: number) {
    if (!ms) return '—';
    const totalSec = Math.round(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min === 0) return `${sec}s`;
    return `${min}m ${sec}s`;
  }

  // Transcript viewer modal
  if (viewingSession) {
    return (
      <div className="session-history">
        <div className="session-history-header">
          <button className="session-transcript-back" onClick={handleCloseTranscript}>
            ← Back to History
          </button>
          <h2>{viewingSession.title ?? 'Session Transcript'}</h2>
        </div>
        <div className="session-transcript-meta">
          <span>{viewingSession.startedAt ? formatDate(viewingSession.startedAt) : ''}</span>
          <span>{viewingSession.hostName}</span>
          {viewingSession.languageA && viewingSession.languageB && (
            <span>{getLanguageLabel(viewingSession.languageA)} ↔ {getLanguageLabel(viewingSession.languageB)}</span>
          )}
          <span>{formatDuration(viewingSession.durationMs)}</span>
        </div>

        {loadingTranscript ? (
          <div className="session-history-empty">Loading transcript…</div>
        ) : transcript.length === 0 ? (
          <div className="session-history-empty">
            No transcript saved for this session.
            <br />
            <span style={{ fontSize: '13px', color: '#aaa' }}>Transcripts are saved when a session is ended. Sessions created before this feature was added will not have transcripts.</span>
          </div>
        ) : (
          <div className="session-transcript-list">
            {transcript.map((u) => (
              <div key={u.id} className="session-transcript-utterance">
                <div className="session-transcript-header">
                  <span className="session-transcript-speaker">{u.speakerLabel}</span>
                  <span className="session-transcript-time">{formatTimestamp(u.timestamp)}</span>
                  <span className="session-transcript-lang">{getLanguageLabel(u.detectedLanguage)}</span>
                </div>
                <div className="session-transcript-original">{u.originalText}</div>
                {Object.keys(u.translatedTexts).length > 0 && (
                  <div className="session-transcript-translations">
                    {Object.entries(u.translatedTexts).map(([lang, text]) => (
                      <div key={lang} className="session-transcript-translation">
                        <span className="session-transcript-translation-lang">{getLanguageLabel(lang)}</span>
                        <span>{text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="session-history">
      <div className="session-history-header">
        <h2>Session History</h2>
        <button className="session-history-refresh" onClick={() => { setLoading(true); setRefreshKey(k => k + 1); }} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {loading && records.length === 0 ? (
        <div className="session-history-empty">Loading sessions…</div>
      ) : records.length === 0 ? (
        <div className="session-history-empty">No sessions yet. Start a session to see it here.</div>
      ) : (
        <div className="session-card-list">
          {records.map((r) => (
            <div key={r.id} className={`session-card${r.status === 'active' ? ' session-card--active' : ''}`} onClick={() => setDetailRecord(r)} role="button" tabIndex={0}>
              <div className="session-card-top">
                <div className="session-card-title">{r.title ?? 'Untitled Session'}</div>
                <div className="session-card-top-right" onClick={(e) => e.stopPropagation()}>
                  <span className={`session-status-chip session-status-chip--${r.status}`}>
                    {r.status === 'active' ? 'Active' : 'Ended'}
                  </span>
                  {r.utteranceCount > 0 && (
                    <button
                      className="session-transcript-btn"
                      onClick={() => void handleViewTranscript(r)}
                    >
                      Transcript
                    </button>
                  )}
                  {onResume && (
                    <button
                      className="session-resume-btn"
                      onClick={() => onResume(r)}
                    >
                      Resume
                    </button>
                  )}
                  <button
                    className="session-delete-btn"
                    onClick={() => setDeletingId(r.id)}
                    title="Delete session"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="session-card-meta">
                <div className="session-meta-box">
                  <div className="session-meta-label">Date</div>
                  <div className="session-meta-value">{r.startedAt ? `${formatDate(r.startedAt)}, ${formatTime(r.startedAt)}` : '—'}</div>
                </div>
                <div className="session-meta-box">
                  <div className="session-meta-label">Host</div>
                  <div className="session-meta-value">{r.hostName ?? '—'}</div>
                </div>
                <div className="session-meta-box">
                  <div className="session-meta-label">Languages</div>
                  <div className="session-meta-value">{r.languageA && r.languageB ? `${getLanguageLabel(r.languageA)} ↔ ${getLanguageLabel(r.languageB)}` : '—'}</div>
                </div>
                <div className="session-meta-box">
                  <div className="session-meta-label">Duration</div>
                  <div className="session-meta-value">{formatDuration(r.durationMs)}</div>
                </div>
                <div className="session-meta-box">
                  <div className="session-meta-label">Guests</div>
                  <div className="session-meta-value">{Array.isArray(r.guests) && r.guests.length > 0 ? r.guests.map((g) => typeof g === 'string' ? g : g.name).join(', ') : '—'}</div>
                </div>
                <div className="session-meta-box">
                  <div className="session-meta-label">Utterances</div>
                  <div className="session-meta-value">{r.utteranceCount ?? 0}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Session detail popup */}
      {detailRecord && (
        <div className="session-delete-overlay" onClick={() => setDetailRecord(null)}>
          <div className="session-detail-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="session-detail-header">
              <h3>{detailRecord.title ?? 'Untitled Session'}</h3>
              <button className="session-delete-btn" onClick={() => setDetailRecord(null)}>✕</button>
            </div>
            <div className="session-detail-grid">
              <div className="session-detail-item">
                <div className="session-detail-label">Date</div>
                <div className="session-detail-value">{detailRecord.startedAt ? `${formatDate(detailRecord.startedAt)}, ${formatTime(detailRecord.startedAt)}` : '—'}</div>
              </div>
              {detailRecord.endedAt && (
                <div className="session-detail-item">
                  <div className="session-detail-label">Ended</div>
                  <div className="session-detail-value">{`${formatDate(detailRecord.endedAt)}, ${formatTime(detailRecord.endedAt)}`}</div>
                </div>
              )}
              <div className="session-detail-item">
                <div className="session-detail-label">Duration</div>
                <div className="session-detail-value">{formatDuration(detailRecord.durationMs)}</div>
              </div>
              <div className="session-detail-item">
                <div className="session-detail-label">Status</div>
                <div className="session-detail-value">
                  <span className={`session-status-chip session-status-chip--${detailRecord.status}`}>
                    {detailRecord.status === 'active' ? 'Active' : 'Ended'}
                  </span>
                </div>
              </div>
              <div className="session-detail-item">
                <div className="session-detail-label">Host</div>
                <div className="session-detail-value">{detailRecord.hostName ?? '—'}{detailRecord.hostEmail ? ` (${detailRecord.hostEmail})` : ''}</div>
              </div>
              <div className="session-detail-item">
                <div className="session-detail-label">Languages</div>
                <div className="session-detail-value">{detailRecord.languageA && detailRecord.languageB ? `${getLanguageLabel(detailRecord.languageA)} ↔ ${getLanguageLabel(detailRecord.languageB)}` : '—'}</div>
              </div>
              <div className="session-detail-item">
                <div className="session-detail-label">Utterances</div>
                <div className="session-detail-value">{detailRecord.utteranceCount ?? 0}</div>
              </div>
              {detailRecord.audioUrl && (
                <div className="session-detail-item">
                  <div className="session-detail-label">Audio</div>
                  <div className="session-detail-value"><a href={detailRecord.audioUrl} target="_blank" rel="noopener noreferrer" className="session-audio-link">▶ Play Recording</a></div>
                </div>
              )}
            </div>
            {Array.isArray(detailRecord.guests) && detailRecord.guests.length > 0 && (
              <div className="session-detail-guests">
                <div className="session-detail-label">Guests</div>
                <div className="session-detail-guest-list">
                  {detailRecord.guests.map((g) => {
                    if (typeof g === 'string') return <div key={g} className="session-detail-guest">{g}</div>;
                    return (
                      <div key={g.id} className="session-detail-guest">
                        <span className="session-detail-guest-name">{g.name}</span>
                        <span className="session-detail-guest-lang">{getLanguageLabel(g.language)}</span>
                        {g.joinedAt && <span className="session-detail-guest-time">joined {formatTime(g.joinedAt)}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="session-detail-id">Session ID: {detailRecord.id}</div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deletingId && (
        <div className="session-delete-overlay" onClick={() => setDeletingId(null)}>
          <div className="session-delete-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Session</h3>
            <p>Are you sure you want to permanently delete this session? This cannot be undone.</p>
            <div className="session-delete-actions">
              <button
                className="session-delete-cancel"
                onClick={() => setDeletingId(null)}
                disabled={deleteLoading}
              >
                Cancel
              </button>
              <button
                className="session-delete-confirm"
                onClick={() => void handleDeleteConfirm()}
                disabled={deleteLoading}
              >
                {deleteLoading ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
