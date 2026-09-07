import { BlobServiceClient, RestError } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';

let _blobService: BlobServiceClient | null = null;

function getBlobService(): BlobServiceClient {
  if (_blobService) return _blobService;

  const accountName = process.env.AUDIO_STORAGE_ACCOUNT;
  if (!accountName) throw new Error('AUDIO_STORAGE_ACCOUNT not configured');

  _blobService = new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    new DefaultAzureCredential(),
  );
  return _blobService;
}

/** Thrown when a blob for this session already exists. */
export class BlobConflictError extends Error {
  constructor(blobName: string) {
    super(`Blob already exists: ${blobName}`);
    this.name = 'BlobConflictError';
  }
}

/**
 * Stable, MIME-independent blob key for a session's audio recording.
 * Using a fixed extension ensures one-recording-per-session quota cannot be
 * bypassed by varying the MIME type.  The actual content type is stored in
 * the blob's Content-Type header.
 */
export function audioBlobName(sessionId: string): string {
  return `session-${sessionId}.webm`;
}

/**
 * Detect the "blob already exists" condition from Azure Storage.
 *
 * Azure may return either:
 * - HTTP 409 BlobAlreadyExists  (Azurite / older SDK paths)
 * - HTTP 412 ConditionNotMet    (when `If-None-Match: *` fires)
 *
 * We match on `statusCode` **and** `code` to avoid swallowing unrelated
 * 409/412 errors (e.g. lease conflicts or ETag mismatches).
 */
export function isBlobAlreadyExistsError(err: unknown): boolean {
  if (!(err instanceof RestError)) return false;
  if (err.statusCode === 409 && err.code === 'BlobAlreadyExists') return true;
  if (err.statusCode === 412 && err.code === 'ConditionNotMet') return true;
  return false;
}

/**
 * Upload session audio with fail-if-exists semantics.
 *
 * Uses the Azure Blob `If-None-Match: *` condition so that a repeated upload
 * is atomically rejected by the storage service, preventing overwrites and
 * providing a durable quota of one recording per session.
 *
 * Platform note: Azure Functions v4 HttpRequest.formData() materializes the
 * entire multipart body in memory (the Web API FormData/Blob model), so true
 * server-side streaming from req.body is not possible without a manual
 * multipart parser.  We enforce Content-Length before parsing and Blob.size
 * after parsing to cap peak memory, and pass the ArrayBuffer directly to the
 * SDK (which accepts BinaryData) to avoid an extra Buffer copy.
 */
export async function uploadAudio(
  sessionId: string,
  data: ArrayBuffer,
  contentType: string,
): Promise<string> {
  const containerName = process.env.AUDIO_STORAGE_CONTAINER ?? 'session-audio';
  const blobName = audioBlobName(sessionId);

  const service = getBlobService();
  const containerClient = service.getContainerClient(containerName);
  const blockBlob = containerClient.getBlockBlobClient(blobName);

  try {
    await blockBlob.upload(data, data.byteLength, {
      blobHTTPHeaders: { blobContentType: contentType },
      conditions: { ifNoneMatch: '*' },
    });
  } catch (err: unknown) {
    if (isBlobAlreadyExistsError(err)) {
      throw new BlobConflictError(blobName);
    }
    throw err;
  }

  return blockBlob.url;
}

/**
 * Best-effort blob cleanup (e.g. when the subsequent Cosmos patch fails).
 * Swallows errors so callers can propagate the original failure.
 */
export async function deleteAudioBlob(sessionId: string): Promise<void> {
  try {
    const containerName = process.env.AUDIO_STORAGE_CONTAINER ?? 'session-audio';
    const blobName = audioBlobName(sessionId);
    const service = getBlobService();
    const containerClient = service.getContainerClient(containerName);
    await containerClient.getBlockBlobClient(blobName).deleteIfExists();
  } catch {
    // best-effort
  }
}

// ── MIME allowlist & magic-byte validation ───────────────────────────

/** MIME types actually produced by browser MediaRecorder / common audio codecs. */
export const ALLOWED_AUDIO_MIMES: ReadonlySet<string> = new Set([
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/wav',
  'audio/wave',
  'audio/mp4',
  'video/webm',              // some browsers tag audio-only MediaRecorder output as video/webm
  'video/webm;codecs=opus',
]);

// (MIME_TO_EXT removed – blob names are now MIME-independent to prevent quota bypass)

/**
 * Normalise the MIME string the way browsers produce it (lowercase, no spaces
 * around `;`).  Returns `null` if the type is not in the allowlist.
 */
export function normaliseAllowedMime(raw: string): string | null {
  const normalised = raw.toLowerCase().replace(/\s*;\s*/g, ';').trim();
  return ALLOWED_AUDIO_MIMES.has(normalised) ? normalised : null;
}

/**
 * Magic-byte signatures for each container format family.
 * We validate that the file's leading bytes are consistent with the declared
 * Content-Type so a renamed .exe cannot be uploaded as "audio/webm".
 */
interface MagicSig { offset: number; bytes: Uint8Array }

const WEBM_MAGIC: MagicSig = { offset: 0, bytes: new Uint8Array([0x1A, 0x45, 0xDF, 0xA3]) }; // EBML header
const OGG_MAGIC:  MagicSig = { offset: 0, bytes: new Uint8Array([0x4F, 0x67, 0x67, 0x53]) }; // "OggS"
const RIFF_WAV:   MagicSig = { offset: 0, bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]) }; // "RIFF"
// MP4/ftyp box – bytes 4..7 are "ftyp"
const MP4_FTYP:   MagicSig = { offset: 4, bytes: new Uint8Array([0x66, 0x74, 0x79, 0x70]) };

const MIME_SIGNATURES: Record<string, MagicSig[]> = {
  'audio/webm':              [WEBM_MAGIC],
  'audio/webm;codecs=opus':  [WEBM_MAGIC],
  'video/webm':              [WEBM_MAGIC],
  'video/webm;codecs=opus':  [WEBM_MAGIC],
  'audio/ogg':               [OGG_MAGIC],
  'audio/ogg;codecs=opus':   [OGG_MAGIC],
  'audio/wav':               [RIFF_WAV],
  'audio/wave':              [RIFF_WAV],
  'audio/mp4':               [MP4_FTYP],
};

/**
 * Return true when the leading bytes of `data` match at least one expected
 * signature for the given (already-normalised) MIME type.
 */
export function validateMagicBytes(mime: string, data: ArrayBuffer): boolean {
  const sigs = MIME_SIGNATURES[mime];
  if (!sigs) return false;
  const view = new Uint8Array(data);
  return sigs.some((sig) => {
    if (view.length < sig.offset + sig.bytes.length) return false;
    return sig.bytes.every((b, i) => view[sig.offset + i] === b);
  });
}

/** Default maximum upload size: 100 MiB. */
export const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Absolute ceiling for upload size config: 500 MiB. */
export const MAX_UPLOAD_BYTES_UPPER_BOUND = 500 * 1024 * 1024;

/**
 * Read the configured max upload size from the environment, falling back to
 * {@link DEFAULT_MAX_UPLOAD_BYTES}.
 *
 * The value must be a positive integer no larger than
 * {@link MAX_UPLOAD_BYTES_UPPER_BOUND} to prevent accidental unsafe
 * deployment configuration.
 */
export function getMaxUploadBytes(): number {
  const env = process.env.AUDIO_MAX_UPLOAD_BYTES;
  if (env) {
    const n = Number(env);
    if (Number.isInteger(n) && n > 0 && n <= MAX_UPLOAD_BYTES_UPPER_BOUND) return n;
  }
  return DEFAULT_MAX_UPLOAD_BYTES;
}
