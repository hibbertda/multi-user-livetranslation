/**
 * Multi-device session tests.
 *
 * Renders the real host hook and two real guest hooks against a shared fake
 * signalling hub and a fake admission backend, so a two-party (host + two guest
 * devices) session can be driven end to end: admission, roster, cross-device
 * utterance fan-out, revocation and session end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useHostSession } from '../hooks/useHostSession';
import { useGuestSession } from '../hooks/useGuestSession';
import { FakeSignalingHub } from './fakeSignaling';
import type { Session, SessionMessage, Speaker, Utterance } from '../types';
import type { WelcomePayload } from '../services/guestAdmission';

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const INVITE_SECRET = 'invite-secret';
const POLL_INTERVAL_MS = 3000;

const hub = new FakeSignalingHub();

/** Minimal in-memory stand-in for the guest admission API. */
class FakeAdmissionBackend {
  requests = new Map<string, {
    sessionId: string;
    name: string;
    language: string;
    secret: string;
    status: 'pending' | 'approved' | 'denied' | 'expired';
    ticket?: string;
    guestId: string;
    admissionId: string;
  }>();

  welcomes = new Map<string, WelcomePayload>();
  joins: { guestId: string; name: string; language: string }[] = [];
  audio: { guestId: string; text: string; detectedLanguage: string }[] = [];

  createRequest(sessionId: string, name: string, language: string) {
    const requestId = `request-${name.toLowerCase()}`;
    const guestId = `guest-${name.toLowerCase()}`;
    this.requests.set(requestId, {
      sessionId,
      name,
      language,
      secret: `secret-${name.toLowerCase()}`,
      status: 'pending',
      guestId,
      admissionId: `admission-${name.toLowerCase()}`,
    });
    return { requestId, requestSecret: `secret-${name.toLowerCase()}` };
  }

  approve(requestId: string) {
    const request = this.requests.get(requestId)!;
    request.status = 'approved';
    request.ticket = `ticket-${requestId}`;
  }

  deny(requestId: string) {
    this.requests.get(requestId)!.status = 'denied';
  }

  reset() {
    this.requests.clear();
    this.welcomes.clear();
    this.joins = [];
    this.audio = [];
  }
}

const backend = new FakeAdmissionBackend();

vi.mock('../services/guestAdmission', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/guestAdmission')>();
  return {
    ...actual,
    requestGuestAccess: vi.fn(async (payload: { sessionId: string; name: string; language: string }) =>
      backend.createRequest(payload.sessionId, payload.name, payload.language)),

    getGuestRequestStatus: vi.fn(async (requestId: string, requestSecret: string) => {
      const request = backend.requests.get(requestId);
      if (!request) throw new actual.ApiResponseError(404, 'Request not found');
      if (request.secret !== requestSecret) throw new actual.ApiResponseError(403, 'Invalid request secret');
      return { status: request.status, admissionTicket: request.ticket };
    }),

    exchangeGuestTicket: vi.fn(async (ticket: string, sessionId: string) => {
      const request = [...backend.requests.values()].find((entry) => entry.ticket === ticket);
      if (!request || request.sessionId !== sessionId) throw new actual.ApiResponseError(403, 'Invalid ticket');
      return { url: `wss://fake/${request.guestId}`, guestId: request.guestId, admissionId: request.admissionId };
    }),

    sendGuestJoin: vi.fn(async (payload: { sessionId: string; guestId: string; name: string; language: string }) => {
      backend.joins.push({ guestId: payload.guestId, name: payload.name, language: payload.language });
      // The backend publishes the join to the host's channel.
      hub.publish(payload.sessionId, {
        type: 'join',
        guest: {
          id: payload.guestId,
          name: payload.name,
          language: payload.language,
          joinedAt: 1,
        },
      }, { to: 'host' });
    }),

    sendGuestAudio: vi.fn(async (payload: { sessionId: string; guestId: string; text: string; detectedLanguage: string }) => {
      backend.audio.push({ guestId: payload.guestId, text: payload.text, detectedLanguage: payload.detectedLanguage });
      hub.publish(payload.sessionId, {
        type: 'guest-audio',
        guestId: payload.guestId,
        text: payload.text,
        detectedLanguage: payload.detectedLanguage,
      }, { to: 'host' });
    }),

    pollGuestWelcome: vi.fn(async (_sessionId: string, guestId: string) => {
      const welcome = backend.welcomes.get(guestId);
      return welcome ? { status: 'ready' as const, welcome } : { status: 'pending' as const };
    }),

    sendWelcome: vi.fn(async (sessionId: string, guestId: string, _admissionId: string, welcome: WelcomePayload) => {
      backend.welcomes.set(guestId, welcome);
      hub.publish(sessionId, { type: 'welcome', targetGuestId: guestId, ...welcome }, { to: guestId });
    }),
  };
});

const SESSION: Session = {
  id: SESSION_ID,
  ownerId: 'owner-1',
  hostName: 'Host',
  createdAt: 1,
  languageA: 'en-US',
  languageB: 'es-ES',
  title: 'Standup',
};

function utterance(overrides: Partial<Utterance> = {}): Utterance {
  return {
    id: 'u1',
    speakerId: 'speaker-host',
    speakerLabel: 'Host',
    originalText: 'good morning',
    translatedTexts: { es: 'buenos días' },
    detectedLanguage: 'en-US',
    timestamp: 10,
    ...overrides,
  };
}

function renderHost() {
  return renderHook(() => useHostSession({
    getApiToken: async () => 'host-token',
    createChannel: hub.factory('host'),
  }));
}

function renderGuest(name: 'alice' | 'bob') {
  return renderHook(() => useGuestSession({
    sessionId: SESSION_ID,
    inviteSecret: INVITE_SECRET,
    createChannel: hub.factory(`guest-${name}`),
  }));
}

/**
 * Retries an assertion while draining timers.
 * Testing Library's own `waitFor` does not cooperate with Vitest fake timers here,
 * so state settling is driven explicitly.
 */
async function expectEventually(assertion: () => void, attempts = 50): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
    }
  }
  assertion();
}

/** Runs pending poll timers and lets the resulting promise chains settle. */
async function advancePolling(times = 1) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
  }
}

type GuestHook = ReturnType<typeof renderGuest>;

/** Drives a guest from invite link to fully admitted, approving on the host side. */
async function admitGuest(guest: GuestHook, name: 'alice' | 'bob', language = 'es-ES') {
  await act(async () => {
    await guest.result.current.join(name === 'alice' ? 'Alice' : 'Bob', language);
  });

  backend.approve(`request-${name}`);
  await advancePolling();
  await expectEventually(() => expect(guest.result.current.connectionStatus).toBe('connected'));
}

describe('two-party session across multiple devices', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hub.reset();
    backend.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('admission', () => {
    it('moves a guest through waiting → approved → connected and adds it to the host roster', async () => {
      const host = renderHost();
      act(() => host.result.current.createSession(SESSION));
      await expectEventually(() => expect(host.result.current.connectionStatus).toBe('connected'));

      const guest = renderGuest('alice');
      await act(async () => {
        await guest.result.current.join('Alice', 'es-ES');
      });

      // Still pending on the host side.
      expect(guest.result.current.connectionStatus).toBe('waiting');
      expect(host.result.current.guests).toEqual([]);

      await advancePolling();
      expect(guest.result.current.connectionStatus).toBe('waiting');

      backend.approve('request-alice');
      await advancePolling();

      await expectEventually(() => expect(guest.result.current.connectionStatus).toBe('connected'));
      expect(guest.result.current.guestId).toBe('guest-alice');
      await expectEventually(() => expect(host.result.current.guests).toEqual([
        { id: 'guest-alice', name: 'Alice', language: 'es-ES', joinedAt: 1 },
      ]));
    });

    it('delivers the host welcome snapshot to a guest joining mid-session', async () => {
      const host = renderHost();
      act(() => host.result.current.createSession(SESSION));
      const speaker: Speaker = { id: 'speaker-host', label: 'Host', language: 'en-US', color: '#000' };
      act(() => {
        host.result.current.broadcastSpeakerUpdate(speaker);
        host.result.current.broadcastUtterance(utterance());
      });

      const guest = renderGuest('alice');
      await admitGuest(guest, 'alice');

      expect(guest.result.current.session).toEqual(SESSION);
      expect(guest.result.current.utterances).toEqual([utterance()]);
      expect(guest.result.current.speakers.get('speaker-host')).toEqual(speaker);
    });

    it('leaves a denied guest out of the session', async () => {
      const host = renderHost();
      act(() => host.result.current.createSession(SESSION));

      const guest = renderGuest('alice');
      await act(async () => {
        await guest.result.current.join('Alice', 'es-ES');
      });

      backend.deny('request-alice');
      await advancePolling();

      expect(guest.result.current.connectionStatus).toBe('denied');
      expect(host.result.current.guests).toEqual([]);
      expect(hub.channelsFor(SESSION_ID).map((channel) => channel.label)).toEqual(['host']);
    });

    it('refuses to join without an invite secret', async () => {
      const guest = renderHook(() => useGuestSession({
        sessionId: SESSION_ID,
        inviteSecret: null,
        createChannel: hub.factory('guest-alice'),
      }));

      await act(async () => {
        await guest.result.current.join('Alice', 'es-ES');
      });

      expect(guest.result.current.connectionStatus).toBe('expired');
      expect(guest.result.current.errorMessage).toMatch(/missing its secret/i);
    });
  });

  describe('cross-device messaging', () => {
    it('fans host utterances out to both guest devices', async () => {
      const host = renderHost();
      act(() => host.result.current.createSession(SESSION));

      const alice = renderGuest('alice');
      await admitGuest(alice, 'alice', 'es-ES');
      const bob = renderGuest('bob');
      await admitGuest(bob, 'bob', 'fr-FR');

      act(() => host.result.current.broadcastUtterance(utterance({ id: 'u2', originalText: 'hello all' })));

      await expectEventually(() => expect(alice.result.current.utterances).toHaveLength(1));
      expect(alice.result.current.utterances[0]).toMatchObject({ id: 'u2', originalText: 'hello all' });
      expect(bob.result.current.utterances[0]).toMatchObject({ id: 'u2', speakerLabel: 'Host' });
    });

    it('applies late-arriving translations to the utterance on every device', async () => {
      const host = renderHost();
      act(() => host.result.current.createSession(SESSION));

      const alice = renderGuest('alice');
      await admitGuest(alice, 'alice', 'es-ES');
      const bob = renderGuest('bob');
      await admitGuest(bob, 'bob', 'fr-FR');

      act(() => host.result.current.broadcastUtterance(utterance({ translatedTexts: {} })));
      act(() => host.result.current.broadcastUtteranceUpdate('u1', { es: 'buenos días', fr: 'bonjour' }));

      await expectEventually(() => expect(alice.result.current.utterances[0].translatedTexts).toEqual({
        es: 'buenos días',
        fr: 'bonjour',
      }));
      expect(bob.result.current.utterances[0].translatedTexts).toEqual({ es: 'buenos días', fr: 'bonjour' });
    });

    it('propagates speaker identity updates to guests', async () => {
      const host = renderHost();
      act(() => host.result.current.createSession(SESSION));
      const alice = renderGuest('alice');
      await admitGuest(alice, 'alice');

      const speaker: Speaker = { id: 'speaker-2', label: 'Renamed', language: 'en-US', color: '#abc' };
      act(() => host.result.current.broadcastSpeakerUpdate(speaker));

      await expectEventually(() => expect(alice.result.current.speakers.get('speaker-2')).toEqual(speaker));
    });

    it('routes guest speech to the host with the speaking guest and language', async () => {
      const host = renderHost();
      act(() => host.result.current.createSession(SESSION));
      const alice = renderGuest('alice');
      await admitGuest(alice, 'alice', 'es-ES');
      const bob = renderGuest('bob');
      await admitGuest(bob, 'bob', 'fr-FR');

      await act(async () => {
        await alice.result.current.sendGuestAudio('hola a todos', 'es-ES');
      });

      expect(backend.audio).toEqual([
        { guestId: 'guest-alice', text: 'hola a todos', detectedLanguage: 'es-ES' },
      ]);
      const hostChannel = hub.find('host')!;
      expect(hostChannel.received).toContainEqual<SessionMessage>({
        type: 'guest-audio',
        guestId: 'guest-alice',
        text: 'hola a todos',
        detectedLanguage: 'es-ES',
      });
      // Guest audio is not echoed to the other guest device.
      expect(hub.find('guest-bob')!.received.some((message) => message.type === 'guest-audio')).toBe(false);
    });

    it('records each device with its own preferred language', async () => {
      const host = renderHost();
      act(() => host.result.current.createSession(SESSION));
      const alice = renderGuest('alice');
      await admitGuest(alice, 'alice', 'es-ES');
      const bob = renderGuest('bob');
      await admitGuest(bob, 'bob', 'fr-FR');

      await expectEventually(() => expect(host.result.current.guests).toHaveLength(2));
      expect(host.result.current.guests.map((guest) => [guest.id, guest.language])).toEqual([
        ['guest-alice', 'es-ES'],
        ['guest-bob', 'fr-FR'],
      ]);
    });

    it('ignores a duplicate join for a guest already on the roster', async () => {
      const host = renderHost();
      act(() => host.result.current.createSession(SESSION));
      const alice = renderGuest('alice');
      await admitGuest(alice, 'alice');

      act(() => {
        hub.publish(SESSION_ID, {
          type: 'join',
          guest: { id: 'guest-alice', name: 'Alice', language: 'es-ES', joinedAt: 2 },
        }, { to: 'host' });
      });

      expect(host.result.current.guests).toHaveLength(1);
    });
  });

  describe('leaving and revocation', () => {
    it('removes a guest from the host roster', async () => {
      const host = renderHost();
      act(() => host.result.current.createSession(SESSION));
      const alice = renderGuest('alice');
      await admitGuest(alice, 'alice');
      const bob = renderGuest('bob');
      await admitGuest(bob, 'bob');

      await expectEventually(() => expect(host.result.current.guests).toHaveLength(2));
      act(() => host.result.current.removeGuest('guest-alice'));

      expect(host.result.current.guests.map((guest) => guest.id)).toEqual(['guest-bob']);
    });

    it('moves a revoked guest to a terminal state without affecting the other device', async () => {
      const host = renderHost();
      act(() => host.result.current.createSession(SESSION));
      const alice = renderGuest('alice');
      await admitGuest(alice, 'alice');
      const bob = renderGuest('bob');
      await admitGuest(bob, 'bob');

      act(() => {
        hub.publish(SESSION_ID, { type: 'revoked', guestId: 'guest-alice', message: 'Removed by host' });
      });

      await expectEventually(() => expect(alice.result.current.connectionStatus).toBe('revoked'));
      expect(alice.result.current.errorMessage).toBe('Removed by host');
      expect(bob.result.current.connectionStatus).toBe('connected');
    });

    it('marks a guest disconnected when its transport drops', async () => {
      const host = renderHost();
      act(() => host.result.current.createSession(SESSION));
      const alice = renderGuest('alice');
      await admitGuest(alice, 'alice');

      act(() => hub.find('guest-alice')!.drop('disconnected'));

      await expectEventually(() => expect(alice.result.current.connectionStatus).toBe('disconnected'));
      expect(hub.channelsFor(SESSION_ID).map((channel) => channel.label)).not.toContain('guest-alice');
    });

    it('surfaces a rejected transport as an expired admission', async () => {
      const host = renderHost();
      act(() => host.result.current.createSession(SESSION));
      const alice = renderGuest('alice');
      await admitGuest(alice, 'alice');

      act(() => hub.find('guest-alice')!.drop('rejected'));

      await expectEventually(() => expect(alice.result.current.connectionStatus).toBe('expired'));
    });
  });

  describe('session end', () => {
    it('ends the session on every connected device', async () => {
      const host = renderHost();
      act(() => host.result.current.createSession(SESSION));
      const alice = renderGuest('alice');
      await admitGuest(alice, 'alice');
      const bob = renderGuest('bob');
      await admitGuest(bob, 'bob');

      act(() => host.result.current.endSession());

      await expectEventually(() => expect(alice.result.current.connectionStatus).toBe('ended'));
      expect(alice.result.current.sessionEnded).toBe(true);
      expect(bob.result.current.connectionStatus).toBe('ended');
      expect(bob.result.current.sessionEnded).toBe(true);

      expect(host.result.current.session).toBeNull();
      expect(host.result.current.guests).toEqual([]);
      expect(host.result.current.connectionStatus).toBe('idle');
      expect(hub.channelsFor(SESSION_ID)).toEqual([]);
    });

    it('stops delivering host broadcasts after the session ends', async () => {
      const host = renderHost();
      act(() => host.result.current.createSession(SESSION));
      const alice = renderGuest('alice');
      await admitGuest(alice, 'alice');

      act(() => host.result.current.endSession());
      act(() => host.result.current.broadcastUtterance(utterance({ id: 'after-end' })));

      expect(alice.result.current.utterances.some((entry) => entry.id === 'after-end')).toBe(false);
    });

    it('clears roster and reconnects when the host starts a new session', async () => {
      const host = renderHost();
      act(() => host.result.current.createSession(SESSION));
      const alice = renderGuest('alice');
      await admitGuest(alice, 'alice');
      await expectEventually(() => expect(host.result.current.guests).toHaveLength(1));

      const nextSession = { ...SESSION, id: SESSION_ID, title: 'Retro' };
      act(() => host.result.current.resumeSession(nextSession));

      expect(host.result.current.guests).toEqual([]);
      expect(host.result.current.session).toEqual(nextSession);
      await expectEventually(() => expect(host.result.current.connectionStatus).toBe('connected'));
    });
  });
});
