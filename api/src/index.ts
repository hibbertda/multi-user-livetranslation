import { app, HttpRequest, HttpResponseInit } from '@azure/functions';
import { createSession, patchSession, endSession, listSessions, getSession, deleteSession, getUserSettings, upsertUserSettings, type SessionRecord, type UserSettings } from './cosmos.js';
import { uploadAudio } from './storage.js';
import { getClientUrl } from './pubsub.js';

// --------------- CORS helper ---------------

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function options(): HttpResponseInit {
  return { status: 204, headers: corsHeaders() };
}

function json(body: unknown, status = 200): HttpResponseInit {
  return {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    body: JSON.stringify(body),
  };
}

function error(message: string, status = 400): HttpResponseInit {
  return json({ error: message }, status);
}

// --------------- GET|POST /api/sessions ---------------

async function sessionsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options();

  if (req.method === 'GET') {
    const limit = Math.min(Number(req.query.get('limit')) || 50, 100);
    const offset = Math.max(Number(req.query.get('offset')) || 0, 0);
    const records = await listSessions(limit, offset);
    return json(records);
  }

  // POST
  const body = (await req.json()) as SessionRecord;
  if (!body.id || !body.token || !body.hostName) {
    return error('Missing required fields: id, token, hostName');
  }

  await createSession(body);
  return json({ ok: true }, 201);
}

app.http('sessions', {
  methods: ['GET', 'POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'sessions',
  handler: sessionsHandler,
});

// --------------- GET|PATCH|DELETE /api/sessions/{id} ---------------

async function sessionByIdHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options();

  const id = req.params.id;
  if (!id) return error('Missing session id', 400);

  if (req.method === 'GET') {
    const record = await getSession(id);
    if (!record) return error('Session not found', 404);
    return json(record);
  }

  if (req.method === 'DELETE') {
    await deleteSession(id);
    return json({ ok: true });
  }

  // PATCH
  const patch = (await req.json()) as Partial<SessionRecord>;
  await patchSession(id, patch);
  return json({ ok: true });
}

app.http('sessionById', {
  methods: ['GET', 'PATCH', 'DELETE', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'sessions/{id}',
  handler: sessionByIdHandler,
});

// --------------- POST /api/sessions/{id}/end ---------------

async function endSessionHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options();

  const id = req.params.id;
  if (!id) return error('Missing session id', 400);

  const body = (await req.json()) as { utteranceCount: number; guests: SessionRecord['guests']; utterances?: SessionRecord['utterances'] };
  await endSession(id, body.utteranceCount ?? 0, body.guests ?? [], body.utterances);
  return json({ ok: true });
}

app.http('endSession', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'sessions/{id}/end',
  handler: endSessionHandler,
});

// --------------- POST /api/sessions/{id}/audio ---------------

async function uploadAudioHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options();

  const id = req.params.id;
  if (!id) return error('Missing session id', 400);

  // Parse multipart form data
  const formData = await req.formData();
  const file = formData.get('audio');
  if (!file || !(file instanceof Blob)) {
    return error('Missing audio file in form data');
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const audioUrl = await uploadAudio(id, buffer, file.type || 'audio/webm');

  // Update session record with audio URL
  await patchSession(id, { audioUrl });
  return json({ audioUrl }, 201);
}

app.http('uploadAudio', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'sessions/{id}/audio',
  handler: uploadAudioHandler,
});

// --------------- GET|PUT /api/settings/{userId} ---------------

async function settingsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options();

  const userId = req.params.userId;
  if (!userId) return error('Missing userId', 400);

  if (req.method === 'GET') {
    const settings = await getUserSettings(userId);
    if (!settings) return json({ microphoneDeviceId: '', translationMode: 'standard' });
    return json({ microphoneDeviceId: settings.microphoneDeviceId, translationMode: settings.translationMode });
  }

  // PUT
  const body = (await req.json()) as Partial<UserSettings>;
  const doc: UserSettings = {
    id: userId,
    type: 'userSettings',
    microphoneDeviceId: body.microphoneDeviceId ?? '',
    translationMode: body.translationMode === 'realtime' ? 'realtime' : 'standard',
  };
  await upsertUserSettings(doc);
  return json({ ok: true });
}

app.http('settings', {
  methods: ['GET', 'PUT', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'settings/{userId}',
  handler: settingsHandler,
});

// --------------- GET /api/negotiate ---------------
// Client calls this to get a Web PubSub WebSocket URL

async function negotiateHandler(req: HttpRequest): Promise<HttpResponseInit> {
  if (req.method === 'OPTIONS') return options();

  const sessionId = req.query.get('session');
  const token = req.query.get('token');
  const role = req.query.get('role') as 'host' | 'guest' | null;

  if (!sessionId || !token || !role) {
    return error('Missing query params: session, token, role');
  }

  // For guest connections, validate the session exists and token matches
  if (role === 'guest') {
    const session = await getSession(sessionId);
    if (!session) return error('Session not found', 404);
    if (session.token !== token) return error('Invalid session token', 403);
    if (session.status === 'ended') return error('Session has ended', 410);
  }

  const url = await getClientUrl(sessionId, token, role);
  return json({ url });
}

app.http('negotiate', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'negotiate',
  handler: negotiateHandler,
});
