import { BlobServiceClient } from '@azure/storage-blob';
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

export async function uploadAudio(
  sessionId: string,
  data: Buffer,
  contentType: string,
): Promise<string> {
  const containerName = process.env.AUDIO_STORAGE_CONTAINER ?? 'session-audio';
  const blobName = `session-${sessionId}.webm`;

  const service = getBlobService();
  const containerClient = service.getContainerClient(containerName);
  const blockBlob = containerClient.getBlockBlobClient(blobName);

  await blockBlob.upload(data, data.length, {
    blobHTTPHeaders: { blobContentType: contentType || 'audio/webm' },
  });

  return blockBlob.url;
}
